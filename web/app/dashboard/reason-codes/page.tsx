'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'pad_workspace_id'

type ReasonCode = {
  id: string
  workspace_id: string
  network: string
  code: string
  description: string
  category: string
  typical_deflectability: string
  recommended_handling: string
  created_at: string
}

type ReasonStat = {
  reason_code?: string
  code?: string
  network?: string
  category?: string
  count?: number
  alert_count?: number
  deflected?: number
  deflected_count?: number
  represented?: number
  pending?: number
}

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover']
const CATEGORIES = ['fraud', 'authorization', 'processing_error', 'consumer_dispute', 'duplicate', 'subscription']
const DEFLECTABILITY = ['high', 'medium', 'low']

function networkTone(n: string): 'blue' | 'amber' | 'green' | 'purple' | 'slate' {
  const k = (n || '').toLowerCase()
  if (k === 'visa') return 'blue'
  if (k === 'mastercard') return 'amber'
  if (k === 'amex') return 'green'
  if (k === 'discover') return 'purple'
  return 'slate'
}

function deflectTone(d: string): 'green' | 'amber' | 'red' | 'slate' {
  const k = (d || '').toLowerCase()
  if (k === 'high') return 'green'
  if (k === 'medium') return 'amber'
  if (k === 'low') return 'red'
  return 'slate'
}

function blankForm() {
  return {
    network: 'visa',
    code: '',
    description: '',
    category: 'consumer_dispute',
    typical_deflectability: 'medium',
    recommended_handling: '',
  }
}

export default function ReasonCodesPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [codes, setCodes] = useState<ReasonCode[]>([])
  const [stats, setStats] = useState<ReasonStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [networkFilter, setNetworkFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ReasonCode | null>(null)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (workspaceId: string) => {
    setError(null)
    try {
      const [codesData, statsData] = await Promise.all([
        api.listReasonCodes(workspaceId),
        api.reasonCodeStats(workspaceId),
      ])
      setCodes(Array.isArray(codesData) ? codesData : [])
      setStats(Array.isArray(statsData) ? statsData : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reason codes')
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const workspaces = await api.listWorkspaces()
        if (!alive) return
        const list = Array.isArray(workspaces) ? workspaces : []
        if (list.length === 0) {
          setNoWorkspace(true)
          setLoading(false)
          return
        }
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const chosen = list.find((w: any) => w.id === stored)?.id ?? list[0].id
        setWs(chosen)
        await load(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [load])

  // Index stats by reason code for quick lookup in the table.
  const statByCode = useMemo(() => {
    const m = new Map<string, ReasonStat>()
    for (const s of stats) {
      const key = (s.reason_code ?? s.code ?? '').toString().toLowerCase()
      if (key) m.set(key, s)
    }
    return m
  }, [stats])

  function statCount(s?: ReasonStat) {
    if (!s) return 0
    return s.count ?? s.alert_count ?? 0
  }
  function statDeflected(s?: ReasonStat) {
    if (!s) return 0
    return s.deflected ?? s.deflected_count ?? 0
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return codes.filter((c) => {
      if (networkFilter !== 'all' && (c.network || '').toLowerCase() !== networkFilter) return false
      if (categoryFilter !== 'all' && (c.category || '').toLowerCase() !== categoryFilter) return false
      if (q) {
        const hay = `${c.code} ${c.description} ${c.category} ${c.recommended_handling}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [codes, search, networkFilter, categoryFilter])

  const summary = useMemo(() => {
    const totalAlerts = stats.reduce((acc, s) => acc + statCount(s), 0)
    const totalDeflected = stats.reduce((acc, s) => acc + statDeflected(s), 0)
    const byCategory = new Map<string, number>()
    for (const c of codes) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1)
    }
    const rate = totalAlerts > 0 ? Math.round((totalDeflected / totalAlerts) * 100) : 0
    return { totalCodes: codes.length, totalAlerts, totalDeflected, rate, categories: byCategory.size }
  }, [codes, stats])

  // Top reason codes by alert volume for the bar chart.
  const chartData = useMemo(() => {
    const rows = stats
      .map((s) => ({
        label: (s.reason_code ?? s.code ?? '?').toString(),
        network: s.network ?? '',
        count: statCount(s),
        deflected: statDeflected(s),
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0)
    return { rows, max }
  }, [stats])

  function openCreate() {
    setEditing(null)
    setForm(blankForm())
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(c: ReasonCode) {
    setEditing(c)
    setForm({
      network: c.network,
      code: c.code,
      description: c.description ?? '',
      category: c.category,
      typical_deflectability: c.typical_deflectability ?? 'medium',
      recommended_handling: c.recommended_handling ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!ws) return
    setFormError(null)
    if (!form.code.trim()) {
      setFormError('Code is required')
      return
    }
    if (!form.description.trim()) {
      setFormError('Description is required')
      return
    }
    const body = {
      workspace_id: ws,
      network: form.network,
      code: form.code.trim(),
      description: form.description.trim(),
      category: form.category,
      typical_deflectability: form.typical_deflectability,
      recommended_handling: form.recommended_handling.trim(),
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateReasonCode(editing.id, body)
      } else {
        await api.createReasonCode(body)
      }
      setModalOpen(false)
      await load(ws)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save reason code')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading reason codes..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace yet"
          description="Create or join a workspace from the dashboard before managing the reason code library."
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Reason codes</h1>
          <p className="mt-1 text-sm text-slate-400">
            The deflection playbook: per-network reason codes, their deflectability, and how often each one shows up in your alert volume.
          </p>
        </div>
        <Button onClick={openCreate}>+ New reason code</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Reason codes" value={summary.totalCodes} sub={`${summary.categories} categories`} />
        <Stat label="Alerts tagged" value={summary.totalAlerts.toLocaleString()} />
        <Stat label="Deflected" value={summary.totalDeflected.toLocaleString()} tone="green" />
        <Stat label="Deflection rate" value={`${summary.rate}%`} tone="orange" />
      </div>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold text-slate-200">Top reason codes by alert volume</div>
        </CardHeader>
        <CardBody>
          {chartData.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No alert statistics yet. Sync a feed or upload alerts to populate reason code volume.
            </p>
          ) : (
            <div className="space-y-3">
              {chartData.rows.map((r) => {
                const pct = chartData.max > 0 ? (r.count / chartData.max) * 100 : 0
                const deflPct = r.count > 0 ? (r.deflected / r.count) * 100 : 0
                return (
                  <div key={`${r.network}-${r.label}`} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 truncate text-xs font-medium text-slate-300" title={r.label}>
                      {r.label}
                    </div>
                    <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-md bg-orange-500/30"
                        style={{ width: `${pct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-md bg-emerald-500/50"
                        style={{ width: `${(pct * deflPct) / 100}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-end pr-2 text-xs tabular-nums text-slate-200">
                        {r.count} ({Math.round(deflPct)}% deflected)
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-4 pt-1 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500/30" /> Total alerts
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/50" /> Deflected
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-200">Library</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search codes..."
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All networks</option>
              {NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={codes.length === 0 ? 'No reason codes' : 'No codes match your filters'}
                description={
                  codes.length === 0
                    ? 'Add network reason codes to drive the deflection decision engine.'
                    : 'Adjust the search or filters to see more codes.'
                }
                action={codes.length === 0 ? <Button onClick={openCreate}>Add reason code</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH>Code</TH>
                  <TH>Description</TH>
                  <TH>Category</TH>
                  <TH>Deflectability</TH>
                  <TH className="text-right">Alerts</TH>
                  <TH className="text-right">Deflected</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const s = statByCode.get((c.code || '').toLowerCase())
                  const count = statCount(s)
                  const defl = statDeflected(s)
                  return (
                    <TR key={c.id}>
                      <TD>
                        <Badge tone={networkTone(c.network)}>{c.network}</Badge>
                      </TD>
                      <TD className="font-mono text-slate-100">{c.code}</TD>
                      <TD>
                        <div className="text-slate-200">{c.description}</div>
                        {c.recommended_handling && (
                          <div className="mt-0.5 text-xs text-slate-500">{c.recommended_handling}</div>
                        )}
                      </TD>
                      <TD>
                        <span className="text-xs text-slate-400">{c.category}</span>
                      </TD>
                      <TD>
                        <Badge tone={deflectTone(c.typical_deflectability)}>{c.typical_deflectability}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-slate-200">{count}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{defl}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => openEdit(c)}>
                          Edit
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit reason code' : 'New reason code'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create code'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Network</label>
              <select
                value={form.network}
                onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
                disabled={!!editing}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none disabled:opacity-60"
              >
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Code</label>
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editing}
                placeholder="13.1"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Merchandise / services not received"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Typical deflectability</label>
              <select
                value={form.typical_deflectability}
                onChange={(e) => setForm((f) => ({ ...f, typical_deflectability: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {DEFLECTABILITY.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Recommended handling</label>
            <textarea
              value={form.recommended_handling}
              onChange={(e) => setForm((f) => ({ ...f, recommended_handling: e.target.value }))}
              rows={2}
              placeholder="Refund immediately to deflect; chargeback cost exceeds margin."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
