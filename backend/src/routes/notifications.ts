import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { and, eq, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Every notifications endpoint is per-user and auth-gated.
router.use('*', authMiddleware)

// GET / — current user's notifications for a workspace, newest first.
// Requires ?workspace_id=.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.workspace_id, workspaceId), eq(notifications.user_id, userId)))
    .orderBy(desc(notifications.created_at))

  return c.json(rows)
})

// POST /:id/read — mark one notification read (must belong to the user).
router.post('/:id/read', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()

  return c.json(updated)
})

// POST /read-all — mark all of the user's notifications in a workspace read.
// Body: { workspace_id }.
router.post('/read-all', async (c) => {
  const userId = getUserId(c)
  let body: { workspace_id?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const workspaceId = body.workspace_id ?? c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const updated = await db
    .update(notifications)
    .set({ is_read: true })
    .where(
      and(
        eq(notifications.workspace_id, workspaceId),
        eq(notifications.user_id, userId),
        eq(notifications.is_read, false),
      ),
    )
    .returning()

  return c.json({ updated: updated.length })
})

export default router
