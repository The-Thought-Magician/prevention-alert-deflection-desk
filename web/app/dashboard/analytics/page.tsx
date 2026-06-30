'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

interface Bucket {
  key?: string
  label?: string
  name?: string
  network?: string
  reason?: string
  reason_category?: string
  disposition?: string
  period?: string
  date?: string
  count?: number
  value?: number
}

interface Trends {
  byNetwork?: Bucket[]
  byReason?: Bucket[]
  byDisposition?: Bucket[]
  [k: string]: unknown
}

interface Performance {
  deflection_rate?: number
  auto_deflection_rate?: number
  lapse_rate?: number
  avg_decision_latency_seconds?: number
  avg_decision_latency_ms?: number
  deadline_utilization?: number
  total_alerts?: number
  [k: string]: unknown
}

function toArray(v: unknown): Bucket[] {
  return Array.isArray(v) ? (v as Bucket[]) : []
}

function bucketLabel(b: Bucket): string {
  return (
    b.label ?? b.name ?? b.network ?? b.reason ?? b.reason_category ?? b.disposition ?? b.period ?? b.date ?? b.key ?? '—'
  )
}

function bucketCount(b: Bucket): number {
  const c = b.count ?? b.value
  return typeof c === 'number' && Number.isFinite(c) ? c : 0
}

function pct(v?: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  // Accept either 0..1 fractions or already-scaled percentages.
  const scaled = v <= 1 ? v * 100 : v
  return `${scaled.toFixed(1)}%`
}

function latency(p?: Performance): string {
  if (!p) return '—'
  if (typeof p.avg_decision_latency_seconds === 'number') {
    const s = p.avg_decision_latency_seconds
    if (s < 60) return `${s.toFixed(1)}s`
    return `${(s / 60).toFixed(1)}m`
  }
  if (typeof p.avg_decision_latency_ms === 'number') {
    return `${(p.avg_decision_latency_ms / 1000).toFixed(1)}s`
  }
  return '—'
}

const BAR_TONES = ['from-orange-600 to-orange-400', 'from-sky-600 to-sky-400', 'from-violet-600 to-violet-400', 'from-emerald-600 to-emerald-400', 'from-amber-600 to-amber-400', 'from-rose-600 to-rose-400']

function BarBreakdown({ title, data }: { title: string; data: Bucket[] }) {
  const max = useMemo(() => Math.max(1, ...data.map(bucketCount)), [data])
  const total = useMemo(() => data.reduce((s, b) => s + bucketCount(b), 0), [data])
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <Badge tone="slate">{total.toLocaleString()} total</Badge>
      </CardHeader>
      <CardBody>
        {data.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No data.</p>
        ) : (
          <ul className="space-y-3">
            {data.map((b, i) => {
              const c = bucketCount(b)
              const w = Math.max(2, Math.round((c / max) * 100))
              const share = total > 0 ? Math.round((c / total) * 100) : 0
              return (
                <li key={`${bucketLabel(b)}-${i}`}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate text-slate-300" title={bucketLabel(b)}>
                      {bucketLabel(b)}
                    </span>
                    <span className="ml-2 shrink-0 text-slate-400">
                      {c.toLocaleString()} <span className="text-slate-600">({share}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${BAR_TONES[i % BAR_TONES.length]}`}
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export default function AnalyticsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [trends, setTrends] = useState<Trends | null>(null)
  const [perf, setPerf] = useState<Performance | null>(null)
  const [view, setView] = useState<'network' | 'reason' | 'disposition'>('network')

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = getActiveWorkspace()
    if (stored) return stored
    try {
      const list = await api.listWorkspaces()
      const first = Array.isArray(list) && list.length ? list[0]?.id : null
      if (first) setActiveWorkspace(first)
      return first ?? null
    } catch {
      return null
    }
  }, [])

  const load = useCallback(async (workspaceId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [t, p] = await Promise.all([api.getTrends(workspaceId), api.getPerformance(workspaceId)])
      setTrends((t && (t as Trends)) || {})
      setPerf((p && ((p as any).metrics ?? p)) || {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const id = await resolveWorkspace()
      if (!alive) return
      if (!id) {
        setNoWorkspace(true)
        setLoading(false)
        return
      }
      setWs(id)
      await load(id)
    })()
    return () => {
      alive = false
    }
  }, [resolveWorkspace, load])

  const byNetwork = useMemo(() => toArray(trends?.byNetwork), [trends])
  const byReason = useMemo(() => toArray(trends?.byReason), [trends])
  const byDisposition = useMemo(() => toArray(trends?.byDisposition), [trends])

  const activeData = view === 'network' ? byNetwork : view === 'reason' ? byReason : byDisposition

  if (loading) return <PageSpinner label="Loading analytics..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace from the dashboard to view analytics."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  const hasAnyTrend = byNetwork.length + byReason.length + byDisposition.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Analytics &amp; Trends</h1>
          <p className="mt-1 text-sm text-slate-400">
            Alert volume by network, reason, and disposition, plus deflection performance.
          </p>
        </div>
        <Button variant="secondary" onClick={() => ws && load(ws)}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Performance metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Deflection rate" value={pct(perf?.deflection_rate)} tone="green" sub="Alerts resolved by refund" />
        <Stat label="Auto-deflection rate" value={pct(perf?.auto_deflection_rate)} tone="orange" sub="Resolved without manual review" />
        <Stat label="Lapse rate" value={pct(perf?.lapse_rate)} tone="red" sub="Alerts past deadline" />
        <Stat label="Avg decision latency" value={latency(perf ?? undefined)} sub="Receipt to decision" />
        <Stat label="Deadline utilization" value={pct(perf?.deadline_utilization)} sub="Window consumed before action" />
      </div>

      {!hasAnyTrend ? (
        <EmptyState
          title="No alert trends yet"
          description="Once alerts flow in, volume breakdowns by network, reason, and disposition will appear here."
        />
      ) : (
        <>
          {/* View switcher */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">Alert volume breakdown</h2>
              <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
                {(['network', 'reason', 'disposition'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      view === v ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              {activeData.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No data for this breakdown.</p>
              ) : (
                <BarsInline data={activeData} />
              )}
            </CardBody>
          </Card>

          {/* Side-by-side full breakdowns */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <BarBreakdown title="By network" data={byNetwork} />
            <BarBreakdown title="By reason" data={byReason} />
            <BarBreakdown title="By disposition" data={byDisposition} />
          </div>
        </>
      )}
    </div>
  )
}

function BarsInline({ data }: { data: Bucket[] }) {
  const max = Math.max(1, ...data.map(bucketCount))
  return (
    <div className="flex h-64 items-end gap-3 overflow-x-auto pb-2">
      {data.map((b, i) => {
        const c = bucketCount(b)
        const h = Math.max(6, Math.round((c / max) * 200))
        return (
          <div key={`${bucketLabel(b)}-${i}`} className="flex min-w-[48px] flex-1 flex-col items-center gap-2">
            <span className="text-xs font-medium text-slate-300">{c.toLocaleString()}</span>
            <div
              className={`w-full rounded-t bg-gradient-to-t ${BAR_TONES[i % BAR_TONES.length]}`}
              style={{ height: `${h}px` }}
              title={`${bucketLabel(b)}: ${c}`}
            />
            <span className="max-w-[72px] truncate text-center text-[11px] text-slate-500" title={bucketLabel(b)}>
              {bucketLabel(b)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
