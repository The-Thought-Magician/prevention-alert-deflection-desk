'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Order = {
  id: string
  external_order_id?: string
  arn?: string
  card_last4?: string
  amount_cents?: number
  currency?: string
  product?: string
}

const NETWORKS = ['ethoca', 'verifi_cdrn', 'visa_rdr']
const ALERT_TYPES = ['confirmed_fraud', 'dispute', 'pre_dispute', 'inquiry']
const REASON_CATEGORIES = ['fraud', 'authorization', 'processing_error', 'consumer_dispute', 'unknown']

const BULK_COLUMNS = [
  'network',
  'alert_type',
  'external_alert_id',
  'arn',
  'card_last4',
  'amount_cents',
  'currency',
  'reason_code',
  'reason_category',
  'received_at',
]

function money(cents?: number, currency = 'USD') {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

// Minimal CSV parser handling quoted fields and commas inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export default function NewAlertPage() {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [mode, setMode] = useState<'manual' | 'bulk'>('manual')

  // Manual form state
  const [form, setForm] = useState({
    network: 'ethoca',
    alert_type: 'confirmed_fraud',
    external_alert_id: '',
    order_id: '',
    arn: '',
    card_last4: '',
    amount_cents: '',
    currency: 'USD',
    reason_code: '',
    reason_category: 'fraud',
    received_at: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  // Bulk state
  const [rawCsv, setRawCsv] = useState('')
  const [parsed, setParsed] = useState<Record<string, string>[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)

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
        if (!ws) {
          setLoading(false)
          return
        }
        setWorkspaceId(ws)
        const o = await api.listOrders(ws)
        if (!alive) return
        setOrders(Array.isArray(o) ? o : [])
      } catch (e: any) {
        if (alive) setLoadError(e?.message ?? 'Failed to load workspace')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === form.order_id),
    [orders, form.order_id]
  )

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // When picking an order, prefill arn / last4 / amount.
  function pickOrder(id: string) {
    const o = orders.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      order_id: id,
      arn: o?.arn ?? f.arn,
      card_last4: o?.card_last4 ?? f.card_last4,
      amount_cents: o?.amount_cents != null ? String(o.amount_cents) : f.amount_cents,
      currency: o?.currency ?? f.currency,
    }))
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setFormError(null)
    setFormSuccess(null)
    if (!form.external_alert_id.trim()) {
      setFormError('External alert ID is required.')
      return
    }
    const amount = form.amount_cents.trim() === '' ? undefined : Number(form.amount_cents)
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setFormError('Amount (cents) must be a non-negative number.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        workspace_id: workspaceId,
        network: form.network,
        alert_type: form.alert_type,
        external_alert_id: form.external_alert_id.trim(),
        currency: form.currency || 'USD',
        reason_category: form.reason_category,
      }
      if (form.order_id) body.order_id = form.order_id
      if (form.arn.trim()) body.arn = form.arn.trim()
      if (form.card_last4.trim()) body.card_last4 = form.card_last4.trim()
      if (amount != null) body.amount_cents = amount
      if (form.reason_code.trim()) body.reason_code = form.reason_code.trim()
      if (form.received_at) body.received_at = new Date(form.received_at).toISOString()
      const created = await api.createAlert(body)
      setFormSuccess(`Alert created (${created?.external_alert_id ?? created?.id ?? 'ok'}).`)
      setForm((f) => ({
        ...f,
        external_alert_id: '',
        order_id: '',
        arn: '',
        card_last4: '',
        amount_cents: '',
        reason_code: '',
        received_at: '',
      }))
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed to create alert')
    } finally {
      setSubmitting(false)
    }
  }

  function handleParse(text: string) {
    setRawCsv(text)
    setBulkResult(null)
    setBulkError(null)
    setParseError(null)
    if (!text.trim()) { setParsed([]); return }
    try {
      const rows = parseCsv(text)
      if (rows.length < 1) { setParsed([]); return }
      const header = rows[0].map((h) => h.trim().toLowerCase())
      const records = rows.slice(1).map((cols) => {
        const rec: Record<string, string> = {}
        header.forEach((h, i) => { rec[h] = (cols[i] ?? '').trim() })
        return rec
      })
      const missing = ['network', 'external_alert_id'].filter((c) => !header.includes(c))
      if (missing.length) {
        setParseError(`CSV is missing required column(s): ${missing.join(', ')}`)
      }
      setParsed(records)
    } catch (e: any) {
      setParseError(e?.message ?? 'Could not parse CSV')
      setParsed([])
    }
  }

  async function onFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    handleParse(text)
  }

  async function submitBulk() {
    if (!workspaceId || parsed.length === 0) return
    setBulkSubmitting(true)
    setBulkError(null)
    setBulkResult(null)
    try {
      const rows = parsed.map((r) => {
        const row: Record<string, unknown> = { ...r }
        if (r.amount_cents) row.amount_cents = Number(r.amount_cents)
        return row
      })
      const res = await api.bulkAlerts({ workspace_id: workspaceId, rows })
      setBulkResult(`${res?.created ?? rows.length} alert(s) uploaded.`)
      setParsed([])
      setRawCsv('')
    } catch (e: any) {
      setBulkError(e?.message ?? 'Bulk upload failed')
    } finally {
      setBulkSubmitting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading orders..." />

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load this page"
          description={loadError}
          action={<Button variant="secondary" onClick={() => location.reload()}>Retry</Button>}
        />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace selected"
          description="Create or pick a workspace from the dashboard before adding alerts."
          action={<Link href="/dashboard"><Button>Go to dashboard</Button></Link>}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">New Alert</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter a deflection alert manually, or upload a CSV exported from Ethoca / Verifi / Visa RDR.
          </p>
        </div>
        <Link href="/dashboard/alerts" className="text-sm text-orange-400 hover:text-orange-300">
          View alert queue →
        </Link>
      </div>

      <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        <button
          onClick={() => setMode('manual')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === 'manual' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Manual entry
        </button>
        <button
          onClick={() => setMode('bulk')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === 'bulk' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Bulk CSV upload
        </button>
      </div>

      {mode === 'manual' ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Manual alert entry</h2>
          </CardHeader>
          <CardBody>
            <form onSubmit={submitManual} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Network" required>
                  <select
                    value={form.network}
                    onChange={(e) => update('network', e.target.value)}
                    className={inputCls}
                  >
                    {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
                <Field label="Alert type" required>
                  <select
                    value={form.alert_type}
                    onChange={(e) => update('alert_type', e.target.value)}
                    className={inputCls}
                  >
                    {ALERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="External alert ID" required>
                  <input
                    value={form.external_alert_id}
                    onChange={(e) => update('external_alert_id', e.target.value)}
                    placeholder="ETH-2024-00012"
                    className={inputCls}
                  />
                </Field>
                <Field label="Link order (auto-match by ARN/last4 if blank)">
                  <select
                    value={form.order_id}
                    onChange={(e) => pickOrder(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— No explicit order —</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.external_order_id ?? o.id} · {money(o.amount_cents, o.currency)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ARN (acquirer reference number)">
                  <input
                    value={form.arn}
                    onChange={(e) => update('arn', e.target.value)}
                    placeholder="74xxxxxxxxxxxxxxxxxxxxxx"
                    className={inputCls}
                  />
                </Field>
                <Field label="Card last 4">
                  <input
                    value={form.card_last4}
                    onChange={(e) => update('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4242"
                    className={inputCls}
                  />
                </Field>
                <Field label="Amount (cents)">
                  <input
                    value={form.amount_cents}
                    onChange={(e) => update('amount_cents', e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="4999"
                    inputMode="numeric"
                    className={inputCls}
                  />
                </Field>
                <Field label="Currency">
                  <input
                    value={form.currency}
                    onChange={(e) => update('currency', e.target.value.toUpperCase().slice(0, 3))}
                    placeholder="USD"
                    className={inputCls}
                  />
                </Field>
                <Field label="Reason code">
                  <input
                    value={form.reason_code}
                    onChange={(e) => update('reason_code', e.target.value)}
                    placeholder="10.4"
                    className={inputCls}
                  />
                </Field>
                <Field label="Reason category">
                  <select
                    value={form.reason_category}
                    onChange={(e) => update('reason_category', e.target.value)}
                    className={inputCls}
                  >
                    {REASON_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Received at (defaults to now)">
                  <input
                    type="datetime-local"
                    value={form.received_at}
                    onChange={(e) => update('received_at', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>

              {selectedOrder && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                  Linked to order <span className="text-slate-200">{selectedOrder.external_order_id ?? selectedOrder.id}</span>
                  {selectedOrder.product ? <> · {selectedOrder.product}</> : null}
                  {' · '}{money(selectedOrder.amount_cents, selectedOrder.currency)}
                </div>
              )}

              {formError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                  {formSuccess}{' '}
                  <Link href="/dashboard/alerts" className="underline hover:text-emerald-200">View in queue</Link>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create alert'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push('/dashboard/alerts')}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Bulk CSV upload</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
                <div className="mb-1 font-medium text-slate-300">Expected columns (header row, comma separated):</div>
                <code className="break-words text-orange-300">{BULK_COLUMNS.join(', ')}</code>
                <div className="mt-2 text-slate-500">
                  Only <span className="text-slate-300">network</span> and{' '}
                  <span className="text-slate-300">external_alert_id</span> are required. Orders are
                  auto-matched server-side by ARN / card last4.
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700">
                  Choose CSV file
                  <input type="file" accept=".csv,text/csv" onChange={onFileUpload} className="hidden" />
                </label>
                <span className="text-xs text-slate-500">or paste rows below</span>
              </div>

              <textarea
                value={rawCsv}
                onChange={(e) => handleParse(e.target.value)}
                rows={6}
                placeholder={`${BULK_COLUMNS.join(',')}\nethoca,confirmed_fraud,ETH-1001,74000...,4242,4999,USD,10.4,fraud,2026-06-30T10:00:00Z`}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />

              {parseError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
                  {parseError}
                </div>
              )}
              {bulkError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                  {bulkError}
                </div>
              )}
              {bulkResult && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                  {bulkResult}{' '}
                  <Link href="/dashboard/alerts" className="underline hover:text-emerald-200">View queue</Link>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button onClick={submitBulk} disabled={bulkSubmitting || parsed.length === 0}>
                  {bulkSubmitting ? 'Uploading…' : `Upload ${parsed.length || ''} alert${parsed.length === 1 ? '' : 's'}`}
                </Button>
                {parsed.length > 0 && (
                  <Badge tone="orange">{parsed.length} rows parsed</Badge>
                )}
              </div>
            </CardBody>
          </Card>

          {parsed.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-200">Preview ({parsed.length} rows)</h2>
              </CardHeader>
              <CardBody className="p-0">
                <Table>
                  <THead>
                    <TR>
                      {BULK_COLUMNS.map((c) => <TH key={c}>{c}</TH>)}
                    </TR>
                  </THead>
                  <TBody>
                    {parsed.slice(0, 50).map((r, i) => (
                      <TR key={i}>
                        {BULK_COLUMNS.map((c) => (
                          <TD key={c} className="whitespace-nowrap">{r[c] ?? ''}</TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {parsed.length > 50 && (
                  <div className="px-4 py-3 text-xs text-slate-500">
                    Showing first 50 of {parsed.length} rows. All rows will be uploaded.
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}{required && <span className="text-orange-400"> *</span>}
      </span>
      {children}
    </label>
  )
}
