'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Workspace = {
  id: string
  name: string
  invite_code?: string
  default_currency?: string
}

function money(cents?: number | null, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
}

function pct(n?: number | null) {
  if (n == null || Number.isNaN(n)) return '0.00%'
  // ratio values come through as fractions (e.g. 0.0085) — display as %.
  const value = n > 1 ? n : n * 100
  return `${value.toFixed(2)}%`
}

function urgencyTone(deadline?: string | null): 'red' | 'amber' | 'green' | 'slate' {
  if (!deadline) return 'slate'
  const ms = new Date(deadline).getTime() - Date.now()
  if (Number.isNaN(ms)) return 'slate'
  if (ms <= 0) return 'red'
  const hours = ms / 36e5
  if (hours <= 24) return 'red'
  if (hours <= 72) return 'amber'
  return 'green'
}

function timeLeft(deadline?: string | null) {
  if (!deadline) return '—'
  const ms = new Date(deadline).getTime() - Date.now()
  if (Number.isNaN(ms)) return '—'
  if (ms <= 0) return 'overdue'
  const h = Math.floor(ms / 36e5)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  const m = Math.floor((ms % 36e5) / 6e4)
  return `${h}h ${m}m`
}

// Half-circle SVG gauge for the chargeback ratio against the excessive threshold.
function RatioGauge({ ratio, threshold }: { ratio: number; threshold: number }) {
  const display = ratio > 1 ? ratio / 100 : ratio
  const thr = threshold > 1 ? threshold / 100 : threshold || 0.0125
  // scale so threshold sits at ~75% of the arc
  const max = Math.max(thr * 1.4, display * 1.1, 0.0001)
  const frac = Math.min(display / max, 1)
  const angle = Math.PI * frac
  const cx = 100
  const cy = 100
  const r = 80
  const x = cx - r * Math.cos(angle)
  const y = cy - r * Math.sin(angle)
  const thrFrac = Math.min(thr / max, 1)
  const tAngle = Math.PI * thrFrac
  const tx = cx - r * Math.cos(tAngle)
  const ty = cy - r * Math.sin(tAngle)
  const over = display >= thr
  const color = over ? '#ef4444' : display >= thr * 0.75 ? '#f59e0b' : '#10b981'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-full max-w-xs">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#1e293b" strokeWidth="14" strokeLinecap="round" />
        <path
          d={`M20 100 A80 80 0 0 1 ${x} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* threshold marker */}
        <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="#fb923c" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx={tx} cy={ty} r="4" fill="#fb923c" />
        <text x="100" y="92" textAnchor="middle" className="fill-slate-100" fontSize="22" fontWeight="700">
          {pct(display)}
        </text>
        <text x="100" y="110" textAnchor="middle" className="fill-slate-500" fontSize="9">
          threshold {pct(thr)}
        </text>
      </svg>
      <Badge tone={over ? 'red' : display >= thr * 0.75 ? 'amber' : 'green'} className="mt-1">
        {over ? 'OVER THRESHOLD' : display >= thr * 0.75 ? 'APPROACHING' : 'HEALTHY'}
      </Badge>
    </div>
  )
}

export default function DashboardPage() {
  const [bootstrapping, setBootstrapping] = useState(true)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ratio, setRatio] = useState<any>(null)
  const [roi, setRoi] = useState<any>(null)
  const [board, setBoard] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])

  // workspace creation / join state
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const activeWs = useMemo(() => workspaces.find((w) => w.id === wsId) ?? null, [workspaces, wsId])

  const loadWorkspaces = useCallback(async () => {
    const list: Workspace[] = (await api.listWorkspaces()) ?? []
    setWorkspaces(list)
    const stored = getActiveWorkspace()
    const chosen = list.find((w) => w.id === stored)?.id ?? list[0]?.id ?? null
    setWsId(chosen)
    if (chosen) setActiveWorkspace(chosen)
    return chosen
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await loadWorkspaces()
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'Failed to load workspaces')
      } finally {
        if (alive) setBootstrapping(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces])

  const loadOverview = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const [r, o, b, a] = await Promise.all([
        api.getCurrentRatio(id).catch(() => null),
        api.getRoiSummary(id).catch(() => null),
        api.getDeadlineBoard(id).catch(() => null),
        api.listAlerts(id).catch(() => []),
      ])
      setRatio(r)
      setRoi(o)
      setBoard(b)
      setAlerts(Array.isArray(a) ? a : a?.alerts ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) loadOverview(wsId)
  }, [wsId, loadOverview])

  const onSelectWs = (id: string) => {
    setActiveWorkspace(id)
    setWsId(id)
  }

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy('create')
    setActionMsg(null)
    try {
      const ws: Workspace = await api.createWorkspace({ name: name.trim(), default_currency: currency })
      setName('')
      await loadWorkspaces()
      if (ws?.id) onSelectWs(ws.id)
    } catch (e: any) {
      setActionMsg(e?.message ?? 'Could not create workspace')
    } finally {
      setBusy(null)
    }
  }

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite.trim()) return
    setBusy('join')
    setActionMsg(null)
    try {
      const res = await api.joinWorkspace(invite.trim())
      setInvite('')
      const chosen = await loadWorkspaces()
      const joinedId = res?.workspace?.id ?? chosen
      if (joinedId) onSelectWs(joinedId)
    } catch (e: any) {
      setActionMsg(e?.message ?? 'Invalid invite code')
    } finally {
      setBusy(null)
    }
  }

  const onSeed = async () => {
    if (!wsId) return
    setSeeding(true)
    setActionMsg(null)
    try {
      await api.seedSample({ workspace_id: wsId })
      await loadOverview(wsId)
    } catch (e: any) {
      setActionMsg(e?.message ?? 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  if (bootstrapping) return <PageSpinner label="Loading workspaces..." />

  // ---- No workspace: picker / create / join ----
  if (workspaces.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">Welcome to the Deflection Desk</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create a workspace to start triaging prevention alerts, or join an existing team with an invite code.
          </p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {actionMsg && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {actionMsg}
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-100">Create workspace</h2>
            </CardHeader>
            <CardBody>
              <form onSubmit={onCreate} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme Disputes"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Default currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
                  >
                    {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={busy === 'create' || !name.trim()} className="w-full">
                  {busy === 'create' ? 'Creating...' : 'Create workspace'}
                </Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-100">Join with invite</h2>
            </CardHeader>
            <CardBody>
              <form onSubmit={onJoin} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Invite code</label>
                  <input
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    placeholder="ABC123"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-100 outline-none focus:border-orange-500"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={busy === 'join' || !invite.trim()} className="w-full">
                  {busy === 'join' ? 'Joining...' : 'Join workspace'}
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    )
  }

  const overall = ratio?.overall ?? {}
  const overallRatio: number = overall?.ratio ?? 0
  const threshold: number = overall?.excessive_ratio ?? overall?.threshold ?? 0.0125
  const summary = roi?.summary ?? roi ?? {}
  const currencyCode = activeWs?.default_currency ?? 'USD'
  const critical: any[] = board?.critical ?? []
  const warning: any[] = board?.warning ?? []
  const safe: any[] = board?.safe ?? []
  const recentAlerts = [...alerts].slice(0, 8)
  const isEmpty = !loading && alerts.length === 0 && critical.length === 0 && warning.length === 0

  return (
    <div className="space-y-6">
      {/* header + workspace switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Overview</h1>
          <p className="text-sm text-slate-400">Chargeback ratio guardrail, ROI, and the deflection deadline queue.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={wsId ?? ''}
            onChange={(e) => onSelectWs(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => wsId && loadOverview(wsId)} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {actionMsg && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {actionMsg}
        </div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading overview..." />
        </div>
      ) : isEmpty ? (
        <EmptyState
          title="No alerts yet"
          description="Seed sample data to explore the desk with realistic Visa, Mastercard and Amex prevention alerts, orders, and reason codes."
          action={
            <Button onClick={onSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed sample data'}
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Ratio gauge */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-100">Chargeback Ratio</h2>
                  <Link href="/dashboard/ratio" className="text-xs text-orange-400 hover:text-orange-300">
                    View guardrail →
                  </Link>
                </div>
              </CardHeader>
              <CardBody>
                <RatioGauge ratio={overallRatio} threshold={threshold} />
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {(ratio?.byNetwork ?? []).slice(0, 3).map((n: any) => (
                    <div key={n.network} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">{n.network}</div>
                      <div className="text-sm font-semibold text-slate-200">{pct(n.ratio)}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* ROI cards */}
            <div className="grid grid-cols-2 gap-4 lg:col-span-2">
              <Stat
                label="Net savings"
                tone="green"
                value={money(summary.net_savings_cents, currencyCode)}
                sub="Refunds vs chargeback cost avoided"
              />
              <Stat
                label="Chargebacks avoided"
                tone="orange"
                value={summary.chargebacks_avoided ?? summary.chargebacks_avoided_count ?? 0}
                sub={money(summary.chargeback_cost_avoided_cents, currencyCode) + ' value'}
              />
              <Stat
                label="Fines averted"
                value={money(summary.fines_averted_cents ?? summary.fine_averted_cents, currencyCode)}
                sub="Program fine exposure"
              />
              <Stat
                label="Reserve exposure reduced"
                value={money(summary.reserve_exposure_reduced_cents, currencyCode)}
                sub={<Link href="/dashboard/roi" className="text-orange-400 hover:text-orange-300">ROI detail →</Link>}
              />
            </div>
          </div>

          {/* deadline snippet */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-100">Deadline queue</h2>
                <Link href="/dashboard/deadlines" className="text-xs text-orange-400 hover:text-orange-300">
                  Full board →
                </Link>
              </div>
            </CardHeader>
            <CardBody>
              <div className="mb-4 flex flex-wrap gap-3">
                <Badge tone="red">Critical {critical.length}</Badge>
                <Badge tone="amber">Warning {warning.length}</Badge>
                <Badge tone="green">Safe {safe.length}</Badge>
              </div>
              {critical.length + warning.length === 0 ? (
                <p className="text-sm text-slate-500">No alerts approaching their deflection deadline.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Alert</TH>
                      <TH>Network</TH>
                      <TH>Amount</TH>
                      <TH>Deadline</TH>
                      <TH>Time left</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {[...critical, ...warning].slice(0, 6).map((a: any) => (
                      <TR key={a.id}>
                        <TD>
                          <Link href={`/dashboard/alerts/${a.id}`} className="text-orange-400 hover:text-orange-300">
                            {a.external_alert_id ?? a.id?.slice(0, 8)}
                          </Link>
                        </TD>
                        <TD className="uppercase">{a.network}</TD>
                        <TD>{money(a.amount_cents, a.currency ?? currencyCode)}</TD>
                        <TD className="text-slate-400">
                          {a.deadline_at ? new Date(a.deadline_at).toLocaleString() : '—'}
                        </TD>
                        <TD>
                          <Badge tone={urgencyTone(a.deadline_at)}>{timeLeft(a.deadline_at)}</Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* recent alerts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-100">Recent alerts</h2>
                <Link href="/dashboard/alerts" className="text-xs text-orange-400 hover:text-orange-300">
                  Triage queue →
                </Link>
              </div>
            </CardHeader>
            <CardBody>
              {recentAlerts.length === 0 ? (
                <p className="text-sm text-slate-500">No alerts received yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Alert</TH>
                      <TH>Network</TH>
                      <TH>Type</TH>
                      <TH>Reason</TH>
                      <TH>Amount</TH>
                      <TH>Status</TH>
                      <TH>Received</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recentAlerts.map((a: any) => (
                      <TR key={a.id}>
                        <TD>
                          <Link href={`/dashboard/alerts/${a.id}`} className="text-orange-400 hover:text-orange-300">
                            {a.external_alert_id ?? a.id?.slice(0, 8)}
                          </Link>
                        </TD>
                        <TD className="uppercase">{a.network}</TD>
                        <TD>{a.alert_type}</TD>
                        <TD className="text-slate-400">
                          {a.reason_code}
                          {a.reason_category ? ` · ${a.reason_category}` : ''}
                        </TD>
                        <TD>{money(a.amount_cents, a.currency ?? currencyCode)}</TD>
                        <TD>
                          <Badge
                            tone={
                              a.status === 'deflected'
                                ? 'green'
                                : a.status === 'lapsed'
                                  ? 'red'
                                  : a.is_duplicate
                                    ? 'purple'
                                    : 'slate'
                            }
                          >
                            {a.is_duplicate ? 'duplicate' : a.status}
                          </Badge>
                        </TD>
                        <TD className="text-slate-400">
                          {a.received_at ? new Date(a.received_at).toLocaleDateString() : '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
