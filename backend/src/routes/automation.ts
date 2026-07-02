import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  auto_deflect_rules,
  alerts,
  orders,
  customers,
  refunds,
  refund_ledger_links,
  savings_records,
  thresholds,
  notifications,
  audit_events,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
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

const autoRuleSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  max_amount_cents: z.number().int().min(0).optional(),
  reason_categories: z.array(z.string()).optional(),
  require_clean_customer: z.boolean().optional(),
  max_per_day: z.number().int().min(0).optional(),
  is_dry_run: z.boolean().optional(),
  is_enabled: z.boolean().optional(),
})

const autoRuleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  max_amount_cents: z.number().int().min(0).optional(),
  reason_categories: z.array(z.string()).optional(),
  require_clean_customer: z.boolean().optional(),
  max_per_day: z.number().int().min(0).optional(),
  is_dry_run: z.boolean().optional(),
  is_enabled: z.boolean().optional(),
})

// Statuses for which an alert is still actionable (not already deflected/closed).
const OPEN_STATUSES = new Set(['new', 'triaging', 'decided', 'action_pending'])

// ── Routes ──────────────────────────────────────────────────────────────────

// Auth: list auto-deflect rules for a workspace
router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(auto_deflect_rules)
    .where(eq(auto_deflect_rules.workspace_id, workspaceId))
    .orderBy(desc(auto_deflect_rules.created_at))
  return c.json(rows)
})

// Auth: create auto-deflect rule
router.post('/', authMiddleware, zValidator('json', autoRuleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [rule] = await db
    .insert(auto_deflect_rules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      max_amount_cents: body.max_amount_cents ?? 0,
      reason_categories: body.reason_categories ?? [],
      require_clean_customer: body.require_clean_customer ?? true,
      max_per_day: body.max_per_day ?? 0,
      is_dry_run: body.is_dry_run ?? true,
      is_enabled: body.is_enabled ?? false,
      created_by: userId,
    })
    .returning()
  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'auto_rule.create',
    entity_type: 'auto_deflect_rule',
    entity_id: rule.id,
    detail: { name: rule.name },
  })
  return c.json(rule, 201)
})

// Auth: update (creator ownership)
router.put('/:id', authMiddleware, zValidator('json', autoRuleUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(auto_deflect_rules).where(eq(auto_deflect_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(auto_deflect_rules)
    .set(body)
    .where(eq(auto_deflect_rules.id, id))
    .returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'auto_rule.update',
    entity_type: 'auto_deflect_rule',
    entity_id: id,
    detail: { changes: body },
  })
  return c.json(updated)
})

// Auth: run the rule. Dry-run records matches only; live executes refunds with safety caps.
router.post('/:id/run', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rule] = await db.select().from(auto_deflect_rules).where(eq(auto_deflect_rules.id, id))
  if (!rule) return c.json({ error: 'Not found' }, 404)

  const ws = rule.workspace_id
  const allowedCategories = new Set(rule.reason_categories ?? [])

  // Candidate alerts: open + not duplicate in this workspace.
  const candidates = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, ws))
    .orderBy(desc(alerts.received_at))

  // Already-refunded alert ids in this workspace (idempotency / double-refund guard).
  const existingRefunds = await db.select().from(refunds).where(eq(refunds.workspace_id, ws))
  const refundedAlertIds = new Set(existingRefunds.map((r) => r.alert_id).filter((x): x is string => !!x))

  // Customers referenced (for clean-customer safety check).
  const customerIds = [...new Set(candidates.map((a) => a.customer_id).filter((x): x is string => !!x))]
  const customerMap = new Map<string, typeof customers.$inferSelect>()
  if (customerIds.length) {
    const custRows = await db.select().from(customers).where(inArray(customers.id, customerIds))
    for (const cust of custRows) customerMap.set(cust.id, cust)
  }

  // Safety cap: max executions per day (counts today's auto-deflection refunds).
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const todaysAutoRefunds = existingRefunds.filter(
    (r) => r.method === 'auto_deflection' && new Date(r.created_at).getTime() >= startOfDay.getTime(),
  ).length
  const dailyCapRemaining = rule.max_per_day && rule.max_per_day > 0 ? rule.max_per_day - todaysAutoRefunds : Infinity

  const matched: Array<{ alert_id: string; amount_cents: number; reason_category: string | null; reason: string }> = []
  const executed: Array<{ alert_id: string; refund_id: string; amount_cents: number }> = []
  let executedCount = 0

  for (const alert of candidates) {
    // Eligibility checks.
    if (!OPEN_STATUSES.has(alert.status)) continue
    if (alert.is_duplicate) continue
    if (refundedAlertIds.has(alert.id)) continue
    if (rule.max_amount_cents > 0 && alert.amount_cents > rule.max_amount_cents) continue
    if (allowedCategories.size > 0) {
      if (!alert.reason_category || !allowedCategories.has(alert.reason_category)) continue
    }
    if (rule.require_clean_customer && alert.customer_id) {
      const cust = customerMap.get(alert.customer_id)
      if (cust && (cust.is_watchlisted || (cust.risk_score ?? 0) >= 0.5)) continue
    }

    matched.push({
      alert_id: alert.id,
      amount_cents: alert.amount_cents,
      reason_category: alert.reason_category,
      reason: 'meets auto-deflect criteria',
    })

    if (rule.is_dry_run) continue
    if (executedCount >= dailyCapRemaining) continue // daily safety cap reached

    // Live execution: create refund, ledger link, savings record, mark deflected.
    const [refund] = await db
      .insert(refunds)
      .values({
        workspace_id: ws,
        alert_id: alert.id,
        order_id: alert.order_id,
        amount_cents: alert.amount_cents,
        currency: alert.currency,
        method: 'auto_deflection',
        source: 'auto_deflection',
        executed_by: userId,
      })
      .returning()

    if (alert.order_id) {
      await db
        .insert(refund_ledger_links)
        .values({
          workspace_id: ws,
          refund_id: refund.id,
          order_id: alert.order_id,
          alert_id: alert.id,
        })
        .onConflictDoNothing()
    }

    // Savings: chargeback cost avoided ≈ amount + fine averted (per threshold).
    const [thr] = await db
      .select()
      .from(thresholds)
      .where(and(eq(thresholds.workspace_id, ws), eq(thresholds.network, alert.network)))
    const fineAverted = thr?.fine_per_dispute_cents ?? 0
    const chargebackCostAvoided = alert.amount_cents
    const netSavings = chargebackCostAvoided + fineAverted - alert.amount_cents

    await db.insert(savings_records).values({
      workspace_id: ws,
      alert_id: alert.id,
      refund_paid_cents: alert.amount_cents,
      chargeback_cost_avoided_cents: chargebackCostAvoided,
      fine_averted_cents: fineAverted,
      net_savings_cents: netSavings,
      network: alert.network,
    })

    await db.update(alerts).set({ status: 'deflected' }).where(eq(alerts.id, alert.id))

    await db.insert(notifications).values({
      workspace_id: ws,
      user_id: userId,
      type: 'auto_deflection',
      title: 'Auto-deflection executed',
      body: `Alert ${alert.id} auto-deflected for ${(alert.amount_cents / 100).toFixed(2)} ${alert.currency}`,
      entity_type: 'alert',
      entity_id: alert.id,
    })

    refundedAlertIds.add(alert.id)
    executed.push({ alert_id: alert.id, refund_id: refund.id, amount_cents: alert.amount_cents })
    executedCount += 1
  }

  if (!rule.is_dry_run && executedCount > 0) {
    await db
      .update(auto_deflect_rules)
      .set({ execution_count: rule.execution_count + executedCount })
      .where(eq(auto_deflect_rules.id, id))
  }

  await db.insert(audit_events).values({
    workspace_id: ws,
    actor: userId,
    action: rule.is_dry_run ? 'auto_rule.dry_run' : 'auto_rule.run',
    entity_type: 'auto_deflect_rule',
    entity_id: id,
    detail: { matched: matched.length, executed: executedCount, dry_run: rule.is_dry_run },
  })

  return c.json({
    matched: matched.length,
    executed: executedCount,
    dryRun: rule.is_dry_run,
    matches: matched,
    executions: executed,
    dailyCapRemaining: Number.isFinite(dailyCapRemaining) ? dailyCapRemaining : null,
  })
})

// Auth: delete (creator ownership)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(auto_deflect_rules).where(eq(auto_deflect_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.created_by !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(auto_deflect_rules).where(eq(auto_deflect_rules.id, id))
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'auto_rule.delete',
    entity_type: 'auto_deflect_rule',
    entity_id: id,
    detail: { name: existing.name },
  })
  return c.json({ success: true })
})

export default router
