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

type AutoRule = {
  id: string
  workspace_id: string
  name: string
  max_amount_cents: number
  reason_categories: string[] | null
  require_clean_customer: boolean
  max_per_day: number
  is_dry_run: boolean
  is_enabled: boolean
  execution_count: number
  created_at: string
}

type RunResult = { matched: number; executed: number; dryRun: boolean }

const REASON_CATEGORIES = [
  'fraud',
  'authorization',
  'processing_error',
  'consumer_dispute',
  'duplicate',
  'subscription',
]

function dollars(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function blankForm() {
  return {
    name: '',
    max_amount_dollars: '250',
    reason_categories: [] as string[],
    require_clean_customer: true,
    max_per_day: '25',
    is_dry_run: true,
    is_enabled: true,
  }
}

export default function AutomationPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [rules, setRules] = useState<AutoRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'dry_run' | 'live'>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AutoRule | null>(null)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const loadRules = useCallback(async (workspaceId: string) => {
    setError(null)
    try {
      const data = await api.listAutoRules(workspaceId)
      setRules(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load automation rules')
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
        await loadRules(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadRules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false
      if (statusFilter === 'enabled' && !r.is_enabled) return false
      if (statusFilter === 'disabled' && r.is_enabled) return false
      if (statusFilter === 'dry_run' && !r.is_dry_run) return false
      if (statusFilter === 'live' && r.is_dry_run) return false
      return true
    })
  }, [rules, search, statusFilter])

  const stats = useMemo(() => {
    const enabled = rules.filter((r) => r.is_enabled).length
    const live = rules.filter((r) => r.is_enabled && !r.is_dry_run).length
    const executions = rules.reduce((acc, r) => acc + (r.execution_count || 0), 0)
    return { total: rules.length, enabled, live, executions }
  }, [rules])

  function openCreate() {
    setEditing(null)
    setForm(blankForm())
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(rule: AutoRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      max_amount_dollars: String((rule.max_amount_cents || 0) / 100),
      reason_categories: Array.isArray(rule.reason_categories) ? rule.reason_categories : [],
      require_clean_customer: rule.require_clean_customer,
      max_per_day: String(rule.max_per_day),
      is_dry_run: rule.is_dry_run,
      is_enabled: rule.is_enabled,
    })
    setFormError(null)
    setModalOpen(true)
  }

  function toggleCategory(cat: string) {
    setForm((f) => ({
      ...f,
      reason_categories: f.reason_categories.includes(cat)
        ? f.reason_categories.filter((c) => c !== cat)
        : [...f.reason_categories, cat],
    }))
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!ws) return
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    const maxAmount = Math.round(parseFloat(form.max_amount_dollars || '0') * 100)
    const maxPerDay = parseInt(form.max_per_day || '0', 10)
    if (Number.isNaN(maxAmount) || maxAmount <= 0) {
      setFormError('Max amount must be greater than zero')
      return
    }
    if (Number.isNaN(maxPerDay) || maxPerDay <= 0) {
      setFormError('Max per day must be greater than zero')
      return
    }
    const body = {
      workspace_id: ws,
      name: form.name.trim(),
      max_amount_cents: maxAmount,
      reason_categories: form.reason_categories,
      require_clean_customer: form.require_clean_customer,
      max_per_day: maxPerDay,
      is_dry_run: form.is_dry_run,
      is_enabled: form.is_enabled,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateAutoRule(editing.id, body)
      } else {
        await api.createAutoRule(body)
      }
      setModalOpen(false)
      await loadRules(ws)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(rule: AutoRule) {
    if (!ws) return
    setActionError(null)
    try {
      await api.updateAutoRule(rule.id, { is_enabled: !rule.is_enabled })
      await loadRules(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update rule')
    }
  }

  async function toggleDryRun(rule: AutoRule) {
    if (!ws) return
    setActionError(null)
    try {
      await api.updateAutoRule(rule.id, { is_dry_run: !rule.is_dry_run })
      await loadRules(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update rule')
    }
  }

  async function runRule(rule: AutoRule) {
    if (!ws) return
    setActionError(null)
    setRunningId(rule.id)
    try {
      const res: RunResult = await api.runAutoRule(rule.id)
      setRunResults((prev) => ({ ...prev, [rule.id]: res }))
      await loadRules(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to run rule')
    } finally {
      setRunningId(null)
    }
  }

  async function removeRule(rule: AutoRule) {
    if (!ws) return
    if (!confirm(`Delete auto-deflection rule "${rule.name}"? This cannot be undone.`)) return
    setActionError(null)
    try {
      await api.deleteAutoRule(rule.id)
      await loadRules(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete rule')
    }
  }

  if (loading) return <PageSpinner label="Loading automation rules..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace yet"
          description="Create or join a workspace from the dashboard before configuring auto-deflection rules."
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
          <h1 className="text-2xl font-semibold text-slate-100">Automation</h1>
          <p className="mt-1 text-sm text-slate-400">
            Hands-off deflection rules. Dry-run records matches without spending; live rules execute refunds within guardrails.
          </p>
        </div>
        <Button onClick={openCreate}>+ New rule</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total rules" value={stats.total} />
        <Stat label="Enabled" value={stats.enabled} tone="green" />
        <Stat label="Live (auto-refund)" value={stats.live} tone="orange" sub={`${stats.enabled - stats.live} in dry-run`} />
        <Stat label="Lifetime executions" value={stats.executions.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-200">Rule library</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules..."
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="dry_run">Dry-run</option>
              <option value="live">Live</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rules.length === 0 ? 'No automation rules' : 'No rules match your filters'}
                description={
                  rules.length === 0
                    ? 'Create a rule to auto-deflect low-risk alerts within strict amount and volume guardrails.'
                    : 'Adjust the search or status filter to see more rules.'
                }
                action={
                  rules.length === 0 ? (
                    <Button onClick={openCreate}>Create your first rule</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Guardrails</TH>
                  <TH>Mode</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Executions</TH>
                  <TH>Last run</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((rule) => {
                  const result = runResults[rule.id]
                  return (
                    <TR key={rule.id}>
                      <TD>
                        <div className="font-medium text-slate-100">{rule.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(rule.reason_categories ?? []).length === 0 ? (
                            <span className="text-xs text-slate-500">Any reason category</span>
                          ) : (
                            (rule.reason_categories ?? []).map((c) => (
                              <Badge key={c} tone="slate">
                                {c}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TD>
                      <TD>
                        <div className="text-xs text-slate-400">
                          <div>Max {dollars(rule.max_amount_cents)}/alert</div>
                          <div>Cap {rule.max_per_day}/day</div>
                          <div>{rule.require_clean_customer ? 'Clean customers only' : 'Any customer'}</div>
                        </div>
                      </TD>
                      <TD>
                        {rule.is_dry_run ? (
                          <Badge tone="blue">Dry-run</Badge>
                        ) : (
                          <Badge tone="orange">Live</Badge>
                        )}
                      </TD>
                      <TD>
                        {rule.is_enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="slate">Disabled</Badge>}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-200">{rule.execution_count}</TD>
                      <TD>
                        {result ? (
                          <span className="text-xs text-slate-400">
                            {result.matched} matched / {result.executed} {result.dryRun ? 'would run' : 'executed'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">Not run this session</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-xs"
                            onClick={() => runRule(rule)}
                            disabled={runningId === rule.id}
                          >
                            {runningId === rule.id ? 'Running...' : rule.is_dry_run ? 'Dry-run' : 'Run'}
                          </Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => toggleEnabled(rule)}>
                            {rule.is_enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => toggleDryRun(rule)}>
                            {rule.is_dry_run ? 'Go live' : 'To dry-run'}
                          </Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => openEdit(rule)}>
                            Edit
                          </Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs text-red-300" onClick={() => removeRule(rule)}>
                            Delete
                          </Button>
                        </div>
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
        title={editing ? 'Edit automation rule' : 'New automation rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Rule name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Auto-deflect small consumer disputes"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Max amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.max_amount_dollars}
                onChange={(e) => setForm((f) => ({ ...f, max_amount_dollars: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Max per day</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.max_per_day}
                onChange={(e) => setForm((f) => ({ ...f, max_per_day: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Reason categories <span className="normal-case text-slate-600">(none = match any)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {REASON_CATEGORIES.map((cat) => {
                const active = form.reason_categories.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                        : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.require_clean_customer}
                onChange={(e) => setForm((f) => ({ ...f, require_clean_customer: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-orange-500"
              />
              Require clean customer (not watchlisted)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_dry_run}
                onChange={(e) => setForm((f) => ({ ...f, is_dry_run: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-orange-500"
              />
              Dry-run mode (record matches only, no refunds)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_enabled}
                onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-orange-500"
              />
              Enabled
            </label>
          </div>
        </form>
      </Modal>
    </div>
  )
}
