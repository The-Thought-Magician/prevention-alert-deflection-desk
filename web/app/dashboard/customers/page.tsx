'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Customer {
  id: string
  workspace_id: string
  external_ref: string | null
  email: string | null
  name: string | null
  is_watchlisted: boolean
  risk_score: number | null
  notes: string | null
  created_at: string
}

interface CustomerDetail {
  customer: Customer
  stats?: {
    order_count?: number
    alert_count?: number
    refund_count?: number
    total_refunded_cents?: number
    deflection_rate?: number
  }
  alerts?: Array<{
    id: string
    network: string | null
    reason_code: string | null
    status: string | null
    amount_cents: number
    currency: string
    received_at: string | null
  }>
  orders?: Array<{
    id: string
    external_order_id: string
    product: string | null
    amount_cents: number
    currency: string
    captured_at: string | null
  }>
}

const WS_KEY = 'pd_workspace_id'

function money(cents: number | null | undefined, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `${currency} ${v.toFixed(2)}`
  }
}

function date(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function riskTone(score: number | null | undefined) {
  const s = score ?? 0
  if (s >= 70) return 'red' as const
  if (s >= 40) return 'amber' as const
  return 'green' as const
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(WS_KEY)
    if (stored) return stored
  }
  try {
    const ws = await api.listWorkspaces()
    const first = Array.isArray(ws) ? ws[0] : null
    if (first?.id) {
      if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, first.id)
      return first.id
    }
  } catch {
    /* ignore */
  }
  return null
}

export default function CustomersPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'watchlist' | 'high-risk'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', external_ref: '', notes: '' })

  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editRisk, setEditRisk] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listCustomers(ws)
      setCustomers(Array.isArray(res) ? res : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const ws = await resolveWorkspaceId()
      if (!alive) return
      setWsId(ws)
      if (ws) await load(ws)
      else setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter((c) => {
      if (filter === 'watchlist' && !c.is_watchlisted) return false
      if (filter === 'high-risk' && (c.risk_score ?? 0) < 70) return false
      if (!q) return true
      return [c.name, c.email, c.external_ref]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [customers, search, filter])

  const watchCount = customers.filter((c) => c.is_watchlisted).length
  const highRiskCount = customers.filter((c) => (c.risk_score ?? 0) >= 70).length

  async function createCustomer() {
    if (!wsId) return
    setSaving(true)
    setCreateErr(null)
    try {
      await api.createCustomer({
        workspace_id: wsId,
        name: form.name || null,
        email: form.email || null,
        external_ref: form.external_ref || null,
        notes: form.notes || null,
      })
      setCreateOpen(false)
      setForm({ name: '', email: '', external_ref: '', notes: '' })
      await load(wsId)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to create customer')
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetail(null)
    setDetailErr(null)
    setDetailLoading(true)
    try {
      const res = await api.getCustomer(id)
      const d: CustomerDetail = res?.customer ? res : { customer: res }
      setDetail(d)
      setEditNotes(d.customer?.notes ?? '')
      setEditRisk(d.customer?.risk_score != null ? String(d.customer.risk_score) : '')
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'Failed to load customer')
    } finally {
      setDetailLoading(false)
    }
  }

  async function saveDetail() {
    if (!detail?.customer || !wsId) return
    setSavingEdit(true)
    try {
      const risk = editRisk.trim() === '' ? null : Number(editRisk)
      const updated = await api.updateCustomer(detail.customer.id, {
        notes: editNotes || null,
        risk_score: risk,
      })
      const newCust = updated?.id ? updated : { ...detail.customer, notes: editNotes, risk_score: risk }
      setDetail({ ...detail, customer: newCust })
      setCustomers((prev) => prev.map((c) => (c.id === newCust.id ? { ...c, ...newCust } : c)))
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingEdit(false)
    }
  }

  async function watchlist(id: string) {
    setBusyId(id)
    try {
      const updated = await api.toggleWatchlist(id)
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, is_watchlisted: updated?.is_watchlisted ?? !c.is_watchlisted }
            : c,
        ),
      )
      if (detail?.customer?.id === id) {
        setDetail({
          ...detail,
          customer: {
            ...detail.customer,
            is_watchlisted: updated?.is_watchlisted ?? !detail.customer.is_watchlisted,
          },
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle watchlist')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading customers..." />

  if (!wsId) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Create or select a workspace on the dashboard to manage customers."
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Customers</h1>
          <p className="mt-1 text-sm text-neutral-400">
            History, risk scoring, and deflection watchlist.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New customer</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total customers" value={customers.length} />
        <Stat label="Watchlisted" value={watchCount} tone="orange" />
        <Stat label="High risk" value={highRiskCount} tone="red" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {(['all', 'watchlist', 'high-risk'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-orange-500/15 text-orange-300'
                      : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'watchlist' ? 'Watchlist' : 'High risk'}
                </button>
              ))}
            </div>
            <input
              placeholder="Search name, email, ref..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-orange-500 focus:outline-none sm:w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {error && (
            <div className="m-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No customers found"
                description={
                  customers.length === 0
                    ? 'Add a customer or seed sample data to get started.'
                    : 'No customers match your filters.'
                }
                action={
                  customers.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>+ New customer</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>External ref</TH>
                  <TH>Risk</TH>
                  <TH>Watchlist</TH>
                  <TH>Added</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <button
                        onClick={() => openDetail(c.id)}
                        className="text-left font-medium text-neutral-100 hover:text-orange-300"
                      >
                        {c.name || c.email || c.external_ref || 'Unnamed customer'}
                      </button>
                      {c.email && c.name && (
                        <div className="text-xs text-neutral-500">{c.email}</div>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{c.external_ref || '—'}</TD>
                    <TD>
                      <Badge tone={riskTone(c.risk_score)}>{c.risk_score ?? 0}</Badge>
                    </TD>
                    <TD>
                      {c.is_watchlisted ? (
                        <Badge tone="orange">On watchlist</Badge>
                      ) : (
                        <span className="text-xs text-neutral-600">—</span>
                      )}
                    </TD>
                    <TD>{date(c.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="!px-2.5 !py-1 text-xs"
                          disabled={busyId === c.id}
                          onClick={() => watchlist(c.id)}
                        >
                          {c.is_watchlisted ? 'Unwatch' : 'Watch'}
                        </Button>
                        <button
                          onClick={() => openDetail(c.id)}
                          className="text-sm text-orange-400 hover:text-orange-300"
                        >
                          View
                        </button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New customer"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={createCustomer} disabled={saving}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {createErr}
            </div>
          )}
          <FormField label="Name">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              className={inputCls}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>
          <FormField label="External reference">
            <input
              className={inputCls}
              placeholder="Customer ID from your store"
              value={form.external_ref}
              onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FormField>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        className="max-w-3xl"
        title={
          detail?.customer
            ? detail.customer.name || detail.customer.email || 'Customer profile'
            : 'Customer profile'
        }
        footer={
          detail?.customer ? (
            <>
              <Button
                variant="secondary"
                disabled={busyId === detail.customer.id}
                onClick={() => watchlist(detail.customer.id)}
              >
                {detail.customer.is_watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
              </Button>
              <Button onClick={saveDetail} disabled={savingEdit}>
                {savingEdit ? 'Saving...' : 'Save changes'}
              </Button>
            </>
          ) : undefined
        }
      >
        {detailLoading ? (
          <Spinner label="Loading profile..." className="py-10" />
        ) : detailErr ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {detailErr}
          </div>
        ) : detail?.customer ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={riskTone(detail.customer.risk_score)}>
                Risk {detail.customer.risk_score ?? 0}
              </Badge>
              {detail.customer.is_watchlisted && <Badge tone="orange">On watchlist</Badge>}
              {detail.customer.external_ref && (
                <span className="font-mono text-xs text-neutral-500">
                  {detail.customer.external_ref}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Orders" value={detail.stats?.order_count ?? detail.orders?.length ?? 0} />
              <MiniStat label="Alerts" value={detail.stats?.alert_count ?? detail.alerts?.length ?? 0} />
              <MiniStat label="Refunds" value={detail.stats?.refund_count ?? 0} />
              <MiniStat
                label="Refunded"
                value={money(detail.stats?.total_refunded_cents ?? 0)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Risk score (0-100)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  value={editRisk}
                  onChange={(e) => setEditRisk(e.target.value)}
                />
              </FormField>
              <div />
            </div>
            <FormField label="Notes">
              <textarea
                className={`${inputCls} min-h-[70px]`}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </FormField>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Recent orders
              </div>
              {detail.orders && detail.orders.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.orders.slice(0, 6).map((o) => (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:border-neutral-700"
                    >
                      <span className="font-mono text-neutral-300">{o.external_order_id}</span>
                      <span className="text-neutral-400">{o.product || '—'}</span>
                      <span className="text-neutral-100">{money(o.amount_cents, o.currency)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No orders on file.</p>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Alert history
              </div>
              {detail.alerts && detail.alerts.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.alerts.slice(0, 8).map((a) => (
                    <Link
                      key={a.id}
                      href={`/dashboard/alerts/${a.id}`}
                      className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm hover:border-neutral-700"
                    >
                      <span className="text-neutral-300">{a.network || '—'}</span>
                      <span className="text-neutral-400">{a.reason_code || '—'}</span>
                      <Badge tone="slate">{a.status || 'new'}</Badge>
                      <span className="text-neutral-100">{money(a.amount_cents, a.currency)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No alerts for this customer.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-orange-500 focus:outline-none'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  )
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-neutral-100">{value}</div>
    </div>
  )
}
