'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Alert = {
  id: string
  network?: string
  alert_type?: string
  external_alert_id?: string
  status?: string
  amount_cents?: number
  currency?: string
  reason_code?: string
  reason_category?: string
  deadline_at?: string | null
  received_at?: string | null
}

type Board = {
  critical?: Alert[]
  warning?: Alert[]
  safe?: Alert[]
}

function money(cents?: number, currency = 'USD') {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function msUntil(deadline?: string | null): number | null {
  if (!deadline) return null
  const t = new Date(deadline).getTime()
  if (Number.isNaN(t)) return null
  return t - Date.now()
}

function formatCountdown(ms: number | null): string {
  if (ms == null) return 'No deadline'
  const past = ms < 0
  let s = Math.abs(ms) / 1000
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return past ? `${parts} overdue` : `${parts} left`
}

const BANDS = [
  { key: 'critical' as const, label: 'Critical', tone: 'red' as const, accent: 'border-red-500/40 bg-red-500/5' },
  { key: 'warning' as const, label: 'Warning', tone: 'amber' as const, accent: 'border-amber-500/40 bg-amber-500/5' },
  { key: 'safe' as const, label: 'Safe', tone: 'green' as const, accent: 'border-emerald-500/40 bg-emerald-500/5' },
]

export default function DeadlinesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<Board>({})
  const [breaches, setBreaches] = useState<Alert[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now())

  async function load(ws: string) {
    const [b, br] = await Promise.all([
      api.getDeadlineBoard(ws),
      api.getDeadlineBreaches(ws),
    ])
    setBoard(b && typeof b === 'object' ? b : {})
    setBreaches(Array.isArray(br) ? br : [])
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        let ws = getActiveWorkspace()
        if (!ws) {
          const list = await api.listWorkspaces()
          if (Array.isArray(list) && list.length > 0) {
            ws = list[0].id
            setActiveWorkspace(ws as string)
          }
        }
        if (!alive) return
        if (!ws) { setLoading(false); return }
        setWorkspaceId(ws)
        await load(ws)
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'Failed to load deadlines')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Live countdown tick.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  async function refresh() {
    if (!workspaceId) return
    setRefreshing(true)
    setError(null)
    try {
      await load(workspaceId)
      setNow(Date.now())
    } catch (e: any) {
      setError(e?.message ?? 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const counts = useMemo(() => ({
    critical: board.critical?.length ?? 0,
    warning: board.warning?.length ?? 0,
    safe: board.safe?.length ?? 0,
  }), [board])

  const totalOpen = counts.critical + counts.warning + counts.safe

  if (loading) return <PageSpinner label="Loading deadline board..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace from the dashboard to see deflection deadlines."
          action={<Link href="/dashboard"><Button>Go to dashboard</Button></Link>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6" data-now={now}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Deadline Board</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Deflectable alerts banded by SLA urgency. Act on critical alerts before they lapse into chargebacks.
          </p>
        </div>
        <Button variant="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open deflectable" value={totalOpen} />
        <Stat label="Critical" value={counts.critical} tone="red" sub="Imminent SLA breach" />
        <Stat label="Warning" value={counts.warning} tone="orange" sub="Approaching deadline" />
        <Stat label="Breaches" value={breaches.length} tone={breaches.length ? 'red' : 'green'} sub="Past / near deadline, still deflectable" />
      </div>

      {totalOpen === 0 ? (
        <EmptyState
          title="No alerts on the board"
          description="There are no open deflectable alerts. New alerts appear here as feeds sync or you add them."
          action={<Link href="/dashboard/alerts/new"><Button>Add an alert</Button></Link>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {BANDS.map((band) => {
            const items = board[band.key] ?? []
            return (
              <div key={band.key} className={`rounded-xl border ${band.accent}`}>
                <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={band.tone}>{band.label}</Badge>
                    <span className="text-sm text-neutral-400">{items.length}</span>
                  </div>
                </div>
                <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3">
                  {items.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-neutral-600">None</p>
                  ) : (
                    items.map((a) => {
                      const ms = msUntil(a.deadline_at)
                      return (
                        <Link
                          key={a.id}
                          href={`/dashboard/alerts/${a.id}`}
                          className="block rounded-lg border border-neutral-800 bg-neutral-900/80 p-3 transition-colors hover:border-orange-500/40 hover:bg-neutral-900"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-neutral-200">
                              {a.external_alert_id ?? a.id}
                            </span>
                            <span className="text-sm font-semibold text-neutral-100">
                              {money(a.amount_cents, a.currency)}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {a.network && <Badge tone="slate">{a.network}</Badge>}
                            {a.reason_code && <Badge tone="blue">{a.reason_code}</Badge>}
                            {a.status && <Badge tone="purple">{a.status}</Badge>}
                          </div>
                          <div className={`mt-2 text-xs font-medium ${
                            ms != null && ms < 0 ? 'text-red-400'
                              : band.key === 'critical' ? 'text-red-300'
                              : band.key === 'warning' ? 'text-amber-300' : 'text-emerald-300'
                          }`}>
                            {formatCountdown(ms)}
                            {a.deadline_at && (
                              <span className="ml-1.5 text-neutral-600">
                                · {new Date(a.deadline_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Breaches &amp; near-misses</h2>
            <Badge tone={breaches.length ? 'red' : 'green'}>{breaches.length} flagged</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {breaches.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-500">
              No deflectable alerts are past or near their deadline. You are within SLA.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Alert</TH>
                  <TH>Network</TH>
                  <TH>Amount</TH>
                  <TH>Reason</TH>
                  <TH>Status</TH>
                  <TH>Deadline</TH>
                  <TH>Countdown</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {breaches.map((a) => {
                  const ms = msUntil(a.deadline_at)
                  return (
                    <TR key={a.id}>
                      <TD className="font-medium text-neutral-200">{a.external_alert_id ?? a.id}</TD>
                      <TD>{a.network ?? '—'}</TD>
                      <TD>{money(a.amount_cents, a.currency)}</TD>
                      <TD>{a.reason_code ?? a.reason_category ?? '—'}</TD>
                      <TD>{a.status ? <Badge tone="purple">{a.status}</Badge> : '—'}</TD>
                      <TD>{a.deadline_at ? new Date(a.deadline_at).toLocaleString() : '—'}</TD>
                      <TD>
                        <span className={ms != null && ms < 0 ? 'text-red-400' : 'text-amber-300'}>
                          {formatCountdown(ms)}
                        </span>
                      </TD>
                      <TD>
                        <Link href={`/dashboard/alerts/${a.id}`} className="text-orange-400 hover:text-orange-300">
                          Resolve →
                        </Link>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
