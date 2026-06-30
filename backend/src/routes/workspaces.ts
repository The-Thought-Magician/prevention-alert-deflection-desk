import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  thresholds,
  feed_connections,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── helpers ────────────────────────────────────────────────────────────────

function genInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase()
}

async function membership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m
}

// Seed default VDMP/ECP thresholds + sample-mode feeds for a brand-new workspace.
const DEFAULT_THRESHOLDS = [
  { program: 'VDMP', network: 'visa_rdr', standard_ratio: 0.009, excessive_ratio: 0.018, standard_count: 100, fine_per_dispute_cents: 1000, sla_window_hours: 72 },
  { program: 'ECP', network: 'visa_rdr', standard_ratio: 0.0075, excessive_ratio: 0.01, standard_count: 100, fine_per_dispute_cents: 5000, sla_window_hours: 72 },
  { program: 'VDMP', network: 'all', standard_ratio: 0.009, excessive_ratio: 0.018, standard_count: 100, fine_per_dispute_cents: 1000, sla_window_hours: 72 },
]

const DEFAULT_FEEDS = [
  { network: 'ethoca', display_name: 'Mastercard Ethoca Alerts' },
  { network: 'verifi_cdrn', display_name: 'Verifi CDRN' },
  { network: 'visa_rdr', display_name: 'Visa Rapid Dispute Resolution' },
]

async function seedDefaults(workspaceId: string, userId: string) {
  for (const t of DEFAULT_THRESHOLDS) {
    await db
      .insert(thresholds)
      .values({ ...t, workspace_id: workspaceId })
      .onConflictDoNothing()
  }
  for (const f of DEFAULT_FEEDS) {
    await db
      .insert(feed_connections)
      .values({
        workspace_id: workspaceId,
        network: f.network,
        display_name: f.display_name,
        is_enabled: false,
        is_sample_mode: true,
        status: 'disconnected',
        created_by: userId,
      })
      .onConflictDoNothing()
  }
}

// ── schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1),
  default_currency: z.string().min(1).optional().default('USD'),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  default_currency: z.string().min(1).optional(),
})

const joinSchema = z.object({
  invite_code: z.string().min(1),
})

// ── routes ───────────────────────────────────────────────────────────────────

// List workspaces the authenticated user is a member of.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select({ ws: workspaces, role: workspace_members.role })
    .from(workspace_members)
    .innerJoin(workspaces, eq(workspace_members.workspace_id, workspaces.id))
    .where(eq(workspace_members.user_id, userId))
  return c.json(rows.map((r) => ({ ...r.ws, role: r.role })))
})

// Create a workspace; creator auto-added as owner; defaults seeded.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let invite_code = genInviteCode()
  // Avoid the (rare) unique collision.
  for (let i = 0; i < 5; i++) {
    const [clash] = await db.select().from(workspaces).where(eq(workspaces.invite_code, invite_code))
    if (!clash) break
    invite_code = genInviteCode()
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      invite_code,
      default_currency: body.default_currency ?? 'USD',
      created_by: userId,
    })
    .returning()

  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })

  await seedDefaults(ws.id, userId)

  return c.json(ws, 201)
})

// Get one workspace (membership required).
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const m = await membership(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json({ ...ws, role: m.role })
})

// Update name/currency (owner only).
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const m = await membership(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  if (m.role !== 'owner') return c.json({ error: 'Only the owner can update the workspace' }, 403)
  const body = c.req.valid('json')
  if (Object.keys(body).length === 0) return c.json({ error: 'Nothing to update' }, 400)
  const [updated] = await db.update(workspaces).set(body).where(eq(workspaces.id, id)).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

// Join a workspace by invite code.
router.post('/join', authMiddleware, zValidator('json', joinSchema), async (c) => {
  const userId = getUserId(c)
  const { invite_code } = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.invite_code, invite_code))
  if (!ws) return c.json({ error: 'Invalid invite code' }, 404)

  const existing = await membership(ws.id, userId)
  if (existing) return c.json({ workspace: ws, membership: existing })

  const [membershipRow] = await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: userId, role: 'member' })
    .returning()

  return c.json({ workspace: ws, membership: membershipRow }, 201)
})

// List members (membership required).
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const m = await membership(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(workspace_members.joined_at)
  return c.json(members)
})

// Remove a member (owner only; cannot remove last owner).
router.delete('/:id/members/:userId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const target = c.req.param('userId')
  const m = await membership(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  if (m.role !== 'owner') return c.json({ error: 'Only the owner can remove members' }, 403)

  const targetMembership = await membership(id, target)
  if (!targetMembership) return c.json({ error: 'Member not found' }, 404)

  // Guard against removing the last owner.
  if (targetMembership.role === 'owner') {
    const owners = await db
      .select()
      .from(workspace_members)
      .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.role, 'owner')))
    if (owners.length <= 1) return c.json({ error: 'Cannot remove the last owner' }, 400)
  }

  await db
    .delete(workspace_members)
    .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.user_id, target)))

  return c.json({ success: true })
})

export default router
