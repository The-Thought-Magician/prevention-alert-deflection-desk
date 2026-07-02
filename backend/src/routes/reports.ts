import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reports,
  alerts,
  decisions,
  refunds,
  savings_records,
  ratio_snapshots,
  thresholds,
  audit_events,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

// ── GET / ─ list generated reports ───────────────────────────────────────────
router.get('/', authMiddleware, async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.workspace_id, workspaceId))
    .orderBy(desc(reports.created_at))

  return c.json(rows)
})

// ── GET /:id ─ report detail ─────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(r.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  return c.json(r)
})

// ── POST /generate ─ generate deflection or monitoring-posture report ─────────
const generateSchema = z.object({
  workspace_id: z.string().min(1),
  kind: z.enum(['deflection', 'monitoring_posture']),
  title: z.string().min(1).optional(),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
})

function inRange(d: Date | string | null, start?: Date, end?: Date): boolean {
  if (!d) return false
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return false
  if (start && dt.getTime() < start.getTime()) return false
  if (end && dt.getTime() > end.getTime()) return false
  return true
}

async function buildDeflectionData(
  workspaceId: string,
  start?: Date,
  end?: Date,
): Promise<Record<string, unknown>> {
  const [alertRows, decisionRows, refundRows, savingsRows] = await Promise.all([
    db.select().from(alerts).where(eq(alerts.workspace_id, workspaceId)),
    db.select().from(decisions).where(eq(decisions.workspace_id, workspaceId)),
    db.select().from(refunds).where(eq(refunds.workspace_id, workspaceId)),
    db.select().from(savings_records).where(eq(savings_records.workspace_id, workspaceId)),
  ])

  const scoped = alertRows.filter((a) => inRange(a.received_at ?? a.created_at, start, end))
  const scopedRefunds = refundRows.filter((r) => inRange(r.created_at, start, end))
  const scopedSavings = savingsRows.filter((r) => inRange(r.created_at, start, end))

  const deflected = scoped.filter((a) => a.status === 'deflected').length
  const represented = scoped.filter((a) => a.status === 'represented').length
  const lapsed = scoped.filter((a) => a.status === 'lapsed_to_chargeback').length
  const resolved = deflected + represented + lapsed

  const byNetwork: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  for (const a of scoped) {
    const net = a.network ?? 'unknown'
    const reason = a.reason_category ?? a.reason_code ?? 'uncategorized'
    byNetwork[net] = (byNetwork[net] ?? 0) + 1
    byReason[reason] = (byReason[reason] ?? 0) + 1
  }

  let refundPaidCents = 0
  let chargebackCostAvoidedCents = 0
  let fineAvertedCents = 0
  let netSavingsCents = 0
  for (const s of scopedSavings) {
    refundPaidCents += s.refund_paid_cents ?? 0
    chargebackCostAvoidedCents += s.chargeback_cost_avoided_cents ?? 0
    fineAvertedCents += s.fine_averted_cents ?? 0
    netSavingsCents += s.net_savings_cents ?? 0
  }

  const decisionsInScope = decisionRows.filter((d) => inRange(d.created_at, start, end))

  return {
    kind: 'deflection',
    totals: {
      alerts: scoped.length,
      resolved,
      deflected,
      represented,
      lapsed,
      refundsExecuted: scopedRefunds.length,
      decisionsMade: decisionsInScope.length,
    },
    rates: {
      deflectionRate: resolved > 0 ? Math.round((deflected / resolved) * 1000) / 10 : 0,
      lapseRate: resolved > 0 ? Math.round((lapsed / resolved) * 1000) / 10 : 0,
    },
    breakdown: { byNetwork, byReason },
    savings: {
      refundPaidCents,
      chargebackCostAvoidedCents,
      fineAvertedCents,
      netSavingsCents,
    },
  }
}

async function buildMonitoringPostureData(
  workspaceId: string,
  start?: Date,
  end?: Date,
): Promise<Record<string, unknown>> {
  const [snapshotRows, thresholdRows, alertRows] = await Promise.all([
    db.select().from(ratio_snapshots).where(eq(ratio_snapshots.workspace_id, workspaceId)),
    db.select().from(thresholds).where(eq(thresholds.workspace_id, workspaceId)),
    db.select().from(alerts).where(eq(alerts.workspace_id, workspaceId)),
  ])

  const scopedSnapshots = snapshotRows
    .filter((s) => inRange(s.created_at, start, end))
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return ta - tb
    })

  // Latest ratio per network from scoped snapshots (fall back to all if none scoped).
  const source = scopedSnapshots.length > 0 ? scopedSnapshots : snapshotRows
  const latestByNetwork: Record<string, { ratio: number; transaction_count: number; chargeback_count: number; period: string }> = {}
  for (const s of source) {
    const net = s.network ?? 'all'
    latestByNetwork[net] = {
      ratio: s.ratio ?? 0,
      transaction_count: s.transaction_count ?? 0,
      chargeback_count: s.chargeback_count ?? 0,
      period: s.period,
    }
  }

  // Compare each network's latest ratio against thresholds.
  const guardrails = thresholdRows.map((t) => {
    const latest = latestByNetwork[t.network] ?? latestByNetwork['all']
    const ratio = latest?.ratio ?? 0
    let band: 'safe' | 'standard' | 'excessive' = 'safe'
    if (ratio >= t.excessive_ratio) band = 'excessive'
    else if (ratio >= t.standard_ratio) band = 'standard'
    return {
      program: t.program,
      network: t.network,
      currentRatio: ratio,
      standardRatio: t.standard_ratio,
      excessiveRatio: t.excessive_ratio,
      finePerDisputeCents: t.fine_per_dispute_cents ?? 0,
      slaWindowHours: t.sla_window_hours ?? 72,
      band,
    }
  })

  const scopedAlerts = alertRows.filter((a) => inRange(a.received_at ?? a.created_at, start, end))
  const lapsed = scopedAlerts.filter((a) => a.status === 'lapsed_to_chargeback').length

  return {
    kind: 'monitoring_posture',
    snapshotsCount: scopedSnapshots.length,
    latestByNetwork,
    guardrails,
    alertVolume: scopedAlerts.length,
    chargebacksLapsed: lapsed,
    trend: scopedSnapshots.map((s) => ({
      period: s.period,
      network: s.network,
      ratio: s.ratio ?? 0,
      created_at: s.created_at,
    })),
  }
}

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const start = body.period_start ? new Date(body.period_start) : undefined
  const end = body.period_end ? new Date(body.period_end) : undefined
  if (start && isNaN(start.getTime())) return c.json({ error: 'Invalid period_start' }, 400)
  if (end && isNaN(end.getTime())) return c.json({ error: 'Invalid period_end' }, 400)

  const data =
    body.kind === 'deflection'
      ? await buildDeflectionData(body.workspace_id, start, end)
      : await buildMonitoringPostureData(body.workspace_id, start, end)

  const title =
    body.title ??
    (body.kind === 'deflection' ? 'Deflection Report' : 'Monitoring Posture Report')

  const [created] = await db
    .insert(reports)
    .values({
      workspace_id: body.workspace_id,
      kind: body.kind,
      title,
      period_start: start ?? null,
      period_end: end ?? null,
      data,
      created_by: userId,
    })
    .returning()

  // Audit trail.
  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    actor: userId,
    action: 'report.generate',
    entity_type: 'report',
    entity_id: created.id,
    detail: { kind: body.kind, title },
  })

  return c.json(created, 201)
})

// ── GET /:id/export ─ export report as CSV/JSON ──────────────────────────────
function flatten(obj: unknown, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (obj === null || obj === undefined) {
    out.push([prefix || 'value', ''])
    return out
  }
  if (typeof obj !== 'object') {
    out.push([prefix || 'value', String(obj)])
    return out
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      out.push(...flatten(item, prefix ? `${prefix}[${i}]` : `[${i}]`))
    })
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...flatten(v, prefix ? `${prefix}.${k}` : k))
  }
  return out
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

router.get('/:id/export', authMiddleware, async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!(await isMember(r.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const format = (c.req.query('format') ?? 'json').toLowerCase()

  if (format === 'csv') {
    const meta: Record<string, unknown> = {
      id: r.id,
      workspace_id: r.workspace_id,
      kind: r.kind,
      title: r.title,
      period_start: r.period_start,
      period_end: r.period_end,
      created_by: r.created_by,
      created_at: r.created_at,
    }
    const rows = [...flatten(meta), ...flatten(r.data ?? {}, 'data')]
    const lines = ['key,value', ...rows.map(([k, v]) => `${csvEscape(k)},${csvEscape(v)}`)]
    const csv = lines.join('\n')
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${r.id}.csv"`,
      },
    })
  }

  // Default JSON download.
  return new Response(JSON.stringify(r, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${r.id}.json"`,
    },
  })
})

export default router
