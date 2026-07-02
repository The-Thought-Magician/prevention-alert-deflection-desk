'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Order {
  id: string
  workspace_id: string
  customer_id: string | null
  external_order_id: string
  arn: string | null
  card_last4: string | null
  amount_cents: number
  currency: string
  margin_cents: number | null
  product: string | null
  recoverable: boolean
  refundable: boolean
  captured_at: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface Alert {
  id: string
  network: string | null
  alert_type: string | null
  reason_code: string | null
  reason_category: string | null
  status: string | null
  amount_cents: number
  currency: string
  received_at: string | null
  deadline_at: string | null
}

interface Refund {
  id: string
  amount_cents: number
  currency: string
  method: string | null
  source: string | null
  created_at: string
}

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
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function statusTone(status: string | null | undefined) {
  switch ((status ?? '').toLowerCase()) {
    case 'deflected':
    case 'resolved':
      return 'green' as const
    case 'lapsed':
    case 'breach':
      return 'red' as const
    case 'pending':
    case 'new':
      return 'amber' as const
    default:
      return 'slate' as const
  }
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [order, setOrder] = useState<Order | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    product: '',
    amount: '',
    margin: '',
    card_last4: '',
    arn: '',
    recoverable: true,
    refundable: true,
  })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getOrder(id)
      const o: Order = res?.order ?? res
      setOrder(o)
      setAlerts(Array.isArray(res?.alerts) ? res.alerts : [])
      setRefunds(Array.isArray(res?.refunds) ? res.refunds : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  function openEdit() {
    if (!order) return
    setSaveErr(null)
    setForm({
      product: order.product ?? '',
      amount: ((order.amount_cents ?? 0) / 100).toString(),
      margin: order.margin_cents != null ? (order.margin_cents / 100).toString() : '',
      card_last4: order.card_last4 ?? '',
      arn: order.arn ?? '',
      recoverable: !!order.recoverable,
      refundable: !!order.refundable,
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!order) return
    setSaving(true)
    setSaveErr(null)
    try {
      const amountCents = Math.round(parseFloat(form.amount || '0') * 100)
      const marginCents =
        form.margin.trim() === '' ? null : Math.round(parseFloat(form.margin) * 100)
      await api.updateOrder(order.id, {
        product: form.product || null,
        amount_cents: Number.isFinite(amountCents) ? amountCents : order.amount_cents,
        margin_cents: marginCents,
        card_last4: form.card_last4 || null,
        arn: form.arn || null,
        recoverable: form.recoverable,
        refundable: form.refundable,
      })
      setEditOpen(false)
      await load()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading order..." />

  if (error || !order) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link href="/dashboard/orders" className="text-sm text-orange-400 hover:text-orange-300">
          ← Back to orders
        </Link>
        <div className="mt-6">
          <EmptyState
            title="Could not load this order"
            description={error ?? 'The order was not found.'}
            action={
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const cur = order.currency || 'USD'
  const totalRefunded = refunds.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  const openAlerts = alerts.filter(
    (a) => !['deflected', 'resolved', 'lapsed'].includes((a.status ?? '').toLowerCase()),
  ).length

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/dashboard/orders"
            className="text-sm text-orange-400 hover:text-orange-300"
          >
            ← Back to orders
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-neutral-100">
            Order {order.external_order_id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {order.product && <Badge tone="slate">{order.product}</Badge>}
            <Badge tone={order.refundable ? 'green' : 'slate'}>
              {order.refundable ? 'Refundable' : 'Non-refundable'}
            </Badge>
            <Badge tone={order.recoverable ? 'blue' : 'slate'}>
              {order.recoverable ? 'Recoverable' : 'Not recoverable'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.customer_id && (
            <Link href="/dashboard/customers">
              <Button variant="secondary">View customer</Button>
            </Link>
          )}
          <Button onClick={openEdit}>Edit order</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Order amount" value={money(order.amount_cents, cur)} />
        <Stat
          label="Margin"
          value={order.margin_cents != null ? money(order.margin_cents, cur) : '—'}
          tone="green"
        />
        <Stat
          label="Linked alerts"
          value={alerts.length}
          sub={`${openAlerts} open`}
          tone={openAlerts > 0 ? 'orange' : 'default'}
        />
        <Stat
          label="Refunded"
          value={money(totalRefunded, cur)}
          sub={`${refunds.length} refund${refunds.length === 1 ? '' : 's'}`}
          tone={totalRefunded > 0 ? 'red' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Order details</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="External order ID" value={order.external_order_id} mono />
            <Field label="ARN" value={order.arn || '—'} mono />
            <Field label="Card last 4" value={order.card_last4 ? `•••• ${order.card_last4}` : '—'} />
            <Field label="Currency" value={cur} />
            <Field label="Captured at" value={date(order.captured_at)} />
            <Field label="Created at" value={date(order.created_at)} />
          </dl>
          {order.metadata && Object.keys(order.metadata).length > 0 && (
            <div className="mt-5">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Metadata
              </div>
              <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-300">
                {JSON.stringify(order.metadata, null, 2)}
              </pre>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Linked alerts</h2>
            <Badge tone="orange">{alerts.length}</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {alerts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No alerts linked to this order"
                description="Alerts matched by ARN or card last-4 will appear here."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Network</TH>
                  <TH>Type</TH>
                  <TH>Reason</TH>
                  <TH>Amount</TH>
                  <TH>Status</TH>
                  <TH>Deadline</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {alerts.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.network || '—'}</TD>
                    <TD>{a.alert_type || '—'}</TD>
                    <TD>
                      <span className="text-neutral-200">{a.reason_code || '—'}</span>
                      {a.reason_category && (
                        <span className="ml-1 text-xs text-neutral-500">{a.reason_category}</span>
                      )}
                    </TD>
                    <TD>{money(a.amount_cents, a.currency || cur)}</TD>
                    <TD>
                      <Badge tone={statusTone(a.status)}>{a.status || 'unknown'}</Badge>
                    </TD>
                    <TD>{date(a.deadline_at)}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/dashboard/alerts/${a.id}`}
                        className="text-sm text-orange-400 hover:text-orange-300"
                      >
                        Open
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Refunds</h2>
            <Badge tone="red">{refunds.length}</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {refunds.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No refunds against this order"
                description="Deflection refunds executed for linked alerts will be recorded here."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Amount</TH>
                  <TH>Method</TH>
                  <TH>Source</TH>
                  <TH>Executed</TH>
                </TR>
              </THead>
              <TBody>
                {refunds.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-neutral-100">
                      {money(r.amount_cents, r.currency || cur)}
                    </TD>
                    <TD>{r.method || '—'}</TD>
                    <TD>
                      <Badge tone={r.source === 'auto' ? 'purple' : 'slate'}>
                        {r.source || 'manual'}
                      </Badge>
                    </TD>
                    <TD>{date(r.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit order"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {saveErr}
            </div>
          )}
          <FormField label="Product">
            <input
              className={inputCls}
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={`Amount (${cur})`}>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </FormField>
            <FormField label={`Margin (${cur})`}>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={form.margin}
                onChange={(e) => setForm({ ...form, margin: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Card last 4">
              <input
                className={inputCls}
                maxLength={4}
                value={form.card_last4}
                onChange={(e) => setForm({ ...form, card_last4: e.target.value })}
              />
            </FormField>
            <FormField label="ARN">
              <input
                className={inputCls}
                value={form.arn}
                onChange={(e) => setForm({ ...form, arn: e.target.value })}
              />
            </FormField>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-500"
                checked={form.recoverable}
                onChange={(e) => setForm({ ...form, recoverable: e.target.checked })}
              />
              Recoverable
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-500"
                checked={form.refundable}
                onChange={(e) => setForm({ ...form, refundable: e.target.checked })}
              />
              Refundable
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-orange-500 focus:outline-none'

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={`mt-1 text-sm text-neutral-200 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

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
