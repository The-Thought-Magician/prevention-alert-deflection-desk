// ─────────────────────────────────────────────────────────────────────────
// cron.ts — THE ENGINE
//
// Pure, deterministic scheduling/firing primitives used by route handlers.
// No external services, no DB access. Every export is a plain function that
// takes its inputs and returns a value (or throws only on truly invalid args).
//
// Job "kinds":
//   - 'cron'   : a 5/6-field cron expression, parsed via cron-parser v5.
//   - 'rate'   : "every N minutes|hours|days", computed arithmetically.
//   - 'oneoff' : a single ISO instant; fires once if it is in the future.
// ─────────────────────────────────────────────────────────────────────────

import { CronExpressionParser } from 'cron-parser'

// ── Types ────────────────────────────────────────────────────────────────

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ── Internal helpers ───────────────────────────────────────────────────────

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i

function parseRate(expr: string): { stepMs: number } | null {
  const m = RATE_RE.exec(expr.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  if (unit.startsWith('minute')) return { stepMs: n * MINUTE_MS }
  if (unit.startsWith('hour')) return { stepMs: n * HOUR_MS }
  return { stepMs: n * DAY_MS }
}

function safeDate(iso: string): Date {
  const d = new Date(iso)
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`)
  return d
}

// Wall-clock offset (minutes) for a given instant in a given IANA timezone.
// Positive = ahead of UTC. Used for DST detection.
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUTC - date.getTime()) / MINUTE_MS)
}

function floorToMinuteISO(d: Date): string {
  const t = Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS
  return new Date(t).toISOString()
}

// ── validateExpression ─────────────────────────────────────────────────────

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || !expr.trim()) return { valid: false, error: 'Expression is empty' }
  try {
    if (kind === 'cron') {
      CronExpressionParser.parse(expr)
      return { valid: true }
    }
    if (kind === 'rate') {
      if (!parseRate(expr)) {
        return { valid: false, error: 'Rate must look like "every N minutes|hours|days"' }
      }
      return { valid: true }
    }
    if (kind === 'oneoff') {
      const d = new Date(expr)
      if (isNaN(d.getTime())) return { valid: false, error: 'One-off must be a valid ISO instant' }
      return { valid: true }
    }
    return { valid: false, error: `Unknown kind: ${kind}` }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── describeExpression ─────────────────────────────────────────────────────

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule (${v.error})`

  if (kind === 'rate') {
    const m = RATE_RE.exec(expr.trim())!
    return `Runs every ${m[1]} ${m[2].toLowerCase()} (${timezone})`
  }
  if (kind === 'oneoff') {
    return `Runs once at ${safeDate(expr).toISOString()} (${timezone})`
  }

  // cron
  const fields = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') {
    parts.push('every minute')
  } else if (min !== '*' && hour !== '*' && !min.includes('*') && !hour.includes('*')) {
    parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  } else if (hour !== '*') {
    parts.push(`during hour ${hour}`)
  } else {
    parts.push(`at minute ${min}`)
  }
  if (dom && dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') parts.push(`in month ${mon}`)
  if (dow && dow !== '*') parts.push(`on weekday ${dow}`)
  return `Cron "${expr}" — ${parts.join(', ')} (${timezone})`
}

// ── nextFirings ────────────────────────────────────────────────────────────

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 10,
): string[] {
  const from = fromISO ? safeDate(fromISO) : new Date()
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'cron') {
    const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      out.push(it.next().toDate().toISOString())
    }
    return out
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.stepMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.stepMs
    }
    return out
  }

  // oneoff
  const at = safeDate(expr)
  return at.getTime() > from.getTime() ? [at.toISOString()] : []
}

// ── computeCollisions ──────────────────────────────────────────────────────

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(1, opts.threshold ?? 2)
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * DAY_MS

  // Bucket firings by minute. Each bucket holds the set of jobIds firing then.
  const buckets = new Map<string, Set<string>>()
  // Per-bucket, track resource -> jobIds sharing that resource.
  const bucketResources = new Map<string, Map<string, Set<string>>>()

  for (const job of jobs) {
    // Pull enough firings to cover the horizon; cap to avoid runaway.
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 1000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      const key = floorToMinuteISO(new Date(t))
      if (!buckets.has(key)) buckets.set(key, new Set())
      buckets.get(key)!.add(job.id)
      if (job.resourceId) {
        if (!bucketResources.has(key)) bucketResources.set(key, new Map())
        const rm = bucketResources.get(key)!
        if (!rm.has(job.resourceId)) rm.set(job.resourceId, new Set())
        rm.get(job.resourceId)!.add(job.id)
      }
    }
  }

  const windows: CollisionWindow[] = []
  for (const [key, jobIdSet] of buckets) {
    const concurrency = jobIdSet.size
    const rm = bucketResources.get(key)
    let sharedResource: string | undefined
    if (rm) {
      for (const [res, ids] of rm) {
        if (ids.size >= 2) {
          sharedResource = res
          break
        }
      }
    }
    const flagged = concurrency >= threshold || !!sharedResource
    if (!flagged) continue

    const start = new Date(key)
    const end = new Date(start.getTime() + MINUTE_MS)
    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 2) severity = 'high'
    else if (concurrency >= threshold) severity = 'medium'
    if (sharedResource && severity === 'low') severity = 'medium'

    windows.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: [...jobIdSet].sort(),
      severity,
      ...(sharedResource ? { resourceId: sharedResource } : {}),
    })
  }

  windows.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return windows
}

// ── loadHeatmap ────────────────────────────────────────────────────────────

export function loadHeatmap(jobs: Job[], opts: { horizonDays?: number } = {}): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * DAY_MS

  // Bucket by hour for a readable heatmap.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 1000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      const hour = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString()
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ── dstTraps ───────────────────────────────────────────────────────────────

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  const v = validateExpression(kind, expr)
  if (!v.valid) return []

  const from = fromISO ? safeDate(fromISO) : new Date()
  const windowEnd = from.getTime() + days * DAY_MS
  const traps: DstTrap[] = []

  // Walk day-by-day, detecting offset transitions in the timezone.
  let prevOffset = tzOffsetMinutes(from, timezone)
  for (let t = from.getTime(); t <= windowEnd; t += DAY_MS) {
    const d = new Date(t)
    const off = tzOffsetMinutes(d, timezone)
    if (off === prevOffset) {
      prevOffset = off
      continue
    }

    // Transition detected somewhere in the last 24h. Narrow to the hour.
    let lo = t - DAY_MS
    let hi = t
    while (hi - lo > HOUR_MS) {
      const mid = lo + Math.floor((hi - lo) / 2 / HOUR_MS) * HOUR_MS || lo + HOUR_MS
      const midOff = tzOffsetMinutes(new Date(mid), timezone)
      if (midOff === prevOffset) lo = mid
      else hi = mid
    }
    const transitionAt = new Date(hi)
    const localStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(transitionAt)

    if (off > prevOffset) {
      // Spring forward: clocks skip ahead — a wall-clock window is skipped.
      traps.push({ type: 'skip', atLocal: localStr, atUtc: transitionAt.toISOString() })
    } else {
      // Fall back: clocks repeat — wall-clock times are ambiguous / may double-fire.
      traps.push({ type: 'ambiguous', atLocal: localStr, atUtc: transitionAt.toISOString() })
      traps.push({ type: 'double_fire', atLocal: localStr, atUtc: transitionAt.toISOString() })
    }
    prevOffset = off
  }

  return traps
}

// ── coverageGaps ───────────────────────────────────────────────────────────
// Given desired coverage "windows" (each {start,end} ISO) and the firings of
// the supplied jobs, find spans inside the union of windows that have no firing.

export function coverageGaps(
  windows: Array<{ start: string; end: string }>,
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * DAY_MS

  // Collect & sort all firing instants in the horizon.
  const firingTimes: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 1000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      firingTimes.push(t)
    }
  }
  firingTimes.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const wStart = new Date(w.start).getTime()
    const wEnd = new Date(w.end).getTime()
    if (isNaN(wStart) || isNaN(wEnd) || wEnd <= wStart) continue

    const inside = firingTimes.filter((t) => t >= wStart && t <= wEnd).sort((a, b) => a - b)
    let cursor = wStart
    for (const t of inside) {
      if (t > cursor) {
        gaps.push({
          gapStart: new Date(cursor).toISOString(),
          gapEnd: new Date(t).toISOString(),
          durationMinutes: Math.round((t - cursor) / MINUTE_MS),
        })
      }
      cursor = Math.max(cursor, t)
    }
    if (cursor < wEnd) {
      gaps.push({
        gapStart: new Date(cursor).toISOString(),
        gapEnd: new Date(wEnd).toISOString(),
        durationMinutes: Math.round((wEnd - cursor) / MINUTE_MS),
      })
    }
  }

  return gaps
}

// ── autoSpread ─────────────────────────────────────────────────────────────
// For jobs that collide (share a firing minute beyond threshold), suggest a
// staggered cron expression that shifts each colliding job's minute offset.

export function autoSpread(
  jobs: Job[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(1, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays ?? 1,
  })

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const suggested = new Set<string>()
  const out: SpreadSuggestion[] = []

  for (const win of collisions) {
    // Keep the first job on its slot; spread the rest across distinct minutes.
    const colliding = win.jobIds
    let offset = 1
    for (let i = 1; i < colliding.length; i++) {
      const jobId = colliding[i]
      if (suggested.has(jobId)) continue
      const job = jobById.get(jobId)
      if (!job || job.kind !== 'cron') continue

      const fields = job.expr.trim().split(/\s+/)
      if (fields.length < 5) continue
      const newMinute = (offset * 7) % 60 // deterministic stagger step
      offset++
      const newExpr = [String(newMinute), ...fields.slice(1)].join(' ')
      suggested.add(jobId)
      out.push({
        jobId,
        suggestedExpr: newExpr,
        reason: `Collides with ${colliding.length - 1} other job(s) at ${win.windowStart}; shifted to minute ${newMinute} to spread load.`,
      })
    }
  }

  return out
}
