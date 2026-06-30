'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'

const WS_KEY = 'padd:workspace'

type Order = {
  id?: string
  external_order_id?: string
  arn?: string
  card_last4?: string
  amount_cents?: number
  currency?: string
  margin_cents?: number
  product?: string
  recoverable?: boolean
  refundable?: boolean
  captured_at?: string
  created_at?: string
}

function money(cents?: number, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
}

const BLANK = {
  external_order_id: '',
  arn: '',
  card_last4: '',
  amount: '',
  currency: 'USD',
  margin: '',
  product: '',
  recoverable: true,
  refundable: true,
  captured_at: '',
}

const SAMPLE_CSV =
  'external_order_id,arn,card_last4,amount,currency,margin,product,recoverable,refundable\n' +
  'ORD-1001,74899921001,4242,129.00,USD,42.00,Pro Plan,true,true\n' +
  'ORD-1002,74899921002,1881,59.00,USD,18.00,Starter Plan,true,false'

export default function OrdersPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Order[]>([])
  const [search, setSearch] = useState('')
  const [flagFilter, setFlagFilter] = useState<'all' | 'refundable' | 'recoverable' | 'locked'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    setWs(typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null)
  }, [])

  const load = useCallback(async (workspace: string) => {
    setError(null)
    try {
      const r = await api.listOrders(workspace)
      setOrders(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders')
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (flagFilter === 'refundable' && !o.refundable) return false
      if (flagFilter === 'recoverable' && !o.recoverable) return false
      if (flagFilter === 'locked' && o.refundable) return false
      if (!q) return true
      return (
        (o.external_order_id ?? '').toLowerCase().includes(q) ||
        (o.arn ?? '').toLowerCase().includes(q) ||
        (o.product ?? '').toLowerCase().includes(q) ||
        (o.card_last4 ?? '').toLowerCase().includes(q)
      )
    })
  }, [orders, search, flagFilter])

  const totals = useMemo(() => {
    const value = orders.reduce((s, o) => s + (o.amount_cents ?? 0), 0)
    const margin = orders.reduce((s, o) => s + (o.margin_cents ?? 0), 0)
    const refundable = orders.filter((o) => o.refundable).length
    return { value, margin, refundable }
  }, [orders])

  const resetForm = () => {
    setForm({ ...BLANK })
    setFormError(null)
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws) return
    setSaving(true)
    setFormError(null)
    try {
      const amount = Number.parseFloat(form.amount)
      if (!form.external_order_id.trim()) throw new Error('External order ID is required')
      if (Number.isNaN(amount)) throw new Error('Amount must be a number')
      const body: Record<string, unknown> = {
        workspace_id: ws,
        external_order_id: form.external_order_id.trim(),
        arn: form.arn.trim() || undefined,
        card_last4: form.card_last4.trim() || undefined,
        amount_cents: Math.round(amount * 100),
        currency: form.currency.trim() || 'USD',
        product: form.product.trim() || undefined,
        recoverable: form.recoverable,
        refundable: form.refundable,
      }
      if (form.margin.trim() !== '') {
        const m = Number.parseFloat(form.margin)
        if (!Number.isNaN(m)) body.margin_cents = Math.round(m * 100)
      }
      if (form.captured_at) body.captured_at = new Date(form.captured_at).toISOString()
      await api.createOrder(body)
      setCreateOpen(false)
      resetForm()
      await load(ws)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  const parseCsv = (text: string): Record<string, unknown>[] => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return []
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
    const rows: Record<string, unknown>[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim())
      const row: Record<string, string> = {}
      headers.forEach((h, idx) => (row[h] = cells[idx] ?? ''))
      const amount = Number.parseFloat(row.amount ?? row.amount_cents ?? '')
      const margin = Number.parseFloat(row.margin ?? row.margin_cents ?? '')
      const obj: Record<string, unknown> = {
        external_order_id: row.external_order_id || row.order_id || '',
        arn: row.arn || undefined,
        card_last4: row.card_last4 || row.last4 || undefined,
        amount_cents: row.amount_cents
          ? Math.round(Number.parseFloat(row.amount_cents) || 0)
          : Number.isNaN(amount)
          ? 0
          : Math.round(amount * 100),
        currency: row.currency || 'USD',
        product: row.product || undefined,
        recoverable: row.recoverable ? /^(1|true|yes|y)$/i.test(row.recoverable) : true,
        refundable: row.refundable ? /^(1|true|yes|y)$/i.test(row.refundable) : true,
      }
      if (!Number.isNaN(margin)) {
        obj.margin_cents = row.margin_cents
          ? Math.round(Number.parseFloat(row.margin_cents) || 0)
          : Math.round(margin * 100)
      }
      rows.push(obj)
    }
    return rows
  }

  const submitBulk = async () => {
    if (!ws) return
    setBulkSaving(true)
    setBulkError(null)
    setBulkResult(null)
    try {
      const rows = parseCsv(csv)
      if (rows.length === 0) throw new Error('No valid rows parsed. Include a header row and at least one data row.')
      const res = await api.bulkOrders({ workspace_id: ws, rows })
      const created = (res && (res.created ?? res.count)) ?? rows.length
      setBulkResult(`${created} order(s) created.`)
      setCsv('')
      await load(ws)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk upload failed')
    } finally {
      setBulkSaving(false)
    }
  }

  const remove = async (id?: string) => {
    if (!id || !ws) return
    if (!window.confirm('Delete this order? This cannot be undone.')) return
    setDeletingId(id)
    setError(null)
    try {
      await api.deleteOrder(id)
      await load(ws)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete order')
    } finally {
      setDeletingId(null)
    }
  }

  if (ws === null) return <PageSpinner label="Loading workspace..." />

  if (!ws) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick or create a workspace on the dashboard to manage orders."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  if (loading) return <PageSpinner label="Loading orders..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Orders Registry</h1>
          <p className="mt-1 text-sm text-slate-400">
            Transaction records that prevention alerts are matched against by ARN and card last-4.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setBulkOpen(true); setBulkError(null); setBulkResult(null) }}>
            Bulk upload
          </Button>
          <Button onClick={() => { resetForm(); setCreateOpen(true) }}>New order</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders" value={orders.length.toLocaleString()} />
        <Stat label="Gross value" value={money(totals.value)} tone="orange" />
        <Stat label="Margin at risk" value={money(totals.margin)} />
        <Stat label="Refundable" value={`${totals.refundable}/${orders.length}`} tone="green" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              Orders <span className="text-slate-500">({filtered.length})</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search id / ARN / product / last4"
                className="w-60 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
              <select
                value={flagFilter}
                onChange={(e) => setFlagFilter(e.target.value as typeof flagFilter)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All orders</option>
                <option value="refundable">Refundable</option>
                <option value="recoverable">Recoverable</option>
                <option value="locked">Not refundable</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {orders.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No orders yet"
                description="Create an order or bulk-upload a CSV to start matching prevention alerts."
                action={<Button onClick={() => { resetForm(); setCreateOpen(true) }}>New order</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No matching orders" description="Adjust your search or filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Order ID</TH>
                  <TH>Product</TH>
                  <TH>ARN</TH>
                  <TH>Last4</TH>
                  <TH>Amount</TH>
                  <TH>Margin</TH>
                  <TH>Flags</TH>
                  <TH>Captured</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((o, i) => (
                  <TR key={o.id ?? o.external_order_id ?? i}>
                    <TD>
                      {o.id ? (
                        <a href={`/dashboard/orders/${o.id}`} className="font-medium text-orange-300 hover:text-orange-200">
                          {o.external_order_id ?? o.id}
                        </a>
                      ) : (
                        <span className="font-medium text-slate-100">{o.external_order_id ?? '—'}</span>
                      )}
                    </TD>
                    <TD>{o.product ?? '—'}</TD>
                    <TD className="font-mono text-xs">{o.arn ?? '—'}</TD>
                    <TD className="font-mono text-xs">{o.card_last4 ? `••${o.card_last4}` : '—'}</TD>
                    <TD className="font-medium text-slate-100">{money(o.amount_cents, o.currency)}</TD>
                    <TD>{o.margin_cents != null ? money(o.margin_cents, o.currency) : '—'}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {o.refundable ? <Badge tone="green">refundable</Badge> : <Badge tone="slate">locked</Badge>}
                        {o.recoverable && <Badge tone="blue">recoverable</Badge>}
                      </div>
                    </TD>
                    <TD>{o.captured_at ? new Date(o.captured_at).toLocaleDateString() : '—'}</TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => remove(o.id)}
                        disabled={deletingId === o.id}
                      >
                        {deletingId === o.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create order modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New order"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="order-create-form" disabled={saving}>
              {saving ? 'Saving...' : 'Create order'}
            </Button>
          </>
        }
      >
        <form id="order-create-form" onSubmit={submitCreate} className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="External order ID *">
            <input
              value={form.external_order_id}
              onChange={(e) => setForm({ ...form, external_order_id: e.target.value })}
              className={inputCls}
              placeholder="ORD-1001"
              required
            />
          </Field>
          <Field label="Product">
            <input
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
              className={inputCls}
              placeholder="Pro Plan"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ARN">
              <input
                value={form.arn}
                onChange={(e) => setForm({ ...form, arn: e.target.value })}
                className={inputCls}
                placeholder="74899921001"
              />
            </Field>
            <Field label="Card last 4">
              <input
                value={form.card_last4}
                onChange={(e) => setForm({ ...form, card_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                className={inputCls}
                placeholder="4242"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount *">
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={inputCls}
                placeholder="129.00"
                inputMode="decimal"
                required
              />
            </Field>
            <Field label="Margin">
              <input
                value={form.margin}
                onChange={(e) => setForm({ ...form, margin: e.target.value })}
                className={inputCls}
                placeholder="42.00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })}
                className={inputCls}
                placeholder="USD"
              />
            </Field>
          </div>
          <Field label="Captured at">
            <input
              type="datetime-local"
              value={form.captured_at}
              onChange={(e) => setForm({ ...form, captured_at: e.target.value })}
              className={inputCls}
            />
          </Field>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.refundable}
                onChange={(e) => setForm({ ...form, refundable: e.target.checked })}
                className="h-4 w-4 accent-orange-500"
              />
              Refundable
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.recoverable}
                onChange={(e) => setForm({ ...form, recoverable: e.target.checked })}
                className="h-4 w-4 accent-orange-500"
              />
              Recoverable
            </label>
          </div>
        </form>
      </Modal>

      {/* Bulk upload modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk upload orders"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
              Close
            </Button>
            <Button onClick={submitBulk} disabled={bulkSaving || !csv.trim()}>
              {bulkSaving ? 'Uploading...' : 'Upload'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Paste CSV with a header row. Recognized columns: <code className="text-slate-300">external_order_id, arn, card_last4, amount, currency, margin, product, recoverable, refundable</code>.
          </p>
          <button
            type="button"
            onClick={() => setCsv(SAMPLE_CSV)}
            className="text-xs text-orange-300 hover:text-orange-200"
          >
            Insert sample CSV
          </button>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            placeholder={SAMPLE_CSV}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
          />
          {csv.trim() && (
            <p className="text-xs text-slate-500">{parseCsv(csv).length} row(s) detected.</p>
          )}
          {bulkError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {bulkError}
            </div>
          )}
          {bulkResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {bulkResult}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
