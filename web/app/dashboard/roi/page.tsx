'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

interface Summary {
  chargebacks_avoided?: number
  value_cents?: number
  fines_averted_cents?: number
  reserve_exposure_reduced_cents?: number
  net_savings_cents?: number
  refund_paid_cents?: number
  alerts_deflected?: number
  [k: string]: unknown
}

interface SavingsRecord {
  id: string
  alert_id?: string
  network?: string
  refund_paid_cents?: number
  chargeback_cost_avoided_cents?: number
  fine_averted_cents?: number
  net_savings_cents?: number
  created_at?: string
}

interface TrendPoint {
  period?: string
  date?: string
  label?: string
  network?: string
  net_savings_cents?: number
  value_cents?: number
}

function money(cents?: number | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function num(n?: number | null): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

const NETWORK_TONES: Record<string, 'orange' | 'blue' | 'purple' | 'slate'> = {
  visa: 'blue',
  mastercard: 'orange',
  amex: 'purple',
}

function netTone(n?: string): 'orange' | 'blue' | 'purple' | 'slate' {
  return NETWORK_TONES[(n ?? '').toLowerCase()] ?? 'slate'
}

export default function RoiPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [summary, setSummary] = useState<Summary | null>(null)
  const [records, setRecords] = useState<SavingsRecord[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])

  const [networkFilter, setNetworkFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

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
      const [s, r, t] = await Promise.all([
        api.getRoiSummary(workspaceId),
        api.listSavingsRecords(workspaceId),
        api.getRoiTrend(workspaceId),
      ])
      const sm: Summary = (s && (s.summary ?? s)) || {}
      setSummary(sm)
      setRecords(Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : [])
      const tr = Array.isArray(t) ? t : Array.isArray(t?.trend) ? t.trend : []
      setTrend(tr)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ROI data')
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

  const networks = useMemo(() => {
    const set = new Set<string>()
    records.forEach((r) => r.network && set.add(r.network))
    trend.forEach((p) => p.network && set.add(p.network))
    return Array.from(set).sort()
  }, [records, trend])

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (networkFilter !== 'all' && (r.network ?? '').toLowerCase() !== networkFilter.toLowerCase()) return false
      if (!q) return true
      return (
        (r.alert_id ?? '').toLowerCase().includes(q) ||
        (r.network ?? '').toLowerCase().includes(q) ||
        (r.id ?? '').toLowerCase().includes(q)
      )
    })
  }, [records, networkFilter, search])

  const trendPoints = useMemo(() => {
    // Collapse to total net savings per period (sum across networks).
    const buckets = new Map<string, number>()
    const order: string[] = []
    for (const p of trend) {
      const key = p.period ?? p.date ?? p.label ?? ''
      if (!key) continue
      const val = num(p.net_savings_cents ?? p.value_cents)
      if (!buckets.has(key)) order.push(key)
      buckets.set(key, (buckets.get(key) ?? 0) + val)
    }
    return order.map((k) => ({ label: k, value: buckets.get(k) ?? 0 }))
  }, [trend])

  const maxTrend = useMemo(() => Math.max(1, ...trendPoints.map((p) => p.value)), [trendPoints])

  const recordTotals = useMemo(() => {
    return filteredRecords.reduce(
      (acc, r) => {
        acc.refund += num(r.refund_paid_cents)
        acc.cbAvoided += num(r.chargeback_cost_avoided_cents)
        acc.fineAverted += num(r.fine_averted_cents)
        acc.net += num(r.net_savings_cents)
        return acc
      },
      { refund: 0, cbAvoided: 0, fineAverted: 0, net: 0 },
    )
  }, [filteredRecords])

  if (loading) return <PageSpinner label="Loading ROI & savings..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace from the dashboard to view ROI and savings."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">ROI &amp; Savings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Chargebacks avoided, fines averted, and reserve exposure reduced through deflection.
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

      {/* Headline stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Net savings"
          value={money(num(summary?.net_savings_cents))}
          sub="Total value captured by deflection"
          tone="green"
        />
        <Stat
          label="Chargebacks avoided"
          value={num(summary?.chargebacks_avoided).toLocaleString()}
          sub={`${money(num(summary?.value_cents))} dispute value`}
          tone="orange"
        />
        <Stat
          label="Fines averted"
          value={money(num(summary?.fines_averted_cents))}
          sub="Program-fee exposure prevented"
        />
        <Stat
          label="Reserve exposure reduced"
          value={money(num(summary?.reserve_exposure_reduced_cents))}
          sub="Lower held-reserve risk"
        />
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Net savings trend</h2>
          <Badge tone="green">{money(recordTotals.net)} in view</Badge>
        </CardHeader>
        <CardBody>
          {trendPoints.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No trend data yet.</p>
          ) : (
            <div className="flex h-56 items-end gap-2 overflow-x-auto pb-2">
              {trendPoints.map((p, i) => {
                const h = Math.max(4, Math.round((p.value / maxTrend) * 180))
                return (
                  <div key={`${p.label}-${i}`} className="flex min-w-[36px] flex-1 flex-col items-center gap-2">
                    <span className="text-[10px] font-medium text-slate-400">{money(p.value)}</span>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-orange-600 to-orange-400"
                      style={{ height: `${h}px` }}
                      title={`${p.label}: ${money(p.value)}`}
                    />
                    <span className="max-w-[60px] truncate text-[10px] text-slate-500" title={p.label}>
                      {p.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-200">Savings records</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search alert / network..."
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
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
        <CardBody className="p-0">
          {filteredRecords.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No savings records"
                description={
                  records.length === 0
                    ? 'Deflect alerts to start accruing savings records.'
                    : 'No records match your current filters.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH>Alert</TH>
                  <TH className="text-right">Refund paid</TH>
                  <TH className="text-right">Chargeback avoided</TH>
                  <TH className="text-right">Fine averted</TH>
                  <TH className="text-right">Net savings</TH>
                  <TH>Recorded</TH>
                </TR>
              </THead>
              <TBody>
                {filteredRecords.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      {r.network ? <Badge tone={netTone(r.network)}>{r.network}</Badge> : <span className="text-slate-600">—</span>}
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{r.alert_id ? r.alert_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-right">{money(r.refund_paid_cents)}</TD>
                    <TD className="text-right text-emerald-400">{money(r.chargeback_cost_avoided_cents)}</TD>
                    <TD className="text-right">{money(r.fine_averted_cents)}</TD>
                    <TD className="text-right font-semibold text-emerald-300">{money(r.net_savings_cents)}</TD>
                    <TD className="text-xs text-slate-500">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <tfoot className="border-t border-slate-800 bg-slate-900/60 text-sm">
                <tr>
                  <TD className="font-medium text-slate-300" colSpan={2}>
                    {filteredRecords.length} record{filteredRecords.length === 1 ? '' : 's'}
                  </TD>
                  <TD className="text-right font-medium text-slate-300">{money(recordTotals.refund)}</TD>
                  <TD className="text-right font-medium text-emerald-400">{money(recordTotals.cbAvoided)}</TD>
                  <TD className="text-right font-medium text-slate-300">{money(recordTotals.fineAverted)}</TD>
                  <TD className="text-right font-semibold text-emerald-300">{money(recordTotals.net)}</TD>
                  <TD />
                </tr>
              </tfoot>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
