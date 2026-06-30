'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

const WS_KEY = 'padd:workspace'

type NetworkRatio = {
  network?: string
  ratio?: number
  transaction_count?: number
  chargeback_count?: number
  period?: string
}

type CurrentRatio = {
  overall?: { ratio?: number; transaction_count?: number; chargeback_count?: number; period?: string }
  byNetwork?: NetworkRatio[]
}

type Scenario = {
  label?: string
  name?: string
  ratio?: number
  projected?: number
  description?: string
}

type Projection = {
  projected?: number
  scenarios?: Scenario[]
}

type Snapshot = {
  id?: string
  network?: string
  period?: string
  transaction_count?: number
  chargeback_count?: number
  ratio?: number
  created_at?: string
}

type Threshold = {
  id?: string
  program?: string
  network?: string
  standard_ratio?: number
  excessive_ratio?: number
  standard_count?: number
  fine_per_dispute_cents?: number
  sla_window_hours?: number
}

function pct(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  // Ratios from the engine are fractional (e.g. 0.0075 = 0.75%).
  return `${(v * 100).toFixed(3)}%`
}

function bandFor(ratio: number | undefined, std?: number, exc?: number): {
  tone: 'green' | 'amber' | 'red'
  label: string
} {
  if (ratio == null) return { tone: 'green', label: 'No data' }
  if (exc != null && ratio >= exc) return { tone: 'red', label: 'Excessive' }
  if (std != null && ratio >= std) return { tone: 'amber', label: 'Standard breach' }
  return { tone: 'green', label: 'Healthy' }
}

export default function RatioPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [networkFilter, setNetworkFilter] = useState<string>('all')

  const [current, setCurrent] = useState<CurrentRatio | null>(null)
  const [projection, setProjection] = useState<Projection | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [thresholds, setThresholds] = useState<Threshold[]>([])

  useEffect(() => {
    setWs(typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null)
  }, [])

  const load = useCallback(async (workspace: string) => {
    setError(null)
    try {
      const [cur, proj, snaps, thr] = await Promise.all([
        api.getCurrentRatio(workspace),
        api.getRatioProjection(workspace),
        api.listRatioSnapshots(workspace),
        api.listThresholds(workspace),
      ])
      setCurrent(cur ?? null)
      setProjection(proj ?? null)
      setSnapshots(Array.isArray(snaps) ? snaps : [])
      setThresholds(Array.isArray(thr) ? thr : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ratio data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ws === null) return
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    load(ws)
  }, [ws, load])

  // Resolve VDMP (Visa) / ECP (Mastercard) guardrail thresholds.
  const guardrails = useMemo(() => {
    const find = (pred: (t: Threshold) => boolean) => thresholds.find(pred)
    const visa =
      find((t) => /vdmp/i.test(t.program ?? '') || /visa/i.test(t.network ?? '')) ??
      find((t) => /visa/i.test(`${t.program} ${t.network}`))
    const mc =
      find((t) => /ecp/i.test(t.program ?? '') || /master/i.test(t.network ?? '')) ??
      find((t) => /master|mc/i.test(`${t.program} ${t.network}`))
    return { visa, mc }
  }, [thresholds])

  const overallRatio = current?.overall?.ratio
  // Use the strictest standard ratio across known thresholds for the overall band.
  const strictestStd = useMemo(() => {
    const vals = thresholds.map((t) => t.standard_ratio).filter((v): v is number => v != null)
    return vals.length ? Math.min(...vals) : undefined
  }, [thresholds])
  const strictestExc = useMemo(() => {
    const vals = thresholds.map((t) => t.excessive_ratio).filter((v): v is number => v != null)
    return vals.length ? Math.min(...vals) : undefined
  }, [thresholds])

  const overallBand = bandFor(overallRatio, strictestStd, strictestExc)

  const networks = useMemo(() => {
    const set = new Set<string>()
    ;(current?.byNetwork ?? []).forEach((n) => n.network && set.add(n.network))
    snapshots.forEach((s) => s.network && set.add(s.network))
    return Array.from(set).sort()
  }, [current, snapshots])

  const filteredSnapshots = useMemo(() => {
    const list = networkFilter === 'all'
      ? snapshots
      : snapshots.filter((s) => s.network === networkFilter)
    return [...list].sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0
      const bt = b.created_at ? Date.parse(b.created_at) : 0
      return at - bt
    })
  }, [snapshots, networkFilter])

  const capture = async () => {
    if (!ws) return
    setCapturing(true)
    setError(null)
    try {
      await api.captureRatioSnapshot({ workspace_id: ws })
      await load(ws)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to capture snapshot')
    } finally {
      setCapturing(false)
    }
  }

  if (ws === null) return <PageSpinner label="Loading workspace..." />

  if (!ws) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick or create a workspace on the dashboard to view chargeback-ratio guardrails."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  if (loading) return <PageSpinner label="Loading ratio guardrails..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Chargeback Ratio Guardrail</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live dispute-to-transaction ratio against Visa VDMP and Mastercard ECP thresholds, with end-of-period projection and trend.
          </p>
        </div>
        <Button onClick={capture} disabled={capturing}>
          {capturing ? 'Capturing...' : 'Capture snapshot'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Overall + program guardrails */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Overall ratio"
          value={pct(overallRatio)}
          sub={<Badge tone={overallBand.tone}>{overallBand.label}</Badge>}
          tone={overallBand.tone === 'red' ? 'red' : overallBand.tone === 'amber' ? 'orange' : 'green'}
        />
        <Stat
          label="Transactions"
          value={(current?.overall?.transaction_count ?? 0).toLocaleString()}
          sub={current?.overall?.period ? `Period ${current.overall.period}` : 'Current period'}
        />
        <Stat
          label="Chargebacks / alerts"
          value={(current?.overall?.chargeback_count ?? 0).toLocaleString()}
          sub="Counted toward ratio"
        />
        <Stat
          label="Projected end-of-period"
          value={pct(projection?.projected)}
          sub="Under current decision mix"
          tone={
            projection?.projected != null && strictestExc != null && projection.projected >= strictestExc
              ? 'red'
              : projection?.projected != null && strictestStd != null && projection.projected >= strictestStd
              ? 'orange'
              : 'default'
          }
        />
      </div>

      {/* Program threshold cards (VDMP / ECP) */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Program guardrails</h2>
        </CardHeader>
        <CardBody>
          {thresholds.length === 0 ? (
            <p className="text-sm text-slate-400">No thresholds configured for this workspace.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                { title: 'Visa VDMP', t: guardrails.visa, net: 'visa' },
                { title: 'Mastercard ECP', t: guardrails.mc, net: 'mastercard' },
              ].map(({ title, t, net }) => {
                const netRatio = current?.byNetwork?.find((n) =>
                  (n.network ?? '').toLowerCase().includes(net),
                )?.ratio
                const band = bandFor(netRatio, t?.standard_ratio, t?.excessive_ratio)
                const stdW = t?.standard_ratio ? Math.min(100, (netRatio ?? 0) / t.standard_ratio * 100) : 0
                return (
                  <div key={title} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-100">{title}</span>
                      <Badge tone={band.tone}>{band.label}</Badge>
                    </div>
                    {t ? (
                      <>
                        <div className="mt-3 flex items-baseline gap-2">
                          <span className="text-2xl font-semibold text-slate-100">{pct(netRatio)}</span>
                          <span className="text-xs text-slate-500">
                            standard {pct(t.standard_ratio)} · excessive {pct(t.excessive_ratio)}
                          </span>
                        </div>
                        {/* progress vs standard threshold */}
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full ${
                              band.tone === 'red'
                                ? 'bg-red-500'
                                : band.tone === 'amber'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${stdW}%` }}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                          <span>Min count: {(t.standard_count ?? 0).toLocaleString()}</span>
                          <span>SLA window: {t.sla_window_hours ?? '—'}h</span>
                          <span>
                            Fine/dispute: $
                            {((t.fine_per_dispute_cents ?? 0) / 100).toFixed(2)}
                          </span>
                          <span>Program: {t.program ?? '—'}</span>
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No threshold configured for this program.</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Per-network breakdown */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Ratio by network</h2>
        </CardHeader>
        <CardBody className="p-0">
          {(current?.byNetwork ?? []).length === 0 ? (
            <div className="p-5">
              <EmptyState title="No network ratio data" description="No transactions or alerts recorded yet." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH>Transactions</TH>
                  <TH>Chargebacks</TH>
                  <TH>Ratio</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {(current?.byNetwork ?? []).map((n, i) => {
                  const t = thresholds.find((x) =>
                    (x.network ?? '').toLowerCase() === (n.network ?? '').toLowerCase(),
                  )
                  const band = bandFor(n.ratio, t?.standard_ratio, t?.excessive_ratio)
                  return (
                    <TR key={n.network ?? i}>
                      <TD className="font-medium text-slate-100">{n.network ?? '—'}</TD>
                      <TD>{(n.transaction_count ?? 0).toLocaleString()}</TD>
                      <TD>{(n.chargeback_count ?? 0).toLocaleString()}</TD>
                      <TD>{pct(n.ratio)}</TD>
                      <TD>
                        <Badge tone={band.tone}>{band.label}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Projection scenarios */}
      {projection?.scenarios && projection.scenarios.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Projection scenarios</h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projection.scenarios.map((s, i) => {
                const r = s.ratio ?? s.projected
                const band = bandFor(r, strictestStd, strictestExc)
                return (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">{s.label ?? s.name ?? `Scenario ${i + 1}`}</span>
                      <Badge tone={band.tone}>{band.label}</Badge>
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-100">{pct(r)}</div>
                    {s.description && <p className="mt-1 text-xs text-slate-400">{s.description}</p>}
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Trend chart (SVG) + filter */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Ratio trend</h2>
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All networks</option>
              {networks.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filteredSnapshots.length === 0 ? (
            <EmptyState
              title="No snapshots yet"
              description="Capture a snapshot to start building the ratio trend."
              action={
                <Button onClick={capture} disabled={capturing}>
                  {capturing ? <Spinner /> : 'Capture snapshot'}
                </Button>
              }
            />
          ) : (
            <TrendChart
              snapshots={filteredSnapshots}
              std={strictestStd}
              exc={strictestExc}
            />
          )}
        </CardBody>
      </Card>

      {/* Snapshot history table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Snapshot history</h2>
        </CardHeader>
        <CardBody className="p-0">
          {filteredSnapshots.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No snapshots" description="Captured ratio snapshots will appear here." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Captured</TH>
                  <TH>Network</TH>
                  <TH>Period</TH>
                  <TH>Transactions</TH>
                  <TH>Chargebacks</TH>
                  <TH>Ratio</TH>
                </TR>
              </THead>
              <TBody>
                {[...filteredSnapshots].reverse().map((s, i) => (
                  <TR key={s.id ?? i}>
                    <TD>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</TD>
                    <TD className="text-slate-100">{s.network ?? 'overall'}</TD>
                    <TD>{s.period ?? '—'}</TD>
                    <TD>{(s.transaction_count ?? 0).toLocaleString()}</TD>
                    <TD>{(s.chargeback_count ?? 0).toLocaleString()}</TD>
                    <TD>{pct(s.ratio)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function TrendChart({
  snapshots,
  std,
  exc,
}: {
  snapshots: Snapshot[]
  std?: number
  exc?: number
}) {
  const W = 720
  const H = 220
  const padX = 40
  const padY = 24

  const points = snapshots
    .map((s) => s.ratio)
    .filter((v): v is number => v != null)

  const candidates = [...points, std, exc].filter((v): v is number => v != null)
  const max = Math.max(...candidates, 0.0001) * 1.15
  const min = 0

  const n = snapshots.length
  const x = (i: number) => padX + (n <= 1 ? 0 : (i * (W - padX * 2)) / (n - 1))
  const y = (v: number) => H - padY - ((v - min) / (max - min)) * (H - padY * 2)

  const linePath = snapshots
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.ratio ?? 0).toFixed(1)}`)
    .join(' ')

  const areaPath =
    `M ${x(0).toFixed(1)} ${(H - padY).toFixed(1)} ` +
    snapshots.map((s, i) => `L ${x(i).toFixed(1)} ${y(s.ratio ?? 0).toFixed(1)}`).join(' ') +
    ` L ${x(n - 1).toFixed(1)} ${(H - padY).toFixed(1)} Z`

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full min-w-[480px]" preserveAspectRatio="none">
        {/* grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const gv = min + g * (max - min)
          const gy = y(gv)
          return (
            <g key={g}>
              <line x1={padX} y1={gy} x2={W - padX} y2={gy} stroke="#1e293b" strokeWidth={1} />
              <text x={4} y={gy + 3} fontSize={9} fill="#64748b">
                {(gv * 100).toFixed(2)}%
              </text>
            </g>
          )
        })}

        {/* threshold reference lines */}
        {std != null && std <= max && (
          <g>
            <line x1={padX} y1={y(std)} x2={W - padX} y2={y(std)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" />
            <text x={W - padX} y={y(std) - 3} fontSize={9} fill="#f59e0b" textAnchor="end">
              standard {(std * 100).toFixed(2)}%
            </text>
          </g>
        )}
        {exc != null && exc <= max && (
          <g>
            <line x1={padX} y1={y(exc)} x2={W - padX} y2={y(exc)} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" />
            <text x={W - padX} y={y(exc) - 3} fontSize={9} fill="#ef4444" textAnchor="end">
              excessive {(exc * 100).toFixed(2)}%
            </text>
          </g>
        )}

        <path d={areaPath} fill="#ea580c" fillOpacity={0.12} />
        <path d={linePath} fill="none" stroke="#f97316" strokeWidth={2} />
        {snapshots.map((s, i) => (
          <circle key={s.id ?? i} cx={x(i)} cy={y(s.ratio ?? 0)} r={3} fill="#fb923c" />
        ))}
      </svg>
    </div>
  )
}
