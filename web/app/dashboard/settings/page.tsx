'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'

type Workspace = {
  id: string
  name?: string
  invite_code?: string
  default_currency?: string
  created_at?: string
}

type Threshold = {
  id?: string
  workspace_id?: string
  program?: string
  network?: string
  standard_ratio?: number
  excessive_ratio?: number
  standard_count?: number
  fine_per_dispute_cents?: number
  sla_window_hours?: number
  created_at?: string
}

type Plan = {
  id?: string
  name?: string
  price_cents?: number
}

type Subscription = {
  id?: string
  plan_id?: string
  status?: string
  current_period_end?: string
  stripe_subscription_id?: string
}

type BillingInfo = {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']

// Ratios are stored as fractions (0.0075 = 0.75%). Convert for display / input.
function ratioToPct(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return ''
  return (v * 100).toFixed(3)
}
function pctToRatio(s: string): number {
  const n = parseFloat(s)
  if (Number.isNaN(n)) return 0
  return n / 100
}
function money(cents?: number | null, currency = 'USD'): string {
  const v = (cents ?? 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
  } catch {
    return `$${v.toFixed(2)}`
  }
}

const emptyThresholdForm = {
  program: '',
  network: '',
  standard_ratio: '',
  excessive_ratio: '',
  standard_count: '',
  fine_per_dispute_cents: '',
  sla_window_hours: '',
}

export default function SettingsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [thresholds, setThresholds] = useState<Threshold[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)

  // Workspace form
  const [wsName, setWsName] = useState('')
  const [wsCurrency, setWsCurrency] = useState('USD')
  const [savingWs, setSavingWs] = useState(false)

  // Threshold edit/create modal
  const [thrModalOpen, setThrModalOpen] = useState(false)
  const [editingThr, setEditingThr] = useState<Threshold | null>(null)
  const [thrForm, setThrForm] = useState({ ...emptyThresholdForm })
  const [savingThr, setSavingThr] = useState(false)
  const [thrError, setThrError] = useState<string | null>(null)

  // Billing / sample data busy flags
  const [billingBusy, setBillingBusy] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    setWs(getActiveWorkspace())
  }, [])

  const load = useCallback(async (workspaceId: string) => {
    setError(null)
    try {
      const [w, thr, bill] = await Promise.all([
        api.getWorkspace(workspaceId).catch(() => null),
        api.listThresholds(workspaceId).catch(() => []),
        api.getBillingPlan().catch(() => null),
      ])
      const wsObj: Workspace | null = w ?? null
      setWorkspace(wsObj)
      setWsName(wsObj?.name ?? '')
      setWsCurrency(wsObj?.default_currency ?? 'USD')
      setThresholds(Array.isArray(thr) ? thr : [])
      setBilling(bill ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
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

  const flash = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(null), 4000)
  }

  // ---- Workspace save ----
  const saveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws) return
    setSavingWs(true)
    setError(null)
    try {
      const updated = await api.updateWorkspace(ws, {
        name: wsName.trim(),
        default_currency: wsCurrency,
      })
      if (updated) {
        setWorkspace(updated)
        setWsName(updated.name ?? wsName)
        setWsCurrency(updated.default_currency ?? wsCurrency)
      }
      flash('Workspace settings saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace')
    } finally {
      setSavingWs(false)
    }
  }

  // ---- Threshold modal ----
  const openCreateThreshold = () => {
    setEditingThr(null)
    setThrForm({ ...emptyThresholdForm })
    setThrError(null)
    setThrModalOpen(true)
  }
  const openEditThreshold = (t: Threshold) => {
    setEditingThr(t)
    setThrForm({
      program: t.program ?? '',
      network: t.network ?? '',
      standard_ratio: ratioToPct(t.standard_ratio),
      excessive_ratio: ratioToPct(t.excessive_ratio),
      standard_count: t.standard_count != null ? String(t.standard_count) : '',
      fine_per_dispute_cents: t.fine_per_dispute_cents != null ? (t.fine_per_dispute_cents / 100).toFixed(2) : '',
      sla_window_hours: t.sla_window_hours != null ? String(t.sla_window_hours) : '',
    })
    setThrError(null)
    setThrModalOpen(true)
  }

  const saveThreshold = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ws) return
    if (!thrForm.program.trim() || !thrForm.network.trim()) {
      setThrError('Program and network are required')
      return
    }
    setSavingThr(true)
    setThrError(null)
    const payload = {
      workspace_id: ws,
      program: thrForm.program.trim(),
      network: thrForm.network.trim(),
      standard_ratio: pctToRatio(thrForm.standard_ratio),
      excessive_ratio: pctToRatio(thrForm.excessive_ratio),
      standard_count: thrForm.standard_count ? parseInt(thrForm.standard_count, 10) : 0,
      fine_per_dispute_cents: thrForm.fine_per_dispute_cents
        ? Math.round(parseFloat(thrForm.fine_per_dispute_cents) * 100)
        : 0,
      sla_window_hours: thrForm.sla_window_hours ? parseInt(thrForm.sla_window_hours, 10) : 0,
    }
    try {
      if (editingThr?.id) {
        await api.updateThreshold(editingThr.id, payload)
      } else {
        await api.createThreshold(payload)
      }
      setThrModalOpen(false)
      await load(ws)
      flash(editingThr ? 'Threshold updated' : 'Threshold created')
    } catch (err) {
      setThrError(err instanceof Error ? err.message : 'Failed to save threshold')
    } finally {
      setSavingThr(false)
    }
  }

  // ---- Billing ----
  const handleCheckout = async () => {
    setBillingBusy('checkout')
    setError(null)
    try {
      const res = await api.startCheckout()
      if (res?.url) {
        window.location.href = res.url
      } else {
        flash('Checkout is not available right now.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing is not configured (checkout unavailable).')
    } finally {
      setBillingBusy(null)
    }
  }
  const handlePortal = async () => {
    setBillingBusy('portal')
    setError(null)
    try {
      const res = await api.openPortal()
      if (res?.url) {
        window.location.href = res.url
      } else {
        flash('Billing portal is not available right now.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing is not configured (portal unavailable).')
    } finally {
      setBillingBusy(null)
    }
  }

  // ---- Sample data ----
  const handleSeed = async () => {
    if (!ws) return
    setSeeding(true)
    setError(null)
    try {
      await api.seedSample({ workspace_id: ws })
      await load(ws)
      flash('Sample data seeded for this workspace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }
  const handleReset = async () => {
    if (!ws) return
    setResetting(true)
    setError(null)
    try {
      await api.resetSample({ workspace_id: ws })
      setResetOpen(false)
      await load(ws)
      flash('Workspace sample data cleared')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset sample data')
    } finally {
      setResetting(false)
    }
  }

  const planLabel = useMemo(() => {
    const p = billing?.plan
    if (!p) return 'Free'
    return p.name ?? (p.id ? p.id.charAt(0).toUpperCase() + p.id.slice(1) : 'Free')
  }, [billing])

  const subStatus = billing?.subscription?.status
  const stripeEnabled = Boolean(billing?.stripeEnabled)

  if (ws === null) return <PageSpinner label="Loading workspace..." />

  if (!ws) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Pick or create a workspace on the dashboard to manage its settings."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Settings</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Workspace configuration, chargeback-program thresholds, billing plan, and sample-data tools.
          </p>
        </div>
        {workspace?.invite_code && (
          <Badge tone="orange">Invite code: {workspace.invite_code}</Badge>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Workspace settings */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Workspace</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={saveWorkspace} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Workspace name
              </label>
              <input
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
                placeholder="My deflection desk"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Default currency
              </label>
              <select
                value={wsCurrency}
                onChange={(e) => setWsCurrency(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={savingWs}>
                {savingWs ? 'Saving...' : 'Save workspace'}
              </Button>
              {workspace?.created_at && (
                <span className="text-xs text-neutral-500">
                  Created {new Date(workspace.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">Program thresholds</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                VDMP / ECP standard and excessive ratio bands, fine exposure, and SLA windows per network.
              </p>
            </div>
            <Button variant="secondary" onClick={openCreateThreshold}>
              Add threshold
            </Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {thresholds.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No thresholds configured"
                description="Add a chargeback-program threshold to drive ratio guardrails and SLA windows."
                action={<Button onClick={openCreateThreshold}>Add threshold</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Program</TH>
                  <TH>Network</TH>
                  <TH>Standard</TH>
                  <TH>Excessive</TH>
                  <TH>Min count</TH>
                  <TH>Fine / dispute</TH>
                  <TH>SLA</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {thresholds.map((t, i) => (
                  <TR key={t.id ?? i}>
                    <TD className="font-medium text-neutral-100">{t.program ?? '—'}</TD>
                    <TD>{t.network ?? '—'}</TD>
                    <TD>{t.standard_ratio != null ? `${(t.standard_ratio * 100).toFixed(3)}%` : '—'}</TD>
                    <TD>
                      {t.excessive_ratio != null ? (
                        <Badge tone="red">{(t.excessive_ratio * 100).toFixed(3)}%</Badge>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>{(t.standard_count ?? 0).toLocaleString()}</TD>
                    <TD>{money(t.fine_per_dispute_cents, wsCurrency)}</TD>
                    <TD>{t.sla_window_hours != null ? `${t.sla_window_hours}h` : '—'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => openEditThreshold(t)}>
                        Edit
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Billing / plan */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Billing &amp; plan</h2>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Current plan"
              value={planLabel}
              sub={
                <Badge tone={planLabel.toLowerCase() === 'pro' ? 'orange' : 'green'}>
                  {planLabel.toLowerCase() === 'pro' ? 'Pro' : 'Free'}
                </Badge>
              }
            />
            <Stat
              label="Subscription status"
              value={subStatus ? subStatus.charAt(0).toUpperCase() + subStatus.slice(1) : 'None'}
              sub={
                billing?.subscription?.current_period_end
                  ? `Renews ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`
                  : 'No active subscription'
              }
            />
            <Stat
              label="Plan price"
              value={billing?.plan?.price_cents ? money(billing.plan.price_cents, 'USD') : '$0'}
              sub={billing?.plan?.price_cents ? 'per period' : 'forever'}
            />
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-neutral-200">
                  {stripeEnabled ? 'Manage your subscription' : 'Billing not configured'}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {stripeEnabled
                    ? 'Upgrade to Pro or manage payment details through the secure Stripe portal.'
                    : 'Stripe is not configured for this deployment. Every feature is currently free. Checkout returns 503 until billing is enabled.'}
                </p>
              </div>
              <div className="flex gap-2">
                {billing?.subscription?.stripe_subscription_id || subStatus === 'active' ? (
                  <Button
                    variant="secondary"
                    onClick={handlePortal}
                    disabled={!stripeEnabled || billingBusy !== null}
                  >
                    {billingBusy === 'portal' ? 'Opening...' : 'Open billing portal'}
                  </Button>
                ) : (
                  <Button onClick={handleCheckout} disabled={!stripeEnabled || billingBusy !== null}>
                    {billingBusy === 'checkout'
                      ? 'Starting...'
                      : stripeEnabled
                        ? 'Upgrade to Pro'
                        : 'Coming soon'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={handlePortal}
                  disabled={!stripeEnabled || billingBusy !== null}
                >
                  Manage
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Sample data tools */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Sample data</h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-neutral-400">
            Seed this workspace with realistic sample orders, alerts across all three networks (Ethoca, Verifi CDRN,
            Visa RDR), customers, reason codes, a default rule set, thresholds, and feed connections. Reset clears all
            sample data from the workspace.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed sample data'}
            </Button>
            <Button variant="danger" onClick={() => setResetOpen(true)} disabled={resetting}>
              Reset sample data
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Threshold modal */}
      <Modal
        open={thrModalOpen}
        onClose={() => setThrModalOpen(false)}
        title={editingThr ? 'Edit threshold' : 'Add threshold'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setThrModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveThreshold} disabled={savingThr}>
              {savingThr ? 'Saving...' : editingThr ? 'Save changes' : 'Create threshold'}
            </Button>
          </>
        }
      >
        <form onSubmit={saveThreshold} className="space-y-4">
          {thrError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {thrError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Program</label>
              <input
                value={thrForm.program}
                onChange={(e) => setThrForm({ ...thrForm, program: e.target.value })}
                placeholder="VDMP"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Network</label>
              <input
                value={thrForm.network}
                onChange={(e) => setThrForm({ ...thrForm, network: e.target.value })}
                placeholder="visa"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Standard ratio (%)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={thrForm.standard_ratio}
                onChange={(e) => setThrForm({ ...thrForm, standard_ratio: e.target.value })}
                placeholder="0.900"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Excessive ratio (%)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={thrForm.excessive_ratio}
                onChange={(e) => setThrForm({ ...thrForm, excessive_ratio: e.target.value })}
                placeholder="1.800"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Min dispute count
              </label>
              <input
                type="number"
                min="0"
                value={thrForm.standard_count}
                onChange={(e) => setThrForm({ ...thrForm, standard_count: e.target.value })}
                placeholder="100"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Fine / dispute ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={thrForm.fine_per_dispute_cents}
                onChange={(e) => setThrForm({ ...thrForm, fine_per_dispute_cents: e.target.value })}
                placeholder="50.00"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                SLA window (hours)
              </label>
              <input
                type="number"
                min="0"
                value={thrForm.sla_window_hours}
                onChange={(e) => setThrForm({ ...thrForm, sla_window_hours: e.target.value })}
                placeholder="72"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Reset confirmation modal */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset sample data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReset} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset workspace data'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          This clears all sample orders, alerts, customers, decisions, refunds, and related records from this
          workspace. This action cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
