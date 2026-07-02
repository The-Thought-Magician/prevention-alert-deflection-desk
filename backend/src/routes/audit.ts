import { Hono } from 'hono'
import { db } from '../db/index.js'
import { audit_events, workspace_members } from '../db/schema.js'
import { and, eq, desc, gte, lte, type SQL } from 'drizzle-orm'
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

// GET / — immutable audit event log for a workspace, newest first, filterable.
// Auth required. Required: ?workspace_id=.
// Optional filters: actor, entity_type, entity_id, action, from (ISO), to (ISO),
// and limit (default 200, max 1000).
router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const actor = c.req.query('actor')
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const action = c.req.query('action')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const limitRaw = parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200

  const conditions: SQL[] = [eq(audit_events.workspace_id, workspaceId)]
  if (actor) conditions.push(eq(audit_events.actor, actor))
  if (entityType) conditions.push(eq(audit_events.entity_type, entityType))
  if (entityId) conditions.push(eq(audit_events.entity_id, entityId))
  if (action) conditions.push(eq(audit_events.action, action))

  if (from) {
    const d = new Date(from)
    if (!isNaN(d.getTime())) conditions.push(gte(audit_events.created_at, d))
  }
  if (to) {
    const d = new Date(to)
    if (!isNaN(d.getTime())) conditions.push(lte(audit_events.created_at, d))
  }

  const rows = await db
    .select()
    .from(audit_events)
    .where(and(...conditions))
    .orderBy(desc(audit_events.created_at))
    .limit(limit)

  return c.json(rows)
})

export default router
