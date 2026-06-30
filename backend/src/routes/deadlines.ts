import { Hono } from 'hono'
import { db } from '../db/index.js'
import { alerts } from '../db/schema.js'
import { and, eq, asc, inArray, isNotNull } from 'drizzle-orm'

const router = new Hono()

// Alert statuses that are still open / actionable (a deflection refund could
// still be executed). Once an alert is deflected, represented, or has lapsed to
// a chargeback it is terminal and drops off the deadline board.
const OPEN_STATUSES = ['new', 'triaging', 'decided', 'action_pending'] as const

// Urgency band thresholds, in milliseconds of remaining time to the deadline.
const CRITICAL_MS = 12 * 60 * 60 * 1000 // < 12h (or already past) → critical
const WARNING_MS = 48 * 60 * 60 * 1000 // < 48h → warning

type Band = 'critical' | 'warning' | 'safe'

function bandFor(deadlineAt: Date | null, now: number): { band: Band; msRemaining: number | null; isPast: boolean } {
  if (!deadlineAt) {
    // No deadline known — treat as safe but flag separately via null msRemaining.
    return { band: 'safe', msRemaining: null, isPast: false }
  }
  const msRemaining = deadlineAt.getTime() - now
  const isPast = msRemaining <= 0
  let band: Band
  if (msRemaining <= CRITICAL_MS) band = 'critical'
  else if (msRemaining <= WARNING_MS) band = 'warning'
  else band = 'safe'
  return { band, msRemaining, isPast }
}

function decorate(row: typeof alerts.$inferSelect, now: number) {
  const { band, msRemaining, isPast } = bandFor(row.deadline_at, now)
  return {
    ...row,
    urgency_band: band,
    ms_remaining: msRemaining,
    hours_remaining: msRemaining == null ? null : Math.round((msRemaining / 3_600_000) * 10) / 10,
    is_past_deadline: isPast,
  }
}

// GET /board — open alerts sorted by deadline, grouped into urgency bands.
// Public read. Requires ?workspace_id=.
router.get('/board', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspace_id, workspaceId), inArray(alerts.status, [...OPEN_STATUSES])))
    .orderBy(asc(alerts.deadline_at))

  const now = Date.now()
  const decorated = rows
    .map((r) => decorate(r, now))
    // Sort: nulls (no deadline) last; otherwise soonest deadline first.
    .sort((a, b) => {
      if (a.deadline_at == null && b.deadline_at == null) return 0
      if (a.deadline_at == null) return 1
      if (b.deadline_at == null) return -1
      return new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime()
    })

  const critical = decorated.filter((r) => r.urgency_band === 'critical')
  const warning = decorated.filter((r) => r.urgency_band === 'warning')
  const safe = decorated.filter((r) => r.urgency_band === 'safe')

  return c.json({
    critical,
    warning,
    safe,
    counts: { critical: critical.length, warning: warning.length, safe: safe.length, total: decorated.length },
  })
})

// GET /breaches — open alerts that are past their deadline or within the
// critical window, i.e. still deflectable but at imminent risk of lapsing.
// Public read. Requires ?workspace_id=.
router.get('/breaches', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.workspace_id, workspaceId),
        inArray(alerts.status, [...OPEN_STATUSES]),
        isNotNull(alerts.deadline_at),
      ),
    )
    .orderBy(asc(alerts.deadline_at))

  const now = Date.now()
  const breaches = rows
    .map((r) => decorate(r, now))
    .filter((r) => r.ms_remaining != null && r.ms_remaining <= CRITICAL_MS)

  return c.json(breaches)
})

export default router
