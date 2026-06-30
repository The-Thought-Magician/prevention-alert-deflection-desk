import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { customers, orders, alerts, refunds, workspace_members, audit_events } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── helpers ────────────────────────────────────────────────────────────────

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Deterministic risk score (0-100) from the customer's order/alert/refund history.
function computeRiskScore(input: {
  alertCount: number
  deflectedCount: number
  chargebackCount: number
  refundCount: number
  orderCount: number
  isWatchlisted: boolean
}): number {
  const { alertCount, chargebackCount, refundCount, orderCount, isWatchlisted } = input
  let score = 0
  // Each dispute alert relative to order volume drives risk up.
  score += alertCount * 8
  score += chargebackCount * 15
  score += refundCount * 4
  if (orderCount > 0) {
    const disputeRate = alertCount / orderCount
    score += disputeRate * 30
  }
  if (isWatchlisted) score += 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  workspace_id: z.string().min(1),
  external_ref: z.string().min(1),
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_watchlisted: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  risk_score: z.number().min(0).max(100).optional(),
  is_watchlisted: z.boolean().optional(),
})

// ── routes ───────────────────────────────────────────────────────────────────

// Public: list customers for a workspace.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.workspace_id, workspaceId))
    .orderBy(desc(customers.created_at))
  return c.json(rows)
})

// Public: risk profile (orders, alerts, refunds, aggregated stats).
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [customer] = await db.select().from(customers).where(eq(customers.id, id))
  if (!customer) return c.json({ error: 'Not found' }, 404)

  const custOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.customer_id, id))
    .orderBy(desc(orders.created_at))
  const custAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.customer_id, id))
    .orderBy(desc(alerts.received_at))
  const custRefunds = await db
    .select()
    .from(refunds)
    .where(eq(refunds.workspace_id, customer.workspace_id))
  // Limit refunds to those tied to this customer's orders.
  const orderIds = new Set(custOrders.map((o) => o.id))
  const relevantRefunds = custRefunds.filter((r) => r.order_id && orderIds.has(r.order_id))

  const deflectedCount = custAlerts.filter((a) => a.status === 'deflected').length
  const chargebackCount = custAlerts.filter((a) => a.status === 'lapsed_to_chargeback').length
  const totalOrderValue = custOrders.reduce((s, o) => s + (o.amount_cents ?? 0), 0)
  const totalRefunded = relevantRefunds.reduce((s, r) => s + (r.amount_cents ?? 0), 0)

  const computedRisk = computeRiskScore({
    alertCount: custAlerts.length,
    deflectedCount,
    chargebackCount,
    refundCount: relevantRefunds.length,
    orderCount: custOrders.length,
    isWatchlisted: customer.is_watchlisted,
  })

  const stats = {
    orderCount: custOrders.length,
    alertCount: custAlerts.length,
    refundCount: relevantRefunds.length,
    deflectedCount,
    chargebackCount,
    totalOrderValueCents: totalOrderValue,
    totalRefundedCents: totalRefunded,
    storedRiskScore: customer.risk_score ?? 0,
    computedRiskScore: computedRisk,
  }

  return c.json({
    customer,
    stats,
    alerts: custAlerts,
    orders: custOrders,
    refunds: relevantRefunds,
  })
})

// Create a customer (auth + membership).
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  try {
    const [customer] = await db
      .insert(customers)
      .values({
        workspace_id: body.workspace_id,
        external_ref: body.external_ref,
        email: body.email ?? null,
        name: body.name ?? null,
        notes: body.notes ?? null,
        is_watchlisted: body.is_watchlisted ?? false,
        risk_score: 0,
        created_by: userId,
      })
      .returning()
    await db.insert(audit_events).values({
      workspace_id: body.workspace_id,
      actor: userId,
      action: 'customer.create',
      entity_type: 'customer',
      entity_id: customer.id,
      detail: { external_ref: customer.external_ref },
    })
    return c.json(customer, 201)
  } catch {
    return c.json({ error: 'Customer with this external_ref already exists in this workspace' }, 409)
  }
})

// Update notes/risk/details (auth + membership).
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(customers).where(eq(customers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  if (Object.keys(body).length === 0) return c.json({ error: 'Nothing to update' }, 400)
  const [updated] = await db.update(customers).set(body).where(eq(customers.id, id)).returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'customer.update',
    entity_type: 'customer',
    entity_id: id,
    detail: { fields: Object.keys(body) },
  })
  return c.json(updated)
})

// Toggle watchlist (auth + membership).
router.post('/:id/watchlist', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(customers).where(eq(customers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const next = !existing.is_watchlisted
  const [updated] = await db
    .update(customers)
    .set({ is_watchlisted: next })
    .where(eq(customers.id, id))
    .returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'customer.watchlist_toggle',
    entity_type: 'customer',
    entity_id: id,
    detail: { is_watchlisted: next },
  })
  return c.json(updated)
})

export default router
