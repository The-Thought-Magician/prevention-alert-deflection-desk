import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  alerts,
  orders,
  decisions,
  audit_events,
  workspace_members,
  thresholds,
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

const VALID_STATUSES = [
  'new',
  'triaging',
  'decided',
  'action_pending',
  'deflected',
  'represented',
  'lapsed_to_chargeback',
] as const

// Default deflection SLA per network (hours) when no threshold row applies.
const DEFAULT_SLA_HOURS: Record<string, number> = {
  ethoca: 24,
  verifi_cdrn: 72,
  visa_rdr: 24,
}

async function computeDeadline(
  workspaceId: string,
  network: string,
  receivedAt: Date,
): Promise<Date> {
  let slaHours = DEFAULT_SLA_HOURS[network] ?? 72
  try {
    const rows = await db
      .select()
      .from(thresholds)
      .where(and(eq(thresholds.workspace_id, workspaceId), eq(thresholds.network, network)))
    const withSla = rows.find((r) => typeof r.sla_window_hours === 'number' && r.sla_window_hours! > 0)
    if (withSla?.sla_window_hours) slaHours = withSla.sla_window_hours
  } catch {
    // fall back to default
  }
  return new Date(receivedAt.getTime() + slaHours * 3_600_000)
}

// Auto-match an order by ARN, then by card_last4 + amount within the workspace.
async function matchOrder(
  workspaceId: string,
  arn: string | null | undefined,
  cardLast4: string | null | undefined,
  amountCents: number,
): Promise<typeof orders.$inferSelect | undefined> {
  if (arn) {
    const [byArn] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspace_id, workspaceId), eq(orders.arn, arn)))
    if (byArn) return byArn
  }
  if (cardLast4) {
    const candidates = await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspace_id, workspaceId), eq(orders.card_last4, cardLast4)))
    const exact = candidates.find((o) => o.amount_cents === amountCents)
    if (exact) return exact
    if (candidates.length === 1) return candidates[0]
  }
  return undefined
}

// Detect a duplicate alert: same workspace + network + external_alert_id, or
// same arn + amount + network already present.
async function findDuplicate(
  workspaceId: string,
  network: string,
  externalAlertId: string | null | undefined,
  arn: string | null | undefined,
  amountCents: number,
): Promise<typeof alerts.$inferSelect | undefined> {
  const existing = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspace_id, workspaceId), eq(alerts.network, network)))
  if (externalAlertId) {
    const byExt = existing.find((a) => a.external_alert_id && a.external_alert_id === externalAlertId)
    if (byExt) return byExt
  }
  if (arn) {
    const byArn = existing.find((a) => a.arn === arn && a.amount_cents === amountCents)
    if (byArn) return byArn
  }
  return undefined
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
      entity_type: 'alert',
      entity_id: entityId,
      detail,
    })
  } catch {
    // audit failures must not break the request
  }
}

// ── GET / — list alerts with filters ────────────────────────────────────────

router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const network = c.req.query('network')
  const status = c.req.query('status')
  const reason = c.req.query('reason')
  const urgency = c.req.query('urgency') // critical | warning | safe

  const conds = [eq(alerts.workspace_id, workspaceId)]
  if (network) conds.push(eq(alerts.network, network))
  if (status) conds.push(eq(alerts.status, status))
  if (reason) conds.push(eq(alerts.reason_category, reason))

  let rows = await db
    .select()
    .from(alerts)
    .where(and(...conds))
    .orderBy(desc(alerts.received_at))

  if (urgency) {
    const now = Date.now()
    rows = rows.filter((a) => {
      if (!a.deadline_at) return urgency === 'safe'
      const msLeft = new Date(a.deadline_at).getTime() - now
      const hoursLeft = msLeft / 3_600_000
      if (urgency === 'critical') return hoursLeft <= 6
      if (urgency === 'warning') return hoursLeft > 6 && hoursLeft <= 24
      if (urgency === 'safe') return hoursLeft > 24
      return true
    })
  }

  return c.json(rows)
})

// ── GET /:id — detail incl. decision, order, audit ───────────────────────────

router.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [alert] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!alert) return c.json({ error: 'Not found' }, 404)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(alert.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [decision] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.alert_id, id))
    .orderBy(desc(decisions.created_at))
    .limit(1)

  let order: typeof orders.$inferSelect | null = null
  if (alert.order_id) {
    const [o] = await db.select().from(orders).where(eq(orders.id, alert.order_id))
    order = o ?? null
  }

  const audit = await db
    .select()
    .from(audit_events)
    .where(and(eq(audit_events.entity_type, 'alert'), eq(audit_events.entity_id, id)))
    .orderBy(desc(audit_events.created_at))

  return c.json({ alert, decision: decision ?? null, order, audit })
})

// ── POST / — create alert (auto-match, deadline, dedupe) ─────────────────────

const createSchema = z.object({
  workspace_id: z.string().min(1),
  network: z.string().min(1),
  alert_type: z.string().min(1).default('pre_dispute'),
  external_alert_id: z.string().optional(),
  arn: z.string().optional(),
  card_last4: z.string().optional(),
  amount_cents: z.number().int(),
  currency: z.string().optional().default('USD'),
  reason_code: z.string().optional(),
  reason_category: z.string().optional(),
  customer_id: z.string().optional(),
  order_id: z.string().optional(),
  received_at: z.string().optional(),
  raw_payload: z.record(z.unknown()).optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const receivedAt = body.received_at ? new Date(body.received_at) : new Date()

  // Auto-match order if not supplied.
  let orderId = body.order_id ?? null
  let customerId = body.customer_id ?? null
  if (!orderId) {
    const matched = await matchOrder(body.workspace_id, body.arn, body.card_last4, body.amount_cents)
    if (matched) {
      orderId = matched.id
      if (!customerId && matched.customer_id) customerId = matched.customer_id
    }
  }

  // Dedupe detection.
  const dup = await findDuplicate(
    body.workspace_id,
    body.network,
    body.external_alert_id,
    body.arn,
    body.amount_cents,
  )

  const deadlineAt = await computeDeadline(body.workspace_id, body.network, receivedAt)

  const [created] = await db
    .insert(alerts)
    .values({
      workspace_id: body.workspace_id,
      order_id: orderId,
      customer_id: customerId,
      network: body.network,
      alert_type: body.alert_type,
      external_alert_id: body.external_alert_id ?? null,
      arn: body.arn ?? null,
      card_last4: body.card_last4 ?? null,
      amount_cents: body.amount_cents,
      currency: body.currency,
      reason_code: body.reason_code ?? null,
      reason_category: body.reason_category ?? null,
      status: 'new',
      received_at: receivedAt,
      deadline_at: deadlineAt,
      is_duplicate: !!dup,
      raw_payload: body.raw_payload ?? {},
      created_by: userId,
    })
    .returning()

  await logAudit(body.workspace_id, userId, 'alert.create', created.id, {
    matched_order: orderId,
    is_duplicate: !!dup,
    duplicate_of: dup?.id ?? null,
  })

  return c.json(created, 201)
})

// ── PUT /:id/status — transition status ──────────────────────────────────────

const statusSchema = z.object({ status: z.enum(VALID_STATUSES) })

router.put('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db.update(alerts).set({ status }).where(eq(alerts.id, id)).returning()
  await logAudit(existing.workspace_id, userId, 'alert.status', id, {
    from: existing.status,
    to: status,
  })
  return c.json(updated)
})

// ── POST /bulk — bulk upload alerts ──────────────────────────────────────────

const bulkSchema = z.object({
  workspace_id: z.string().min(1),
  rows: z
    .array(
      z.object({
        network: z.string().min(1),
        alert_type: z.string().optional(),
        external_alert_id: z.string().optional(),
        arn: z.string().optional(),
        card_last4: z.string().optional(),
        amount_cents: z.number().int(),
        currency: z.string().optional(),
        reason_code: z.string().optional(),
        reason_category: z.string().optional(),
        received_at: z.string().optional(),
      }),
    )
    .min(1),
})

router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  let created = 0
  for (const row of rows) {
    const receivedAt = row.received_at ? new Date(row.received_at) : new Date()
    const matched = await matchOrder(workspace_id, row.arn, row.card_last4, row.amount_cents)
    const dup = await findDuplicate(
      workspace_id,
      row.network,
      row.external_alert_id,
      row.arn,
      row.amount_cents,
    )
    const deadlineAt = await computeDeadline(workspace_id, row.network, receivedAt)
    await db.insert(alerts).values({
      workspace_id,
      order_id: matched?.id ?? null,
      customer_id: matched?.customer_id ?? null,
      network: row.network,
      alert_type: row.alert_type ?? 'pre_dispute',
      external_alert_id: row.external_alert_id ?? null,
      arn: row.arn ?? null,
      card_last4: row.card_last4 ?? null,
      amount_cents: row.amount_cents,
      currency: row.currency ?? 'USD',
      reason_code: row.reason_code ?? null,
      reason_category: row.reason_category ?? null,
      status: 'new',
      received_at: receivedAt,
      deadline_at: deadlineAt,
      is_duplicate: !!dup,
      raw_payload: {},
      created_by: userId,
    })
    created++
  }

  await logAudit(workspace_id, userId, 'alert.bulk_upload', 'bulk', { created })
  return c.json({ created })
})

// ── POST /:id/dedupe — mark/unmark duplicate ─────────────────────────────────

const dedupeSchema = z.object({ is_duplicate: z.boolean() })

router.post('/:id/dedupe', authMiddleware, zValidator('json', dedupeSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { is_duplicate } = c.req.valid('json')

  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(alerts)
    .set({ is_duplicate })
    .where(eq(alerts.id, id))
    .returning()
  await logAudit(existing.workspace_id, userId, 'alert.dedupe', id, { is_duplicate })
  return c.json(updated)
})

export default router
