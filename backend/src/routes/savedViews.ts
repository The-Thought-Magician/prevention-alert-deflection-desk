import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views, workspace_members, audit_events } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Verify the user is a member of the workspace.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
})

// GET / — current user's saved views for a workspace.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const views = await db
    .select()
    .from(saved_views)
    .where(and(eq(saved_views.workspace_id, workspaceId), eq(saved_views.user_id, userId)))
    .orderBy(desc(saved_views.created_at))
  return c.json(views)
})

// POST / — create a saved view.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [view] = await db
    .insert(saved_views)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      filters: body.filters as Record<string, unknown>,
    })
    .returning()

  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'saved_view.create',
    entity_type: 'saved_view',
    entity_id: view.id,
    detail: { name: view.name },
  })

  return c.json(view, 201)
})

// DELETE /:id — delete a saved view (owner only).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(saved_views).where(eq(saved_views.id, id))

  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'saved_view.delete',
    entity_type: 'saved_view',
    entity_id: id,
    detail: { name: existing.name },
  })

  return c.json({ success: true })
})

export default router
