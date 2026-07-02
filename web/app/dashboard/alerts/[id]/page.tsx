'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const STATUS_TRANSITIONS = ['new', 'in_review', 'deflected', 'lapsed', 'represented']

function money(cents?: number | null, currency = 'USD') {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
}

function recTone(rec?: string): 'green' | 'red' | 'amber' | 'slate' {
  if (!rec) return 'slate'
  const r = rec.toLowerCase()
  if (r.includes('deflect') || r.includes('refund')) return 'green'
  if (r.includes('represent') || r.includes('fight') || r.includes('dispute')) return 'amber'
  if (r.includes('reject') || r.includes('hold')) return 'red'
  return 'slate'
}

function statusTone(status?: string, dup?: boolean): 'green' | 'red' | 'purple' | 'blue' | 'slate' {
  if (dup) return 'purple'
  if (status === 'deflected') return 'green'
  if (status === 'lapsed') return 'red'
  if (status === 'in_review') return 'blue'
  return 'slate'
}

// Live countdown timer to the deflection deadline.
function DeadlineTimer({ deadline }: { deadline?: string | null }) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!deadline) return <span className="text-neutral-500">No deadline</span>
  const ms = new Date(deadline).getTime() - Date.now()
  if (Number.isNaN(ms)) return <span className="text-neutral-500">—</span>
  const overdue = ms <= 0
  const abs = Math.abs(ms)
  const d = Math.floor(abs / 864e5)
  const h = Math.floor((abs % 864e5) / 36e5)
  const m = Math.floor((abs % 36e5) / 6e4)
  const s = Math.floor((abs % 6e4) / 1000)
  const hours = ms / 36e5
  const tone = overdue ? 'red' : hours <= 24 ? 'red' : hours <= 72 ? 'amber' : 'green'
  return (
    <div className="flex flex-col gap-1">
      <div className={`font-mono text-2xl font-bold ${tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
        {overdue ? '+' : ''}
        {d > 0 ? `${d}d ` : ''}
        {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </div>
      <Badge tone={tone}>{overdue ? 'DEADLINE PASSED' : 'time remaining'}</Badge>
      <span className="text-xs text-neutral-500">{new Date(deadline).toLocaleString()}</span>
    </div>
  )
}

export default function AlertDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [alert, setAlert] = useState<any>(null)
  const [decision, setDecision] = useState<any>(null)
  const [order, setOrder] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [doubleRefund, setDoubleRefund] = useState<{ alreadyRefunded: boolean; refunds: any[] } | null>(null)

  const [busy, setBusy] = useState<string | null>(null)

  // modals
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideRec, setOverrideRec] = useState('deflect')
  const [overrideReason, setOverrideReason] = useState('')
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundMethod, setRefundMethod] = useState('original_payment')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getAlert(id)
      const a = res?.alert ?? res
      setAlert(a)
      setDecision(res?.decision ?? null)
      setOrder(res?.order ?? null)
      setAudit(res?.audit ?? res?.auditLog ?? [])
      // pull latest decision explicitly (fallback if not embedded)
      if (!res?.decision) {
        try {
          setDecision(await api.getDecisionForAlert(id))
        } catch {
          /* no decision yet */
        }
      }
      const orderId = res?.order?.id ?? a?.order_id
      if (orderId) {
        try {
          setDoubleRefund(await api.checkDoubleRefund(orderId))
        } catch {
          setDoubleRefund(null)
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load alert')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const onEvaluate = async () => {
    setBusy('evaluate')
    setNotice(null)
    setError(null)
    try {
      const d = await api.evaluateAlert({ alert_id: id })
      setDecision(d)
      setNotice('Decision engine evaluated this alert')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Evaluation failed')
    } finally {
      setBusy(null)
    }
  }

  const onOverride = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!decision?.id) return
    setBusy('override')
    try {
      const d = await api.overrideDecision(decision.id, {
        recommendation: overrideRec,
        override_reason: overrideReason.trim(),
      })
      setDecision(d)
      setOverrideOpen(false)
      setOverrideReason('')
      setNotice('Recommendation overridden')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Override failed')
    } finally {
      setBusy(null)
    }
  }

  const onStatus = async (status: string) => {
    setBusy('status-' + status)
    setError(null)
    try {
      const a = await api.updateAlertStatus(id, status)
      setAlert((prev: any) => ({ ...prev, ...a }))
      setNotice(`Status set to ${status}`)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Status update failed')
    } finally {
      setBusy(null)
    }
  }

  const onRefund = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('refund')
    setError(null)
    try {
      const res = await api.executeRefund({ alert_id: id, method: refundMethod, source: 'manual' })
      setRefundOpen(false)
      const saved = res?.savings?.net_savings_cents
      setNotice(
        `Refund executed${saved != null ? ` — net savings ${money(saved, alert?.currency)}` : ''}. Alert deflected.`,
      )
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Refund failed (it may already be refunded)')
    } finally {
      setBusy(null)
    }
  }

  const onDedupe = async () => {
    setBusy('dedupe')
    setError(null)
    try {
      const a = await api.dedupeAlert(id, { is_duplicate: !alert?.is_duplicate })
      setAlert((prev: any) => ({ ...prev, ...a }))
      setNotice(alert?.is_duplicate ? 'Unmarked as duplicate' : 'Marked as duplicate')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Dedupe failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading alert..." />

  if (error && !alert) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        <Link href="/dashboard/alerts">
          <Button variant="secondary">Back to queue</Button>
        </Link>
      </div>
    )
  }

  if (!alert) return null

  const currency = alert.currency ?? order?.currency ?? 'USD'
  const alreadyRefunded = doubleRefund?.alreadyRefunded
  const isDeflected = alert.status === 'deflected'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/alerts" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← Triage queue
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-neutral-100">
            {alert.external_alert_id ?? alert.id?.slice(0, 8)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="slate" className="uppercase">
              {alert.network}
            </Badge>
            <Badge tone="blue">{alert.alert_type}</Badge>
            <Badge tone={statusTone(alert.status, alert.is_duplicate)}>
              {alert.is_duplicate ? 'duplicate' : alert.status}
            </Badge>
            {alert.reason_code && <Badge tone="orange">{alert.reason_code}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Disputed amount</div>
          <div className="text-2xl font-semibold text-neutral-100">{money(alert.amount_cents, currency)}</div>
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
      {alreadyRefunded && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Double-refund guard: this order already has {doubleRefund?.refunds?.length ?? 0} refund(s) recorded. Avoid issuing another.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* left: decision + actions */}
        <div className="space-y-6 lg:col-span-2">
          {/* decision panel */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-100">Decision</h2>
                {decision?.is_override && <Badge tone="purple">overridden</Badge>}
              </div>
            </CardHeader>
            <CardBody>
              {decision ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Recommendation</div>
                      <Badge tone={recTone(decision.recommendation)} className="mt-1 text-sm">
                        {decision.recommendation}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Confidence score</div>
                      <div className="mt-1 text-xl font-semibold text-neutral-100">
                        {decision.score != null ? Number(decision.score).toFixed(2) : '—'}
                      </div>
                    </div>
                  </div>
                  {decision.score != null && (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-orange-500"
                        style={{ width: `${Math.min(Math.max(Number(decision.score) * (decision.score > 1 ? 1 : 100), 0), 100)}%` }}
                      />
                    </div>
                  )}
                  {decision.factors && (
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Scoring factors</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(Array.isArray(decision.factors) ? decision.factors : []).map((f: any, i: number) => (
                          <div key={f?.name ?? i} className="flex items-center justify-between text-sm">
                            <span className="text-neutral-400">{f?.name ?? `factor ${i + 1}`}</span>
                            <span className="font-mono text-neutral-200">
                              {typeof f?.contribution === 'number' ? f.contribution.toFixed(3) : String(f?.value ?? f)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {decision.override_reason && (
                    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200">
                      Override reason: {decision.override_reason}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={onEvaluate} disabled={busy === 'evaluate'}>
                      {busy === 'evaluate' ? 'Re-evaluating...' : 'Re-evaluate'}
                    </Button>
                    <Button variant="ghost" onClick={() => setOverrideOpen(true)}>
                      Override
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <p className="mb-4 text-sm text-neutral-400">
                    No decision yet. Run the deterministic engine to score this alert and get a recommended disposition.
                  </p>
                  <Button onClick={onEvaluate} disabled={busy === 'evaluate'}>
                    {busy === 'evaluate' ? 'Evaluating...' : 'Run decision engine'}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* refund / deflect action */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-100">Disposition</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => setRefundOpen(true)}
                  disabled={isDeflected || alreadyRefunded || busy != null}
                >
                  {isDeflected ? 'Already deflected' : 'Refund & deflect'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onDedupe}
                  disabled={busy === 'dedupe'}
                >
                  {alert.is_duplicate ? 'Unmark duplicate' : 'Mark duplicate'}
                </Button>
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Transition status</div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_TRANSITIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => onStatus(s)}
                      disabled={alert.status === s || busy === 'status-' + s}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        alert.status === s
                          ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50'
                      }`}
                    >
                      {busy === 'status-' + s ? '...' : s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* action log */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-100">Action log</h2>
            </CardHeader>
            <CardBody>
              {audit.length === 0 ? (
                <p className="text-sm text-neutral-500">No actions recorded for this alert yet.</p>
              ) : (
                <ol className="space-y-3">
                  {audit.map((ev: any, i: number) => (
                    <li key={ev.id ?? i} className="flex gap-3">
                      <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-orange-500" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-neutral-200">{ev.action}</span>
                          {ev.actor && <span className="text-xs text-neutral-500">by {ev.actor}</span>}
                        </div>
                        {ev.detail && (
                          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950/60 p-2 text-xs text-neutral-400">
                            {typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail, null, 2)}
                          </pre>
                        )}
                        <span className="text-xs text-neutral-600">
                          {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* right: deadline timer + linked order */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-100">Deflection deadline</h2>
            </CardHeader>
            <CardBody>
              <DeadlineTimer deadline={alert.deadline_at} />
              <div className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Received</span>
                  <span className="text-neutral-300">
                    {alert.received_at ? new Date(alert.received_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">ARN</span>
                  <span className="font-mono text-neutral-300">{alert.arn ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Card</span>
                  <span className="text-neutral-300">{alert.card_last4 ? `•••• ${alert.card_last4}` : '—'}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-100">Linked order</h2>
            </CardHeader>
            <CardBody>
              {order ? (
                <div className="space-y-2 text-sm">
                  <Link
                    href={`/dashboard/orders/${order.id}`}
                    className="font-medium text-orange-400 hover:text-orange-300"
                  >
                    {order.external_order_id ?? order.id?.slice(0, 8)}
                  </Link>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Product</span>
                    <span className="text-neutral-300">{order.product ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Amount</span>
                    <span className="text-neutral-300">{money(order.amount_cents, order.currency ?? currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Margin</span>
                    <span className="text-neutral-300">{money(order.margin_cents, order.currency ?? currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Recoverable</span>
                    <Badge tone={order.recoverable ? 'green' : 'slate'}>{order.recoverable ? 'yes' : 'no'}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Refundable</span>
                    <Badge tone={order.refundable ? 'green' : 'red'}>{order.refundable ? 'yes' : 'no'}</Badge>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No order matched to this alert (by ARN / last4).</p>
              )}
            </CardBody>
          </Card>

          {doubleRefund && doubleRefund.refunds?.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-neutral-100">Existing refunds</h2>
              </CardHeader>
              <CardBody>
                <Table>
                  <THead>
                    <TR>
                      <TH>Amount</TH>
                      <TH>Method</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {doubleRefund.refunds.map((r: any) => (
                      <TR key={r.id}>
                        <TD>{money(r.amount_cents, r.currency ?? currency)}</TD>
                        <TD>{r.method ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* override modal */}
      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override recommendation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onOverride} disabled={busy === 'override' || !overrideReason.trim()}>
              {busy === 'override' ? 'Saving...' : 'Apply override'}
            </Button>
          </>
        }
      >
        <form onSubmit={onOverride} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">New recommendation</label>
            <select
              value={overrideRec}
              onChange={(e) => setOverrideRec(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            >
              {['deflect', 'represent', 'reject', 'manual_review'].map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Reason (required)</label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              placeholder="Why are you overriding the engine?"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            />
          </div>
        </form>
      </Modal>

      {/* refund modal */}
      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title="Execute deflection refund"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onRefund} disabled={busy === 'refund'}>
              {busy === 'refund' ? 'Processing...' : `Refund ${money(alert.amount_cents, currency)}`}
            </Button>
          </>
        }
      >
        <form onSubmit={onRefund} className="space-y-3">
          <p className="text-sm text-neutral-400">
            Issuing a refund deflects this alert before it becomes a chargeback. This is idempotent per alert and is
            blocked if the order was already refunded.
          </p>
          {alreadyRefunded && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
              Warning: a refund already exists for this order.
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Refund method</label>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            >
              {['original_payment', 'store_credit', 'manual'].map((m) => (
                <option key={m} value={m}>
                  {m.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>
    </div>
  )
}
