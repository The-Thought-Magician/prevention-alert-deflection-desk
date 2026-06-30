import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  decisions,
  alerts,
  orders,
  customers,
  rule_sets,
  audit_events,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── helpers ────────────────────────────────────────────────────────────────

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

async function logAudit(
  workspaceId: string,
  actor: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  try {
    await db.insert(audit_events).values({
      workspace_id: workspaceId,
      actor,
      action,
      entity_type: 'decision',
      entity_id: entityId,
      detail,
    })
  } catch {
    // ignore audit failures
  }
}

// Default scoring weights (overridden by the active rule set's weights).
const DEFAULT_WEIGHTS: Record<string, number> = {
  amount: 0.25,
  margin: 0.15,
  reason_deflectability: 0.3,
  customer_risk: 0.15,
  deadline_pressure: 0.1,
  recoverable: 0.05,
}

// Reason-category → intrinsic deflectability (0..1). Higher = prefer refund/deflect.
const REASON_DEFLECTABILITY: Record<string, number> = {
  fraud: 0.95,
  friendly_fraud: 0.85,
  subscription: 0.8,
  product_not_received: 0.55,
  processing_error: 0.2,
}

interface Factor {
  name: string
  value: number
  weight: number
  contribution: number
}

interface EngineResult {
  recommendation: 'REFUND_DEFLECT' | 'REPRESENT' | 'REVIEW'
  score: number
  factors: Factor[]
  ruleSetId: string | null
}

// Deterministic refund-vs-represent engine. Pure given its inputs.
function evaluateEngine(
  alert: typeof alerts.$inferSelect,
  order: typeof orders.$inferSelect | null,
  customer: typeof customers.$inferSelect | null,
  ruleSet: typeof rule_sets.$inferSelect | null,
): EngineResult {
  const weights = { ...DEFAULT_WEIGHTS, ...(ruleSet?.weights ?? {}) }
  const thresholds = ruleSet?.thresholds ?? {}
  const deflectThreshold = typeof thresholds.deflect === 'number' ? thresholds.deflect : 0.6
  const representThreshold = typeof thresholds.represent === 'number' ? thresholds.represent : 0.4

  const factors: Factor[] = []

  // amount: smaller amounts favor deflection (cheaper to refund than fight).
  const amount = alert.amount_cents ?? 0
  const amountNorm = amount <= 0 ? 0.5 : Math.max(0, Math.min(1, 1 - amount / 50_000))
  factors.push(mkFactor('amount', amountNorm, weights.amount))

  // margin: low margin favors deflection (little to recover by representing).
  const margin = order?.margin_cents ?? 0
  const marginNorm =
    amount > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, margin) / amount)) : 0.5
  factors.push(mkFactor('margin', marginNorm, weights.margin))

  // reason deflectability.
  const reasonScore = REASON_DEFLECTABILITY[alert.reason_category ?? ''] ?? 0.5
  factors.push(mkFactor('reason_deflectability', reasonScore, weights.reason_deflectability))

  // customer risk: higher risk / watchlisted favors representment (don't reward abuse).
  const riskScore = customer?.risk_score ?? 0
  const watchlisted = customer?.is_watchlisted ? 1 : 0
  const riskNorm = Math.max(0, Math.min(1, 1 - (riskScore + watchlisted * 0.5)))
  factors.push(mkFactor('customer_risk', riskNorm, weights.customer_risk))

  // deadline pressure: tighter deadline favors deflection (no time to represent).
  let deadlineNorm = 0.5
  if (alert.deadline_at) {
    const hoursLeft = (new Date(alert.deadline_at).getTime() - Date.now()) / 3_600_000
    deadlineNorm = Math.max(0, Math.min(1, 1 - hoursLeft / 72))
  }
  factors.push(mkFactor('deadline_pressure', deadlineNorm, weights.deadline_pressure))

  // recoverable: if the order/product is recoverable, representment is more viable.
  const recoverable = order?.recoverable ? 0 : 1
  factors.push(mkFactor('recoverable', recoverable, weights.recoverable))

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1
  const score = factors.reduce((s, f) => s + f.contribution, 0) / totalWeight

  let recommendation: EngineResult['recommendation']
  // Hard gate: non-refundable orders cannot be deflected via refund.
  if (order && order.refundable === false) {
    recommendation = 'REPRESENT'
  } else if (score >= deflectThreshold) {
    recommendation = 'REFUND_DEFLECT'
  } else if (score <= representThreshold) {
    recommendation = 'REPRESENT'
  } else {
    recommendation = 'REVIEW'
  }

  return { recommendation, score: round4(score), factors, ruleSetId: ruleSet?.id ?? null }
}

function mkFactor(name: string, value: number, weight: number): Factor {
  const w = typeof weight === 'number' ? weight : 0
  const v = round4(value)
  return { name, value: v, weight: w, contribution: round4(v * w) }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

async function getActiveRuleSet(workspaceId: string): Promise<typeof rule_sets.$inferSelect | null> {
  const [active] = await db
    .select()
    .from(rule_sets)
    .where(and(eq(rule_sets.workspace_id, workspaceId), eq(rule_sets.is_active, true)))
    .limit(1)
  return active ?? null
}

async function loadContext(alert: typeof alerts.$inferSelect) {
  let order: typeof orders.$inferSelect | null = null
  if (alert.order_id) {
    const [o] = await db.select().from(orders).where(eq(orders.id, alert.order_id))
    order = o ?? null
  }
  let customer: typeof customers.$inferSelect | null = null
  if (alert.customer_id) {
    const [cu] = await db.select().from(customers).where(eq(customers.id, alert.customer_id))
    customer = cu ?? null
  }
  return { order, customer }
}

// ── GET / — decision history ─────────────────────────────────────────────────

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.workspace_id, workspaceId))
    .orderBy(desc(decisions.created_at))
  return c.json(rows)
})

// ── GET /alert/:alertId — latest decision for an alert ───────────────────────

router.get('/alert/:alertId', async (c) => {
  const alertId = c.req.param('alertId')
  const [latest] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.alert_id, alertId))
    .orderBy(desc(decisions.created_at))
    .limit(1)
  if (!latest) return c.json({ error: 'Not found' }, 404)
  return c.json(latest)
})

// ── POST /evaluate — run engine on one alert, persist ────────────────────────

const evaluateSchema = z.object({ alert_id: z.string().min(1) })

router.post('/evaluate', authMiddleware, zValidator('json', evaluateSchema), async (c) => {
  const userId = getUserId(c)
  const { alert_id } = c.req.valid('json')

  const [alert] = await db.select().from(alerts).where(eq(alerts.id, alert_id))
  if (!alert) return c.json({ error: 'Alert not found' }, 404)
  if (!(await isMember(alert.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { order, customer } = await loadContext(alert)
  const ruleSet = await getActiveRuleSet(alert.workspace_id)
  const result = evaluateEngine(alert, order, customer, ruleSet)

  const [decision] = await db
    .insert(decisions)
    .values({
      workspace_id: alert.workspace_id,
      alert_id: alert.id,
      rule_set_id: result.ruleSetId,
      recommendation: result.recommendation,
      score: result.score,
      factors: result.factors,
      is_override: false,
      decided_by: userId,
    })
    .returning()

  // Move the alert into a decided state if it was still untriaged.
  if (alert.status === 'new' || alert.status === 'triaging') {
    await db.update(alerts).set({ status: 'decided' }).where(eq(alerts.id, alert.id))
  }

  await logAudit(alert.workspace_id, userId, 'decision.evaluate', decision.id, {
    alert_id: alert.id,
    recommendation: result.recommendation,
    score: result.score,
  })

  return c.json(decision, 201)
})

// ── POST /batch — evaluate all undecided alerts in workspace ─────────────────

const batchSchema = z.object({ workspace_id: z.string().min(1) })

router.post('/batch', authMiddleware, zValidator('json', batchSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const ruleSet = await getActiveRuleSet(workspace_id)

  // Undecided = no decision row yet. Pull alerts then filter those lacking decisions.
  const wsAlerts = await db.select().from(alerts).where(eq(alerts.workspace_id, workspace_id))
  const existingDecisions = await db
    .select()
    .from(decisions)
    .where(eq(decisions.workspace_id, workspace_id))
  const decidedAlertIds = new Set(existingDecisions.map((d) => d.alert_id))

  const undecided = wsAlerts.filter(
    (a) => !decidedAlertIds.has(a.id) && a.status !== 'deflected' && a.status !== 'represented',
  )

  const out: Array<typeof decisions.$inferSelect> = []
  for (const alert of undecided) {
    const { order, customer } = await loadContext(alert)
    const result = evaluateEngine(alert, order, customer, ruleSet)
    const [decision] = await db
      .insert(decisions)
      .values({
        workspace_id,
        alert_id: alert.id,
        rule_set_id: result.ruleSetId,
        recommendation: result.recommendation,
        score: result.score,
        factors: result.factors,
        is_override: false,
        decided_by: userId,
      })
      .returning()
    if (alert.status === 'new' || alert.status === 'triaging') {
      await db.update(alerts).set({ status: 'decided' }).where(eq(alerts.id, alert.id))
    }
    out.push(decision)
  }

  await logAudit(workspace_id, userId, 'decision.batch', 'batch', { evaluated: out.length })
  return c.json({ evaluated: out.length, decisions: out })
})

// ── POST /:id/override — override recommendation with reason ─────────────────

const overrideSchema = z.object({
  recommendation: z.enum(['REFUND_DEFLECT', 'REPRESENT', 'REVIEW']),
  override_reason: z.string().min(1),
})

router.post('/:id/override', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { recommendation, override_reason } = c.req.valid('json')

  const [existing] = await db.select().from(decisions).where(eq(decisions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Record the override as a new decision row preserving prior factors/score.
  const [overridden] = await db
    .insert(decisions)
    .values({
      workspace_id: existing.workspace_id,
      alert_id: existing.alert_id,
      rule_set_id: existing.rule_set_id,
      recommendation,
      score: existing.score,
      factors: existing.factors,
      is_override: true,
      override_reason,
      decided_by: userId,
    })
    .returning()

  await logAudit(existing.workspace_id, userId, 'decision.override', overridden.id, {
    alert_id: existing.alert_id,
    from: existing.recommendation,
    to: recommendation,
    reason: override_reason,
  })

  return c.json(overridden)
})

export default router
