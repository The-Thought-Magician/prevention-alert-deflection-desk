'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

const WS_KEY = 'padd:workspace'

type Refund = {
  id?: string
  alert_id?: string
  order_id?: string
  amount_cents?: number
  currency?: string
  method?: string
  source?: string
  executed_by?: string
  created_at?: string
}

type RefundLink = {
  id?: string
  refund_id?: string
  order_id?: string
  alert_id?: string
  created_at?: string
}

type DoubleCheck = {
  alreadyRefunded?: boolean
  refunds?: Refund[]
}

function money(cents?: number, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
}

function short(id?: string) {
  if (!id) return '—'
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

export default function RefundsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [refunds, setRefunds] = useState<Refund[]>([])
  const [links, setLinks] = useState<RefundLink[]>([])

  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')

  // Double-refund checker
  const [checkOrderId, setCheckOrderId] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<DoubleCheck | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    setWs(typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null)
  }, [])

  const load = useCallback(async (workspace: string) => {
    setError(null)
    try {
      const [r, l] = await Promise.all([
        api.listRefunds(workspace),
        api.listRefundLinks(workspace),
      ])
      setRefunds(Array.isArray(r) ? r : [])
      setLinks(Array.isArray(l) ? l : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load refund ledger')
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

  const methods = useMemo(
    () => Array.from(new Set(refunds.map((r) => r.method).filter(Boolean) as string[])).sort(),
    [refunds],
  )
  const sources = useMemo(
    () => Array.from(new Set(refunds.map((r) => r.source).filter(Boolean) as string[])).sort(),
    [refunds],
  )

  // Map order_id -> refund records, to flag orders refunded more than once.
  const byOrder = useMemo(() => {
    const m = new Map<string, Refund[]>()
    for (const r of refunds) {
      if (!r.order_id) continue
      const arr = m.get(r.order_id) ?? []
      arr.push(r)
      m.set(r.order_id, arr)
    }
    return m
  }, [refunds])

  const duplicateOrderIds = useMemo(
    () => new Set(Array.from(byOrder.entries()).filter(([, arr]) => arr.length > 1).map(([k]) => k)),
    [byOrder],
  )

  // Map refund_id -> ledger links for reconciliation status.
  const linksByRefund = useMemo(() => {
    const m = new Map<string, RefundLink[]>()
    for (const l of links) {
      if (!l.refund_id) continue
      const arr = m.get(l.refund_id) ?? []
      arr.push(l)
      m.set(l.refund_id, arr)
    }
    return m
  }, [links])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return refunds.filter((r) => {
      if (methodFilter !== 'all' && r.method !== methodFilter) return false
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false
      if (!q) return true
      return (
        (r.id ?? '').toLowerCase().includes(q) ||
        (r.order_id ?? '').toLowerCase().includes(q) ||
        (r.alert_id ?? '').toLowerCase().includes(q)
      )
    })
  }, [refunds, search, methodFilter, sourceFilter])

  const totalCents = useMemo(() => refunds.reduce((s, r) => s + (r.amount_cents ?? 0), 0), [refunds])
  const reconciledCount = useMemo(
    () => refunds.filter((r) => r.id && (linksByRefund.get(r.id)?.length ?? 0) > 0).length,
    [refunds, linksByRefund],
  )
  const unlinkedCount = refunds.length - reconciledCount

  const runCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    const oid = checkOrderId.trim()
    if (!oid) return
    setChecking(true)
    setCheckError(null)
    setCheckResult(null)
    try {
      const res = await api.checkDoubleRefund(oid)
      setCheckResult(res ?? { alreadyRefunded: false, refunds: [] })
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  if (ws === null) return <PageSpinner label="Loading workspace..." />

  if (!ws) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick or create a workspace on the dashboard to view the refund ledger."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  if (loading) return <PageSpinner label="Loading refund ledger..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Refund Ledger</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every deflection refund, reconciled against ledger links, with double-refund prevention.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Refunds issued" value={refunds.length.toLocaleString()} />
        <Stat label="Total refunded" value={money(totalCents)} tone="orange" />
        <Stat
          label="Reconciled"
          value={`${reconciledCount}/${refunds.length}`}
          sub="Linked to order ledger"
          tone="green"
        />
        <Stat
          label="Duplicate-order flags"
          value={duplicateOrderIds.size.toLocaleString()}
          sub="Orders with >1 refund"
          tone={duplicateOrderIds.size > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Double-refund checker */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Double-refund check</h2>
          <p className="mt-1 text-xs text-slate-500">
            Verify whether an order has already been refunded before issuing another deflection.
          </p>
        </CardHeader>
        <CardBody>
          <form onSubmit={runCheck} className="flex flex-wrap items-center gap-2">
            <input
              value={checkOrderId}
              onChange={(e) => setCheckOrderId(e.target.value)}
              placeholder="Order ID"
              className="min-w-[260px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <Button type="submit" disabled={checking || !checkOrderId.trim()}>
              {checking ? 'Checking...' : 'Check'}
            </Button>
          </form>

          {checkError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {checkError}
            </div>
          )}

          {checkResult && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                {checkResult.alreadyRefunded ? (
                  <Badge tone="red">Already refunded — do not double-refund</Badge>
                ) : (
                  <Badge tone="green">Clear — no prior refund found</Badge>
                )}
                <span className="text-xs text-slate-500">Order {short(checkOrderId)}</span>
              </div>
              {(checkResult.refunds?.length ?? 0) > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Refund</TH>
                      <TH>Amount</TH>
                      <TH>Method</TH>
                      <TH>Source</TH>
                      <TH>When</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {checkResult.refunds!.map((r, i) => (
                      <TR key={r.id ?? i}>
                        <TD className="font-mono text-xs">{short(r.id)}</TD>
                        <TD>{money(r.amount_cents, r.currency)}</TD>
                        <TD>{r.method ?? '—'}</TD>
                        <TD>{r.source ?? '—'}</TD>
                        <TD>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Ledger filters */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              Ledger <span className="text-slate-500">({filtered.length})</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by id / order / alert"
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All methods</option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All sources</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {refunds.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No refunds yet"
                description="Deflection refunds executed from alerts will appear in this ledger."
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No matching refunds" description="Adjust your search or filters." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Refund</TH>
                  <TH>Order</TH>
                  <TH>Alert</TH>
                  <TH>Amount</TH>
                  <TH>Method</TH>
                  <TH>Source</TH>
                  <TH>Reconciliation</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r, i) => {
                  const reconciled = r.id ? (linksByRefund.get(r.id)?.length ?? 0) > 0 : false
                  const dupOrder = r.order_id ? duplicateOrderIds.has(r.order_id) : false
                  return (
                    <TR key={r.id ?? i}>
                      <TD className="font-mono text-xs">{short(r.id)}</TD>
                      <TD className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {short(r.order_id)}
                          {dupOrder && <Badge tone="red">dup</Badge>}
                        </span>
                      </TD>
                      <TD className="font-mono text-xs">{short(r.alert_id)}</TD>
                      <TD className="font-medium text-slate-100">{money(r.amount_cents, r.currency)}</TD>
                      <TD>{r.method ?? '—'}</TD>
                      <TD>
                        <Badge tone={r.source === 'auto' || r.source === 'automation' ? 'purple' : 'blue'}>
                          {r.source ?? 'manual'}
                        </Badge>
                      </TD>
                      <TD>
                        {reconciled ? (
                          <Badge tone="green">Linked</Badge>
                        ) : (
                          <Badge tone="amber">Unlinked</Badge>
                        )}
                      </TD>
                      <TD>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Reconciliation: ledger links */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              Ledger links <span className="text-slate-500">({links.length})</span>
            </h2>
            {unlinkedCount > 0 && (
              <Badge tone="amber">{unlinkedCount} refund(s) not yet linked</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Refund ↔ order ↔ alert links enforce one-refund-per-order and back the double-refund guard.
          </p>
        </CardHeader>
        <CardBody className="p-0">
          {links.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No ledger links" description="Reconciliation links are created when refunds are executed." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Link</TH>
                  <TH>Refund</TH>
                  <TH>Order</TH>
                  <TH>Alert</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {links.map((l, i) => (
                  <TR key={l.id ?? i}>
                    <TD className="font-mono text-xs">{short(l.id)}</TD>
                    <TD className="font-mono text-xs">{short(l.refund_id)}</TD>
                    <TD className="font-mono text-xs">{short(l.order_id)}</TD>
                    <TD className="font-mono text-xs">{short(l.alert_id)}</TD>
                    <TD>{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</TD>
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
