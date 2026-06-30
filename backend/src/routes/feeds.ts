import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  feed_connections,
  workspace_members,
  alerts,
  audit_events,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── Constants ──────────────────────────────────────────────────────────────

const NETWORKS = ['ethoca', 'verifi_cdrn', 'visa_rdr'] as const
type Network = (typeof NETWORKS)[number]

const NETWORK_DISPLAY: Record<Network, string> = {
  ethoca: 'Ethoca',
  verifi_cdrn: 'Verifi CDRN',
  visa_rdr: 'Visa RDR',
}

const NETWORK_ALERT_TYPE: Record<Network, string> = {
  ethoca: 'fraud',
  verifi_cdrn: 'dispute',
  visa_rdr: 'dispute',
}

// Representative reason codes per network used when generating sample alerts.
const SAMPLE_REASONS: Record<Network, Array<{ code: string; category: string }>> = {
  ethoca: [
    { code: 'EFM', category: 'fraud' },
    { code: 'EFR', category: 'friendly_fraud' },
  ],
  verifi_cdrn: [
    { code: '10.4', category: 'fraud' },
    { code: '13.1', category: 'product_not_received' },
    { code: '13.2', category: 'subscription' },
  ],
  visa_rdr: [
    { code: '10.4', category: 'fraud' },
    { code: '13.7', category: 'processing_error' },
  ],
}

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

function randLast4(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function randArn(): string {
  let s = ''
  for (let i = 0; i < 23; i++) s += Math.floor(Math.random() * 10)
  return s
}

// ── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z.object({
  workspace_id: z.string().min(1),
  network: z.enum(NETWORKS),
  display_name: z.string().min(1).optional(),
  endpoint: z.string().optional(),
  is_enabled: z.boolean().optional(),
  is_sample_mode: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
})

const updateSchema = z.object({
  display_name: z.string().min(1).optional(),
  endpoint: z.string().nullable().optional(),
  is_enabled: z.boolean().optional(),
  is_sample_mode: z.boolean().optional(),
  status: z.string().optional(),
  config: z.record(z.unknown()).optional(),
})

// ── GET / — public: list feed connections for a workspace ──────────────────

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(feed_connections)
    .where(eq(feed_connections.workspace_id, workspaceId))
    .orderBy(feed_connections.network)
  return c.json(rows)
})

// ── POST / — auth: create / configure (upsert) a feed connection ───────────

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const network = body.network as Network
  const displayName = body.display_name ?? NETWORK_DISPLAY[network]

  const [existing] = await db
    .select()
    .from(feed_connections)
    .where(
      and(
        eq(feed_connections.workspace_id, body.workspace_id),
        eq(feed_connections.network, network),
      ),
    )

  let feed
  if (existing) {
    const [updated] = await db
      .update(feed_connections)
      .set({
        display_name: displayName,
        endpoint: body.endpoint ?? existing.endpoint,
        is_enabled: body.is_enabled ?? existing.is_enabled,
        is_sample_mode: body.is_sample_mode ?? existing.is_sample_mode,
        config: (body.config ?? existing.config) as Record<string, unknown>,
        status: body.is_enabled === false ? 'disconnected' : existing.status,
      })
      .where(eq(feed_connections.id, existing.id))
      .returning()
    feed = updated
  } else {
    const [created] = await db
      .insert(feed_connections)
      .values({
        workspace_id: body.workspace_id,
        network,
        display_name: displayName,
        endpoint: body.endpoint ?? null,
        is_enabled: body.is_enabled ?? false,
        is_sample_mode: body.is_sample_mode ?? true,
        status: body.is_enabled ? 'connected' : 'disconnected',
        config: (body.config ?? {}) as Record<string, unknown>,
        created_by: userId,
      })
      .returning()
    feed = created
  }

  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: existing ? 'feed.update' : 'feed.create',
    entity_type: 'feed_connection',
    entity_id: feed.id,
    detail: { network, display_name: displayName },
  })

  return c.json(feed, existing ? 200 : 201)
})

// ── PUT /:id — auth: update (enable/disable, sample-mode, config) ───────────

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(feed_connections)
    .where(eq(feed_connections.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const patch: Record<string, unknown> = {}
  if (body.display_name !== undefined) patch.display_name = body.display_name
  if (body.endpoint !== undefined) patch.endpoint = body.endpoint
  if (body.is_enabled !== undefined) {
    patch.is_enabled = body.is_enabled
    if (!body.is_enabled) patch.status = 'disconnected'
    else if (existing.status === 'disconnected') patch.status = 'connected'
  }
  if (body.is_sample_mode !== undefined) patch.is_sample_mode = body.is_sample_mode
  if (body.status !== undefined) patch.status = body.status
  if (body.config !== undefined) patch.config = body.config

  const [updated] = await db
    .update(feed_connections)
    .set(patch)
    .where(eq(feed_connections.id, id))
    .returning()

  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    actor: userId,
    action: 'feed.update',
    entity_type: 'feed_connection',
    entity_id: id,
    detail: patch,
  })

  return c.json(updated)
})

// ── POST /:id/sync — auth: sample sync; generate sample alerts + health ────

router.post('/:id/sync', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [feed] = await db
    .select()
    .from(feed_connections)
    .where(eq(feed_connections.id, id))
  if (!feed) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(feed.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const network = feed.network as Network
  const reasons = SAMPLE_REASONS[network] ?? SAMPLE_REASONS.ethoca
  const slaHours = network === 'ethoca' ? 24 : 72

  // Generate a small batch of sample alerts for this network.
  const count = 3 + Math.floor(Math.random() * 5) // 3..7
  const now = Date.now()
  const generated: Array<typeof alerts.$inferInsert> = []
  for (let i = 0; i < count; i++) {
    const r = reasons[Math.floor(Math.random() * reasons.length)]
    const receivedAt = new Date(now - Math.floor(Math.random() * 6 * 3600_000))
    const deadlineAt = new Date(receivedAt.getTime() + slaHours * 3600_000)
    generated.push({
      workspace_id: feed.workspace_id,
      network,
      alert_type: NETWORK_ALERT_TYPE[network],
      external_alert_id: `${network}-${now}-${i}`,
      arn: randArn(),
      card_last4: randLast4(),
      amount_cents: (5 + Math.floor(Math.random() * 495)) * 100,
      currency: 'USD',
      reason_code: r.code,
      reason_category: r.category,
      status: 'new',
      received_at: receivedAt,
      deadline_at: deadlineAt,
      raw_payload: { source: 'sample_sync', network, generated_at: new Date(now).toISOString() },
      created_by: userId,
    })
  }

  const inserted = await db.insert(alerts).values(generated).returning()

  const [updatedFeed] = await db
    .update(feed_connections)
    .set({
      status: 'connected',
      last_sync_at: new Date(),
      alert_volume: feed.alert_volume + inserted.length,
      is_enabled: true,
    })
    .where(eq(feed_connections.id, id))
    .returning()

  await db.insert(audit_events).values({
    workspace_id: feed.workspace_id,
    actor: userId,
    action: 'feed.sync',
    entity_type: 'feed_connection',
    entity_id: id,
    detail: { synced: inserted.length, network },
  })

  return c.json({ synced: inserted.length, feed: updatedFeed, alerts: inserted })
})

export default router
