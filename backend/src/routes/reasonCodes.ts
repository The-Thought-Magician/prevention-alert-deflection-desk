import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { reason_codes, alerts, audit_events } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const reasonCodeSchema = z.object({
  workspace_id: z.string().min(1),
  network: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  typical_deflectability: z.number().min(0).max(1).optional(),
  recommended_handling: z.string().optional(),
})

const reasonCodeUpdateSchema = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  typical_deflectability: z.number().min(0).max(1).optional(),
  recommended_handling: z.string().optional(),
})

// Alert statuses that count as a deflection vs a chargeback/representment outcome.
const DEFLECTED_STATUSES = new Set(['deflected'])
const LAPSED_STATUSES = new Set(['lapsed_to_chargeback'])
const REPRESENTED_STATUSES = new Set(['represented'])

// ── Routes ──────────────────────────────────────────────────────────────────

// Public: list reason codes for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(reason_codes)
    .where(eq(reason_codes.workspace_id, workspaceId))
    .orderBy(reason_codes.network, reason_codes.code)
  return c.json(rows)
})

// Public: per-reason-code alert counts / dispositions
router.get('/stats', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const codes = await db
    .select()
    .from(reason_codes)
    .where(eq(reason_codes.workspace_id, workspaceId))
  const wsAlerts = await db.select().from(alerts).where(eq(alerts.workspace_id, workspaceId))

  // Aggregate alert dispositions keyed by network|code.
  type Bucket = {
    network: string
    code: string
    category: string | null
    description: string | null
    typical_deflectability: number | null
    recommended_handling: string | null
    total: number
    deflected: number
    represented: number
    lapsed: number
    open: number
    total_amount_cents: number
    deflected_amount_cents: number
  }
  const buckets = new Map<string, Bucket>()

  const keyOf = (network: string, code: string) => `${network}::${code}`

  // Seed buckets from the library so codes with zero alerts still appear.
  for (const rc of codes) {
    buckets.set(keyOf(rc.network, rc.code), {
      network: rc.network,
      code: rc.code,
      category: rc.category,
      description: rc.description,
      typical_deflectability: rc.typical_deflectability ?? 0,
      recommended_handling: rc.recommended_handling,
      total: 0,
      deflected: 0,
      represented: 0,
      lapsed: 0,
      open: 0,
      total_amount_cents: 0,
      deflected_amount_cents: 0,
    })
  }

  for (const a of wsAlerts) {
    if (!a.reason_code) continue
    const key = keyOf(a.network, a.reason_code)
    let b = buckets.get(key)
    if (!b) {
      // Alert references a code not in the library; include it with nulls.
      b = {
        network: a.network,
        code: a.reason_code,
        category: a.reason_category,
        description: null,
        typical_deflectability: null,
        recommended_handling: null,
        total: 0,
        deflected: 0,
        represented: 0,
        lapsed: 0,
        open: 0,
        total_amount_cents: 0,
        deflected_amount_cents: 0,
      }
      buckets.set(key, b)
    }
    b.total += 1
    b.total_amount_cents += a.amount_cents
    if (DEFLECTED_STATUSES.has(a.status)) {
      b.deflected += 1
      b.deflected_amount_cents += a.amount_cents
    } else if (REPRESENTED_STATUSES.has(a.status)) {
      b.represented += 1
    } else if (LAPSED_STATUSES.has(a.status)) {
      b.lapsed += 1
    } else {
      b.open += 1
    }
  }

  const stats = [...buckets.values()]
    .map((b) => ({
      ...b,
      actual_deflection_rate: b.total > 0 ? Math.round((b.deflected / b.total) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.total - a.total || a.network.localeCompare(b.network) || a.code.localeCompare(b.code))

  return c.json(stats)
})

// Auth: create reason code
router.post('/', authMiddleware, zValidator('json', reasonCodeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Enforce uniqueness on (workspace_id, network, code).
  const [dup] = await db
    .select()
    .from(reason_codes)
    .where(
      and(
        eq(reason_codes.workspace_id, body.workspace_id),
        eq(reason_codes.network, body.network),
        eq(reason_codes.code, body.code),
      ),
    )
  if (dup) return c.json({ error: 'Reason code already exists for this network' }, 409)

  const [rc] = await db
    .insert(reason_codes)
    .values({
      workspace_id: body.workspace_id,
      network: body.network,
      code: body.code,
      description: body.description ?? null,
      category: body.category ?? null,
      typical_deflectability: body.typical_deflectability ?? 0,
      recommended_handling: body.recommended_handling ?? null,
    })
    .returning()
  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'reason_code.create',
    entity_type: 'reason_code',
    entity_id: rc.id,
    detail: { network: rc.network, code: rc.code },
  })
  return c.json(rc, 201)
})

// Auth: update reason code (workspace-scoped)
router.put('/:id', authMiddleware, zValidator('json', reasonCodeUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reason_codes).where(eq(reason_codes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(reason_codes)
    .set(body)
    .where(eq(reason_codes.id, id))
    .returning()
  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'reason_code.update',
    entity_type: 'reason_code',
    entity_id: id,
    detail: { changes: body },
  })
  return c.json(updated)
})

export default router
