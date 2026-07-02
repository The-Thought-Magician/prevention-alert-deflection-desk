import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  ratio_snapshots,
  alerts,
  orders,
  thresholds,
  workspace_members,
  audit_events,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const NETWORKS = ['ethoca', 'verifi_cdrn', 'visa_rdr'] as const

// Statuses that represent a realized chargeback against the merchant.
const CHARGEBACK_STATUSES = new Set(['lapsed_to_chargeback', 'represented'])
// Statuses that count as still-open exposure (undecided / pending action).
const OPEN_STATUSES = new Set(['new', 'triaging', 'decided', 'action_pending'])

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

function ratio(cb: number, tx: number): number {
  return tx > 0 ? cb / tx : 0
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

interface NetworkRatio {
  network: string
  transaction_count: number
  chargeback_count: number
  ratio: number
}

// Compute live ratio overall + per network from orders (transactions) and
// alerts (chargebacks = alerts that lapsed/were represented as chargebacks).
async function computeCurrent(workspaceId: string): Promise<{
  overall: NetworkRatio
  byNetwork: NetworkRatio[]
}> {
  const allOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.workspace_id, workspaceId))
  const allAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, workspaceId))

  // Total transaction count is order count; chargebacks are network-tagged
  // alerts, so the overall transaction base is the total order volume and each
  // network's transaction base is apportioned by its share of alert activity
  // when no direct mapping exists. For determinism we use total orders for
  // overall, and per-network we use orders linked to that network's alerts.
  const totalTx = allOrders.length

  const byNetwork: NetworkRatio[] = []
  let totalCb = 0
  for (const net of NETWORKS) {
    const netAlerts = allAlerts.filter((a) => a.network === net)
    const cb = netAlerts.filter((a) => CHARGEBACK_STATUSES.has(a.status)).length
    // Per-network transaction base: orders that have an alert on this network,
    // falling back to total orders so the ratio is well-defined.
    const orderIds = new Set(
      netAlerts.map((a) => a.order_id).filter((x): x is string => !!x),
    )
    const netTx = orderIds.size > 0 ? orderIds.size : netAlerts.length
    totalCb += cb
    byNetwork.push({
      network: net,
      transaction_count: netTx,
      chargeback_count: cb,
      ratio: ratio(cb, netTx),
    })
  }

  return {
    overall: {
      network: 'all',
      transaction_count: totalTx,
      chargeback_count: totalCb,
      ratio: ratio(totalCb, totalTx),
    },
    byNetwork,
  }
}

// ── GET /current — auth required ───────────────────────────────────────────

router.get('/current', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { overall, byNetwork } = await computeCurrent(workspaceId)

  // Attach threshold context (VDMP/ECP) so the client can render guardrails.
  const thresholdRows = await db
    .select()
    .from(thresholds)
    .where(eq(thresholds.workspace_id, workspaceId))

  function statusFor(net: string, r: number): string {
    const relevant = thresholdRows.filter(
      (t) => t.network === net || t.network === 'all',
    )
    if (relevant.length === 0) return 'unknown'
    const excessive = Math.max(...relevant.map((t) => t.excessive_ratio))
    const standard = Math.max(...relevant.map((t) => t.standard_ratio))
    if (r >= excessive) return 'excessive'
    if (r >= standard) return 'warning'
    return 'healthy'
  }

  return c.json({
    overall: { ...overall, guardrail: statusFor('all', overall.ratio) },
    byNetwork: byNetwork.map((n) => ({
      ...n,
      guardrail: statusFor(n.network, n.ratio),
    })),
    thresholds: thresholdRows,
  })
})

// ── GET /projection — auth required ────────────────────────────────────────
// Projected end-of-period ratio under the current decision mix. Deflecting an
// open alert removes it from the chargeback count; representing/lapsing keeps
// it. We measure the realized deflection rate so far and apply it to open
// alerts to project where the ratio lands by period end.

router.get('/projection', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { overall, byNetwork } = await computeCurrent(workspaceId)
  const allAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, workspaceId))

  const resolved = allAlerts.filter(
    (a) => a.status === 'deflected' || CHARGEBACK_STATUSES.has(a.status),
  )
  const deflectedCount = allAlerts.filter((a) => a.status === 'deflected').length
  // Realized deflection rate = deflected / (deflected + chargebacks so far).
  const deflectionRate =
    resolved.length > 0 ? deflectedCount / resolved.length : 0.7

  const openAlerts = allAlerts.filter((a) => OPEN_STATUSES.has(a.status))
  const openCount = openAlerts.length

  // Of open alerts, those NOT deflected become chargebacks.
  const projectedNewChargebacks = Math.round(openCount * (1 - deflectionRate))
  const projectedCb = overall.chargeback_count + projectedNewChargebacks
  const projectedTx = overall.transaction_count

  // Scenarios: best (deflect all open), current (apply realized rate), worst
  // (deflect none of open).
  function scenarioRatio(extraCb: number): number {
    return ratio(overall.chargeback_count + extraCb, projectedTx)
  }

  const scenarios = [
    {
      name: 'best',
      label: 'Deflect all open alerts',
      added_chargebacks: 0,
      projected_ratio: scenarioRatio(0),
    },
    {
      name: 'current_mix',
      label: `Apply current deflection rate (${Math.round(deflectionRate * 100)}%)`,
      added_chargebacks: projectedNewChargebacks,
      projected_ratio: scenarioRatio(projectedNewChargebacks),
    },
    {
      name: 'worst',
      label: 'Deflect none of open alerts',
      added_chargebacks: openCount,
      projected_ratio: scenarioRatio(openCount),
    },
  ]

  return c.json({
    projected: {
      network: 'all',
      transaction_count: projectedTx,
      chargeback_count: projectedCb,
      ratio: ratio(projectedCb, projectedTx),
      deflection_rate: deflectionRate,
      open_alerts: openCount,
    },
    byNetwork: byNetwork.map((n) => {
      const netOpen = openAlerts.filter((a) => a.network === n.network).length
      const netNewCb = Math.round(netOpen * (1 - deflectionRate))
      return {
        network: n.network,
        transaction_count: n.transaction_count,
        chargeback_count: n.chargeback_count + netNewCb,
        ratio: ratio(n.chargeback_count + netNewCb, n.transaction_count),
        open_alerts: netOpen,
      }
    }),
    scenarios,
  })
})

// ── GET /snapshots — auth required ─────────────────────────────────────────

router.get('/snapshots', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const network = c.req.query('network')

  const conds = [eq(ratio_snapshots.workspace_id, workspaceId)]
  if (network) conds.push(eq(ratio_snapshots.network, network))

  const rows = await db
    .select()
    .from(ratio_snapshots)
    .where(and(...conds))
    .orderBy(desc(ratio_snapshots.created_at))
  return c.json(rows)
})

// ── POST /snapshot — auth: capture a snapshot ──────────────────────────────

const snapshotSchema = z.object({
  workspace_id: z.string().min(1),
  network: z.string().optional(),
  period: z.string().optional(),
})

router.post('/snapshot', authMiddleware, zValidator('json', snapshotSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { overall, byNetwork } = await computeCurrent(body.workspace_id)
  const period = body.period ?? currentPeriod()

  const toCapture =
    body.network && body.network !== 'all'
      ? byNetwork.filter((n) => n.network === body.network)
      : [overall, ...byNetwork]

  const created = []
  for (const m of toCapture) {
    const [snap] = await db
      .insert(ratio_snapshots)
      .values({
        workspace_id: body.workspace_id,
        network: m.network,
        period,
        transaction_count: m.transaction_count,
        chargeback_count: m.chargeback_count,
        ratio: m.ratio,
      })
      .returning()
    created.push(snap)
  }

  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'ratio.snapshot',
    entity_type: 'ratio_snapshot',
    entity_id: created[0]?.id ?? null,
    detail: { period, count: created.length },
  })

  // Return the overall snapshot when capturing the full set, else the single.
  return c.json(created.length === 1 ? created[0] : created, 201)
})

export default router
