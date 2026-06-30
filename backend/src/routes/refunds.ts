import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  refunds,
  refund_ledger_links,
  alerts,
  orders,
  savings_records,
  thresholds,
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
      entity_type: 'refund',
      entity_id: entityId,
      detail,
    })
  } catch {
    // ignore audit failures
  }
}

// Typical chargeback handling/operational cost avoided when a dispute is deflected.
const DEFAULT_CHARGEBACK_COST_CENTS = 1_500

// Resolve the network-level fine-per-dispute averted by avoiding a chargeback.
async function fineAvertedCents(workspaceId: string, network: string): Promise<number> {
  try {
    const rows = await db
      .select()
      .from(thresholds)
      .where(and(eq(thresholds.workspace_id, workspaceId), eq(thresholds.network, network)))
    const withFine = rows.find((r) => typeof r.fine_per_dispute_cents === 'number' && r.fine_per_dispute_cents! > 0)
    return withFine?.fine_per_dispute_cents ?? 0
  } catch {
    return 0
  }
}

// ── GET / — refund ledger ─────────────────────────────────────────────────────

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.workspace_id, workspaceId))
    .orderBy(desc(refunds.created_at))
  return c.json(rows)
})

// ── GET /check — double-refund check for an order ────────────────────────────

router.get('/check', async (c) => {
  const orderId = c.req.query('order_id')
  if (!orderId) return c.json({ error: 'order_id required' }, 400)
  const existing = await db
    .select()
    .from(refunds)
    .where(eq(refunds.order_id, orderId))
    .orderBy(desc(refunds.created_at))
  return c.json({ alreadyRefunded: existing.length > 0, refunds: existing })
})

// ── GET /links — ledger links ────────────────────────────────────────────────

router.get('/links', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(refund_ledger_links)
    .where(eq(refund_ledger_links.workspace_id, workspaceId))
    .orderBy(desc(refund_ledger_links.created_at))
  return c.json(rows)
})

// ── POST / — execute deflection refund (idempotent per alert) ────────────────

const executeSchema = z.object({
  alert_id: z.string().min(1),
  method: z.enum(['manual', 'deflection', 'auto_deflection']).optional().default('deflection'),
  source: z.string().optional().default('deflection'),
  amount_cents: z.number().int().optional(),
})

router.post('/', authMiddleware, zValidator('json', executeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [alert] = await db.select().from(alerts).where(eq(alerts.id, body.alert_id))
  if (!alert) return c.json({ error: 'Alert not found' }, 404)
  if (!(await isMember(alert.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Idempotency: a refund already exists for this alert → return it unchanged.
  const [existingForAlert] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.alert_id, alert.id))
    .orderBy(desc(refunds.created_at))
    .limit(1)
  if (existingForAlert) {
    const [savings] = await db
      .select()
      .from(savings_records)
      .where(eq(savings_records.alert_id, alert.id))
      .orderBy(desc(savings_records.created_at))
      .limit(1)
    return c.json({ refund: existingForAlert, savings: savings ?? null, idempotent: true })
  }

  // Double-refund guard: an order already refunded by another alert.
  if (alert.order_id) {
    const [orderRefund] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.order_id, alert.order_id))
      .orderBy(desc(refunds.created_at))
      .limit(1)
    if (orderRefund) {
      return c.json(
        {
          error: 'Order already refunded',
          alreadyRefunded: true,
          refund: orderRefund,
        },
        409,
      )
    }
  }

  let order: typeof orders.$inferSelect | null = null
  if (alert.order_id) {
    const [o] = await db.select().from(orders).where(eq(orders.id, alert.order_id))
    order = o ?? null
  }

  const amountCents = body.amount_cents ?? alert.amount_cents

  // Create the refund.
  const [refund] = await db
    .insert(refunds)
    .values({
      workspace_id: alert.workspace_id,
      alert_id: alert.id,
      order_id: alert.order_id ?? null,
      amount_cents: amountCents,
      currency: alert.currency,
      method: body.method,
      source: body.source,
      executed_by: userId,
    })
    .returning()

  // Create the ledger link (requires an order; uniq(refund_id, order_id)).
  let link: typeof refund_ledger_links.$inferSelect | null = null
  if (alert.order_id) {
    const [created] = await db
      .insert(refund_ledger_links)
      .values({
        workspace_id: alert.workspace_id,
        refund_id: refund.id,
        order_id: alert.order_id,
        alert_id: alert.id,
      })
      .returning()
    link = created ?? null
  }

  // Compute and record savings.
  const fineAverted = await fineAvertedCents(alert.workspace_id, alert.network)
  const chargebackAvoided = DEFAULT_CHARGEBACK_COST_CENTS
  // Net savings = (avoided chargeback handling cost + fine averted) − refund paid out,
  // but never count the refund principal as a loss beyond the order margin at stake.
  const marginAtStake = order?.margin_cents ?? 0
  const netSavings = chargebackAvoided + fineAverted - Math.min(amountCents, Math.max(0, marginAtStake)) - 0
  const [savings] = await db
    .insert(savings_records)
    .values({
      workspace_id: alert.workspace_id,
      alert_id: alert.id,
      refund_paid_cents: amountCents,
      chargeback_cost_avoided_cents: chargebackAvoided,
      fine_averted_cents: fineAverted,
      net_savings_cents: netSavings,
      network: alert.network,
    })
    .returning()

  // Mark the alert deflected.
  await db.update(alerts).set({ status: 'deflected' }).where(eq(alerts.id, alert.id))

  await logAudit(alert.workspace_id, userId, 'refund.execute', refund.id, {
    alert_id: alert.id,
    order_id: alert.order_id,
    amount_cents: amountCents,
    method: body.method,
    net_savings_cents: netSavings,
    ledger_link: link?.id ?? null,
  })

  return c.json({ refund, savings: savings ?? null, link }, 201)
})

export default router
