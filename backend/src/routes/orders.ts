import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { orders, alerts, refunds, workspace_members, audit_events } from '../db/schema.js'
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

// ── schemas ──────────────────────────────────────────────────────────────────

const orderSchema = z.object({
  workspace_id: z.string().min(1),
  customer_id: z.string().min(1).nullable().optional(),
  external_order_id: z.string().min(1),
  arn: z.string().nullable().optional(),
  card_last4: z.string().nullable().optional(),
  amount_cents: z.number().int(),
  currency: z.string().min(1).optional().default('USD'),
  margin_cents: z.number().int().optional().default(0),
  product: z.string().nullable().optional(),
  recoverable: z.boolean().optional().default(false),
  refundable: z.boolean().optional().default(true),
  captured_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
})

const orderUpdateSchema = orderSchema.partial().omit({ workspace_id: true })

const bulkSchema = z.object({
  workspace_id: z.string().min(1),
  rows: z.array(orderSchema.omit({ workspace_id: true })).min(1),
})

function toRow(body: z.infer<typeof orderSchema>, userId: string) {
  return {
    workspace_id: body.workspace_id,
    customer_id: body.customer_id ?? null,
    external_order_id: body.external_order_id,
    arn: body.arn ?? null,
    card_last4: body.card_last4 ?? null,
    amount_cents: body.amount_cents,
    currency: body.currency ?? 'USD',
    margin_cents: body.margin_cents ?? 0,
    product: body.product ?? null,
    recoverable: body.recoverable ?? false,
    refundable: body.refundable ?? true,
    captured_at: body.captured_at ? new Date(body.captured_at) : null,
    metadata: (body.metadata ?? {}) as Record<string, unknown>,
    created_by: userId,
  }
}

// ── routes ───────────────────────────────────────────────────────────────────

// Auth: list orders for a workspace.
router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.workspace_id, workspaceId))
    .orderBy(desc(orders.created_at))
  return c.json(rows)
})

// Auth: order detail with linked alerts + refunds.
router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [order] = await db.select().from(orders).where(eq(orders.id, id))
  if (!order) return c.json({ error: 'Not found' }, 404)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(order.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const linkedAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.order_id, id))
    .orderBy(desc(alerts.received_at))
  const linkedRefunds = await db
    .select()
    .from(refunds)
    .where(eq(refunds.order_id, id))
    .orderBy(desc(refunds.created_at))
  return c.json({ order, alerts: linkedAlerts, refunds: linkedRefunds })
})

// Create an order (auth + membership).
router.post('/', authMiddleware, zValidator('json', orderSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  try {
    const [order] = await db.insert(orders).values(toRow(body, userId)).returning()
    await db.insert(audit_events).values({
      workspace_id: body.workspace_id,
      actor: userId,
      action: 'order.create',
      entity_type: 'order',
      entity_id: order.id,
      detail: { external_order_id: order.external_order_id, amount_cents: order.amount_cents },
    })
    return c.json(order, 201)
  } catch (e) {
    return c.json({ error: 'Order with this external_order_id already exists in this workspace' }, 409)
  }
})

// Update an order (auth + membership).
router.put('/:id', authMiddleware, zValidator('json', orderUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(orders).where(eq(orders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  if (Object.keys(body).length === 0) return c.json({ error: 'Nothing to update' }, 400)
  const patch: Record<string, unknown> = { ...body }
  if (body.captured_at !== undefined) patch.captured_at = body.captured_at ? new Date(body.captured_at) : null
  const [updated] = await db.update(orders).set(patch).where(eq(orders.id, id)).returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'order.update',
    entity_type: 'order',
    entity_id: id,
    detail: { fields: Object.keys(body) },
  })
  return c.json(updated)
})

// Delete an order (auth + membership).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(orders).where(eq(orders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(orders).where(eq(orders.id, id))
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'order.delete',
    entity_type: 'order',
    entity_id: id,
    detail: { external_order_id: existing.external_order_id },
  })
  return c.json({ success: true })
})

// Bulk create from a rows array (auth + membership).
router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  let created = 0
  for (const r of rows) {
    try {
      await db
        .insert(orders)
        .values(toRow({ ...r, workspace_id }, userId))
        .onConflictDoNothing()
        .returning()
      created++
    } catch {
      // skip rows that violate constraints, keep importing the rest
    }
  }
  await db.insert(audit_events).values({
    workspace_id,
    actor: userId,
    action: 'order.bulk_create',
    entity_type: 'order',
    entity_id: null,
    detail: { submitted: rows.length, created },
  })
  return c.json({ created })
})

export default router
