import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { thresholds, workspace_members, audit_events } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── Helpers ──────────────────────────────────────────────────────────────

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// ── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z.object({
  workspace_id: z.string().min(1),
  program: z.enum(['VDMP', 'ECP']),
  network: z.string().min(1),
  standard_ratio: z.number().min(0),
  excessive_ratio: z.number().min(0),
  standard_count: z.number().int().min(0).optional(),
  fine_per_dispute_cents: z.number().int().min(0).optional(),
  sla_window_hours: z.number().int().min(0).optional(),
})

const updateSchema = z.object({
  program: z.enum(['VDMP', 'ECP']).optional(),
  network: z.string().min(1).optional(),
  standard_ratio: z.number().min(0).optional(),
  excessive_ratio: z.number().min(0).optional(),
  standard_count: z.number().int().min(0).optional(),
  fine_per_dispute_cents: z.number().int().min(0).optional(),
  sla_window_hours: z.number().int().min(0).optional(),
})

// ── GET / — public: thresholds for a workspace ─────────────────────────────

router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(thresholds)
    .where(eq(thresholds.workspace_id, workspaceId))
    .orderBy(thresholds.program, thresholds.network)
  return c.json(rows)
})

// ── POST / — auth: create a threshold ──────────────────────────────────────

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Enforce the (workspace, program, network) uniqueness with a clear error.
  const [dupe] = await db
    .select()
    .from(thresholds)
    .where(
      and(
        eq(thresholds.workspace_id, body.workspace_id),
        eq(thresholds.program, body.program),
        eq(thresholds.network, body.network),
      ),
    )
  if (dupe) {
    return c.json(
      { error: 'A threshold for this program and network already exists' },
      409,
    )
  }

  const [created] = await db
    .insert(thresholds)
    .values({
      workspace_id: body.workspace_id,
      program: body.program,
      network: body.network,
      standard_ratio: body.standard_ratio,
      excessive_ratio: body.excessive_ratio,
      standard_count: body.standard_count ?? 0,
      fine_per_dispute_cents: body.fine_per_dispute_cents ?? 0,
      sla_window_hours: body.sla_window_hours ?? 72,
    })
    .returning()

  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'threshold.create',
    entity_type: 'threshold',
    entity_id: created.id,
    detail: { program: body.program, network: body.network },
  })

  return c.json(created, 201)
})

// ── PUT /:id — auth: update threshold values ───────────────────────────────

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(thresholds)
    .where(eq(thresholds.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const patch: Record<string, unknown> = {}
  if (body.program !== undefined) patch.program = body.program
  if (body.network !== undefined) patch.network = body.network
  if (body.standard_ratio !== undefined) patch.standard_ratio = body.standard_ratio
  if (body.excessive_ratio !== undefined) patch.excessive_ratio = body.excessive_ratio
  if (body.standard_count !== undefined) patch.standard_count = body.standard_count
  if (body.fine_per_dispute_cents !== undefined)
    patch.fine_per_dispute_cents = body.fine_per_dispute_cents
  if (body.sla_window_hours !== undefined) patch.sla_window_hours = body.sla_window_hours

  if (Object.keys(patch).length === 0) {
    return c.json(existing)
  }

  // If program/network changed, guard the composite uniqueness.
  if (body.program !== undefined || body.network !== undefined) {
    const program = body.program ?? existing.program
    const network = body.network ?? existing.network
    const [dupe] = await db
      .select()
      .from(thresholds)
      .where(
        and(
          eq(thresholds.workspace_id, existing.workspace_id),
          eq(thresholds.program, program),
          eq(thresholds.network, network),
        ),
      )
    if (dupe && dupe.id !== id) {
      return c.json(
        { error: 'A threshold for this program and network already exists' },
        409,
      )
    }
  }

  const [updated] = await db
    .update(thresholds)
    .set(patch)
    .where(eq(thresholds.id, id))
    .returning()

  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'threshold.update',
    entity_type: 'threshold',
    entity_id: id,
    detail: patch,
  })

  return c.json(updated)
})

export default router
