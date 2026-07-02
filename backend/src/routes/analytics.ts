import { Hono } from 'hono'
import { db } from '../db/index.js'
import { alerts, decisions, refunds, workspace_members } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
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

// Networks and dispositions we track.
const DISPOSITIONS = [
  'new',
  'triaging',
  'decided',
  'action_pending',
  'deflected',
  'represented',
  'lapsed_to_chargeback',
] as const

function monthKey(d: Date | string | null): string {
  if (!d) return 'unknown'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return 'unknown'
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

function bump(map: Record<string, Record<string, number>>, key: string, period: string): void {
  if (!map[key]) map[key] = {}
  map[key][period] = (map[key][period] ?? 0) + 1
}

// ── GET /trends ─ alert volume by network/reason/disposition over time ───────
router.get('/trends', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db.select().from(alerts).where(eq(alerts.workspace_id, workspaceId))

  const byNetwork: Record<string, Record<string, number>> = {}
  const byReason: Record<string, Record<string, number>> = {}
  const byDisposition: Record<string, Record<string, number>> = {}

  // Totals (period-agnostic) for quick summary consumption.
  const networkTotals: Record<string, number> = {}
  const reasonTotals: Record<string, number> = {}
  const dispositionTotals: Record<string, number> = {}
  const periods = new Set<string>()

  for (const a of rows) {
    const period = monthKey(a.received_at ?? a.created_at)
    periods.add(period)
    const network = a.network ?? 'unknown'
    const reason = a.reason_category ?? a.reason_code ?? 'uncategorized'
    const disposition = a.status ?? 'new'

    bump(byNetwork, network, period)
    bump(byReason, reason, period)
    bump(byDisposition, disposition, period)

    networkTotals[network] = (networkTotals[network] ?? 0) + 1
    reasonTotals[reason] = (reasonTotals[reason] ?? 0) + 1
    dispositionTotals[disposition] = (dispositionTotals[disposition] ?? 0) + 1
  }

  return c.json({
    periods: [...periods].sort(),
    byNetwork,
    byReason,
    byDisposition,
    totals: {
      byNetwork: networkTotals,
      byReason: reasonTotals,
      byDisposition: dispositionTotals,
      alerts: rows.length,
    },
  })
})

// ── GET /performance ─ deflection/auto-deflection/lapse rates, latency, util ─
router.get('/performance', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [alertRows, decisionRows, refundRows] = await Promise.all([
    db.select().from(alerts).where(eq(alerts.workspace_id, workspaceId)),
    db.select().from(decisions).where(eq(decisions.workspace_id, workspaceId)),
    db.select().from(refunds).where(eq(refunds.workspace_id, workspaceId)),
  ])

  const totalAlerts = alertRows.length
  const deflected = alertRows.filter((a) => a.status === 'deflected').length
  const represented = alertRows.filter((a) => a.status === 'represented').length
  const lapsed = alertRows.filter((a) => a.status === 'lapsed_to_chargeback').length
  const resolved = deflected + represented + lapsed

  // Auto-deflection: refunds executed via auto_deflection method.
  const autoDeflectRefunds = refundRows.filter((r) => r.method === 'auto_deflection')
  const autoDeflectedAlertIds = new Set(
    autoDeflectRefunds.map((r) => r.alert_id).filter((x): x is string => !!x),
  )

  // Decision latency: time between alert.received_at and its first decision.
  // Group decisions by alert_id, keep earliest.
  const firstDecisionByAlert = new Map<string, Date>()
  for (const d of decisionRows) {
    const created = d.created_at ? new Date(d.created_at) : null
    if (!created || isNaN(created.getTime())) continue
    const existing = firstDecisionByAlert.get(d.alert_id)
    if (!existing || created.getTime() < existing.getTime()) {
      firstDecisionByAlert.set(d.alert_id, created)
    }
  }

  const alertById = new Map(alertRows.map((a) => [a.id, a]))
  let latencySum = 0
  let latencyCount = 0
  for (const [alertId, decidedAt] of firstDecisionByAlert) {
    const alert = alertById.get(alertId)
    if (!alert) continue
    const received = alert.received_at ? new Date(alert.received_at) : null
    if (!received || isNaN(received.getTime())) continue
    const deltaMs = decidedAt.getTime() - received.getTime()
    if (deltaMs >= 0) {
      latencySum += deltaMs
      latencyCount++
    }
  }
  const avgDecisionLatencyMinutes =
    latencyCount > 0 ? Math.round(latencySum / latencyCount / 60000) : 0

  // Deadline utilization: for alerts with a deadline that were deflected,
  // fraction of the available window consumed before action (proxy: decision time).
  let utilSum = 0
  let utilCount = 0
  for (const a of alertRows) {
    if (!a.deadline_at || !a.received_at) continue
    const decidedAt = firstDecisionByAlert.get(a.id)
    if (!decidedAt) continue
    const received = new Date(a.received_at).getTime()
    const deadline = new Date(a.deadline_at).getTime()
    const window = deadline - received
    if (window <= 0) continue
    const used = decidedAt.getTime() - received
    if (used < 0) continue
    utilSum += Math.min(used / window, 1)
    utilCount++
  }
  const deadlineUtilizationPct =
    utilCount > 0 ? Math.round((utilSum / utilCount) * 1000) / 10 : 0

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

  return c.json({
    metrics: {
      totalAlerts,
      resolvedAlerts: resolved,
      deflectedAlerts: deflected,
      representedAlerts: represented,
      lapsedAlerts: lapsed,
      autoDeflectedAlerts: autoDeflectedAlertIds.size,
      // Rates expressed as percentages.
      deflectionRate: pct(deflected, resolved),
      deflectionRateOfTotal: pct(deflected, totalAlerts),
      autoDeflectionRate: pct(autoDeflectedAlertIds.size, deflected),
      lapseRate: pct(lapsed, resolved),
      representmentRate: pct(represented, resolved),
      avgDecisionLatencyMinutes,
      decisionsMade: decisionRows.length,
      alertsWithDecision: firstDecisionByAlert.size,
      deadlineUtilizationPct,
    },
  })
})

export default router
