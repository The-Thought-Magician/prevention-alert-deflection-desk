import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { rule_sets, alerts, customers, audit_events, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const ruleSetSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().min(1).optional(),
  weights: z.record(z.string(), z.number()).optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
  auto_deflect_eligible: z.record(z.string(), z.unknown()).optional(),
})

const ruleSetUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.number().int().min(1).optional(),
  weights: z.record(z.string(), z.number()).optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
  auto_deflect_eligible: z.record(z.string(), z.unknown()).optional(),
})

const simulateSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
}).optional()

// ── Decision engine (deterministic, pure) ──────────────────────────────────
// Default weight set used when a rule set does not specify weights.
const DEFAULT_WEIGHTS: Record<string, number> = {
  amount: 0.25,
  reason_category: 0.3,
  customer_risk: 0.2,
  recoverable: 0.15,
  refundable: 0.1,
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  deflect: 0.6, // score >= deflect → REFUND_DEFLECT
  represent: 0.35, // score < represent → REPRESENT, else REVIEW
}

// Categories generally considered cheap/safe to deflect with a refund.
const DEFLECTABLE_CATEGORIES = new Set([
  'fraud',
  'friendly_fraud',
  'subscription',
  'product_not_received',
])

interface ScoreFactor {
  name: string
  value: number
  weight: number
  contribution: number
}

interface ScoredAlert {
  score: number
  recommendation: 'REFUND_DEFLECT' | 'REPRESENT' | 'REVIEW'
  factors: ScoreFactor[]
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function scoreAlert(
  alert: typeof alerts.$inferSelect,
  customer: typeof customers.$inferSelect | null,
  weights: Record<string, number>,
  thresholds: Record<string, number>,
): ScoredAlert {
  const w = { ...DEFAULT_WEIGHTS, ...weights }
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }

  // Per-factor normalized [0,1] values where higher → more deflect-favorable.
  const amountValue = clamp01(1 - alert.amount_cents / 50000) // smaller amounts favor deflection
  const categoryValue = alert.reason_category && DEFLECTABLE_CATEGORIES.has(alert.reason_category) ? 1 : 0.2
  const riskValue = customer
    ? clamp01(1 - (customer.risk_score ?? 0)) * (customer.is_watchlisted ? 0.3 : 1)
    : 0.6
  const recoverableValue = 1 // a refund deflection is favorable regardless; kept as signal
  const refundableValue = 1

  const factors: ScoreFactor[] = [
    { name: 'amount', value: amountValue, weight: w.amount, contribution: amountValue * w.amount },
    { name: 'reason_category', value: categoryValue, weight: w.reason_category, contribution: categoryValue * w.reason_category },
    { name: 'customer_risk', value: riskValue, weight: w.customer_risk, contribution: riskValue * w.customer_risk },
    { name: 'recoverable', value: recoverableValue, weight: w.recoverable, contribution: recoverableValue * w.recoverable },
    { name: 'refundable', value: refundableValue, weight: w.refundable, contribution: refundableValue * w.refundable },
  ]

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1
  const score = clamp01(factors.reduce((s, f) => s + f.contribution, 0) / totalWeight)

  let recommendation: ScoredAlert['recommendation']
  if (score >= (t.deflect ?? DEFAULT_THRESHOLDS.deflect)) recommendation = 'REFUND_DEFLECT'
  else if (score < (t.represent ?? DEFAULT_THRESHOLDS.represent)) recommendation = 'REPRESENT'
  else recommendation = 'REVIEW'

  return { score: Math.round(score * 1000) / 1000, recommendation, factors }
}

export { scoreAlert, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFLECTABLE_CATEGORIES }

// ── Routes ──────────────────────────────────────────────────────────────────

// Auth: list rule sets for a workspace
router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(rule_sets)
    .where(eq(rule_sets.workspace_id, workspaceId))
    .orderBy(desc(rule_sets.created_at))
  return c.json(rows)
})

// Auth: get one rule set
router.get('/:id', authMiddleware, async (c) => {
  const [rs] = await db.select().from(rule_sets).where(eq(rule_sets.id, c.req.param('id')))
  if (!rs) return c.json({ error: 'Not found' }, 404)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(rs.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(rs)
})

// Auth: create rule set
router.post('/', authMiddleware, zValidator('json', ruleSetSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [rs] = await db
    .insert(rule_sets)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      version: body.version ?? 1,
      is_active: false,
      weights: body.weights ?? {},
      thresholds: body.thresholds ?? {},
      auto_deflect_eligible: body.auto_deflect_eligible ?? {},
      created_by: userId,
    })
    .returning()
  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'rule_set.create',
    entity_type: 'rule_set',
    entity_id: rs.id,
    detail: { name: rs.name },
  })
  return c.json(rs, 201)
})

// Auth: update weights/thresholds (creator ownership)
router.put('/:id', authMiddleware, zValidator('json', ruleSetUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rule_sets).where(eq(rule_sets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(rule_sets).set(body).where(eq(rule_sets.id, id)).returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'rule_set.update',
    entity_type: 'rule_set',
    entity_id: id,
    detail: { changes: body },
  })
  return c.json(updated)
})

// Auth: activate (deactivates all others in the same workspace — single active)
router.post('/:id/activate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rule_sets).where(eq(rule_sets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  // Deactivate every active rule set in the workspace, then activate this one.
  await db
    .update(rule_sets)
    .set({ is_active: false })
    .where(eq(rule_sets.workspace_id, existing.workspace_id))
  const [activated] = await db
    .update(rule_sets)
    .set({ is_active: true })
    .where(eq(rule_sets.id, id))
    .returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'rule_set.activate',
    entity_type: 'rule_set',
    entity_id: id,
    detail: { name: existing.name },
  })
  return c.json(activated)
})

// Auth: simulate this rule set over historical alerts → projected dispositions
router.post('/:id/simulate', authMiddleware, zValidator('json', simulateSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json') ?? {}
  const [rs] = await db.select().from(rule_sets).where(eq(rule_sets.id, id))
  if (!rs) return c.json({ error: 'Not found' }, 404)

  const limit = body.limit ?? 500
  const historical = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, rs.workspace_id))
    .orderBy(desc(alerts.received_at))
    .limit(limit)

  // Load customers referenced by these alerts for risk scoring.
  const customerIds = [...new Set(historical.map((a) => a.customer_id).filter((x): x is string => !!x))]
  const customerMap = new Map<string, typeof customers.$inferSelect>()
  for (const cid of customerIds) {
    const [cust] = await db.select().from(customers).where(eq(customers.id, cid))
    if (cust) customerMap.set(cid, cust)
  }

  const weights = (rs.weights ?? {}) as Record<string, number>
  const thresholds = (rs.thresholds ?? {}) as Record<string, number>

  const counts = { REFUND_DEFLECT: 0, REPRESENT: 0, REVIEW: 0 }
  let totalAmountDeflected = 0
  const results = historical.map((a) => {
    const cust = a.customer_id ? customerMap.get(a.customer_id) ?? null : null
    const scored = scoreAlert(a, cust, weights, thresholds)
    counts[scored.recommendation] += 1
    if (scored.recommendation === 'REFUND_DEFLECT') totalAmountDeflected += a.amount_cents
    return {
      alert_id: a.id,
      network: a.network,
      reason_category: a.reason_category,
      amount_cents: a.amount_cents,
      score: scored.score,
      recommendation: scored.recommendation,
      factors: scored.factors,
    }
  })

  return c.json({
    results: {
      rule_set_id: rs.id,
      rule_set_name: rs.name,
      total_alerts: historical.length,
      dispositions: counts,
      projected_deflect_amount_cents: totalAmountDeflected,
      alerts: results,
    },
  })
})

// Auth: delete (creator ownership)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rule_sets).where(eq(rule_sets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(rule_sets).where(eq(rule_sets.id, id))
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'rule_set.delete',
    entity_type: 'rule_set',
    entity_id: id,
    detail: { name: existing.name },
  })
  return c.json({ success: true })
})

export default router
