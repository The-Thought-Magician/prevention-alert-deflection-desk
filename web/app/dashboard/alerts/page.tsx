'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type SavedView = { id: string; name: string; filters: Record<string, string> }

const NETWORKS = ['', 'visa', 'mastercard', 'amex']
const STATUSES = ['', 'new', 'in_review', 'deflected', 'lapsed', 'represented', 'duplicate']
const URGENCIES = ['', 'critical', 'warning', 'safe']

function money(cents?: number | null, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
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

function statusTone(status?: string, dup?: boolean): 'green' | 'red' | 'purple' | 'blue' | 'slate' {
  if (dup) return 'purple'
  if (status === 'deflected') return 'green'
  if (status === 'lapsed') return 'red'
  if (status === 'in_review') return 'blue'
  return 'slate'
}

export default function AlertsQueuePage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>([])

  // filters
  const [network, setNetwork] = useState('')
  const [status, setStatus] = useState('')
  const [urgency, setUrgency] = useState('')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')

  // saved-view modal
  const [saveOpen, setSaveOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      ...(network ? { network } : {}),
      ...(status ? { status } : {}),
      ...(urgency ? { urgency } : {}),
      ...(reason ? { reason } : {}),
    }),
    [network, status, urgency, reason],
  )

  useEffect(() => {
    setWsId(getActiveWorkspace())
  }, [])

  const loadAlerts = useCallback(
    async (id: string, f: Record<string, string>) => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.listAlerts(id, f)
        setAlerts(Array.isArray(res) ? res : (res?.alerts ?? []))
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load alerts')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const loadViews = useCallback(async (id: string) => {
    try {
      const v = await api.listSavedViews(id)
      setSavedViews(Array.isArray(v) ? v : [])
    } catch {
      setSavedViews([])
    }
  }, [])

  useEffect(() => {
    if (!wsId) return
    loadAlerts(wsId, filters)
  }, [wsId, filters, loadAlerts])

  useEffect(() => {
    if (wsId) loadViews(wsId)
  }, [wsId, loadViews])

  const applyView = (v: SavedView) => {
    const f = v.filters ?? {}
    setNetwork(f.network ?? '')
    setStatus(f.status ?? '')
    setUrgency(f.urgency ?? '')
    setReason(f.reason ?? '')
    setNotice(`Applied view "${v.name}"`)
  }

  const clearFilters = () => {
    setNetwork('')
    setStatus('')
    setUrgency('')
    setReason('')
    setSearch('')
  }

  const onSaveView = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wsId || !viewName.trim()) return
    setBusy('save')
    try {
      await api.createSavedView({ workspace_id: wsId, name: viewName.trim(), filters })
      setViewName('')
      setSaveOpen(false)
      await loadViews(wsId)
      setNotice('Saved view created')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save view')
    } finally {
      setBusy(null)
    }
  }

  const onDeleteView = async (id: string) => {
    if (!wsId) return
    try {
      await api.deleteSavedView(id)
      await loadViews(wsId)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete view')
    }
  }

  const onBatchEvaluate = async () => {
    if (!wsId) return
    setBusy('batch')
    setNotice(null)
    try {
      const res = await api.batchEvaluate({ workspace_id: wsId })
      setNotice(`Evaluated ${res?.evaluated ?? 0} undecided alert(s)`)
      await loadAlerts(wsId, filters)
    } catch (e: any) {
      setError(e?.message ?? 'Batch evaluation failed')
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return alerts
    return alerts.filter((a) =>
      [a.external_alert_id, a.arn, a.card_last4, a.reason_code, a.reason_category, a.network]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(q)),
    )
  }, [alerts, search])

  if (!wsId && loading) return <PageSpinner label="Loading triage queue..." />

  if (!wsId) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick or create a workspace from the dashboard first."
        action={
          <Link href="/dashboard">
            <Button>Go to dashboard</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Triage queue</h1>
          <p className="text-sm text-slate-400">Filter prevention alerts and run the decision engine in bulk.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setSaveOpen(true)}>
            Save view
          </Button>
          <Button onClick={onBatchEvaluate} disabled={busy === 'batch'}>
            {busy === 'batch' ? 'Evaluating...' : 'Batch evaluate'}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {/* saved views */}
      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Saved views:</span>
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-1 py-0.5">
              <button
                onClick={() => applyView(v)}
                className="rounded-full px-2 py-0.5 text-xs text-slate-300 hover:text-orange-300"
              >
                {v.name}
              </button>
              <button
                onClick={() => onDeleteView(v.id)}
                className="px-1 text-slate-500 hover:text-red-400"
                aria-label={`Delete ${v.name}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* filters */}
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Network</label>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            >
              {NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n ? n.toUpperCase() : 'All networks'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s ? s.replace('_', ' ') : 'All statuses'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Urgency</label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            >
              {URGENCIES.map((u) => (
                <option key={u} value={u}>
                  {u ? u : 'All urgencies'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Reason code</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. 13.1"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ARN, alert id, last4..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
        </CardBody>
        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
          <span className="text-xs text-slate-500">
            {loading ? 'Loading...' : `${filtered.length} alert${filtered.length === 1 ? '' : 's'}`}
          </span>
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      </Card>

      {/* table */}
      {loading ? (
        <div className="py-16">
          <Spinner label="Loading alerts..." />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No alerts match"
          description="Adjust your filters, or seed sample data from the dashboard to populate the queue."
          action={
            <Link href="/dashboard">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          }
        />
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
              <TH>Deadline</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link href={`/dashboard/alerts/${a.id}`} className="font-medium text-orange-400 hover:text-orange-300">
                    {a.external_alert_id ?? a.id?.slice(0, 8)}
                  </Link>
                  {a.card_last4 && <div className="text-xs text-slate-500">•••• {a.card_last4}</div>}
                </TD>
                <TD className="uppercase">{a.network}</TD>
                <TD>{a.alert_type}</TD>
                <TD className="text-slate-400">
                  {a.reason_code}
                  {a.reason_category ? <div className="text-xs">{a.reason_category}</div> : null}
                </TD>
                <TD>{money(a.amount_cents, a.currency)}</TD>
                <TD>
                  <Badge tone={statusTone(a.status, a.is_duplicate)}>
                    {a.is_duplicate ? 'duplicate' : a.status}
                  </Badge>
                </TD>
                <TD>
                  <Badge tone={urgencyTone(a.deadline_at)}>{timeLeft(a.deadline_at)}</Badge>
                </TD>
                <TD>
                  <Link href={`/dashboard/alerts/${a.id}`} className="text-xs text-orange-400 hover:text-orange-300">
                    Open →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save current filters as a view"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSaveView} disabled={busy === 'save' || !viewName.trim()}>
              {busy === 'save' ? 'Saving...' : 'Save view'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSaveView} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">View name</label>
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="Critical Visa alerts"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
            />
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            <div className="mb-1 font-medium text-slate-300">Filters captured</div>
            {Object.keys(filters).length === 0 ? (
              <span>No filters set (matches all alerts)</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(filters).map(([k, v]) => (
                  <Badge key={k} tone="orange">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </form>
      </Modal>
    </div>
  )
}
