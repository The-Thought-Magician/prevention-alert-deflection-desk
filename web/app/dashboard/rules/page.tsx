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

interface RuleSet {
  id: string
  workspace_id: string
  name: string
  version: number | null
  is_active: boolean
  weights: Record<string, number> | null
  thresholds: Record<string, number> | null
  auto_deflect_eligible: string[] | Record<string, unknown> | null
  created_at: string
}

interface SimResult {
  results?: {
    total?: number
    by_disposition?: Record<string, number>
    projected_deflection_rate?: number
    dispositions?: Array<{
      alert_id: string
      recommendation: string
      score: number
      reason_code?: string
    }>
  }
}

const WS_KEY = 'pd_workspace_id'

const DEFAULT_WEIGHTS: Record<string, number> = {
  amount: 30,
  reason_category: 25,
  customer_risk: 20,
  deadline_pressure: 15,
  recoverability: 10,
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  auto_deflect: 75,
  manual_review: 45,
}

const dispoTones: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  deflect: 'green',
  auto_deflect: 'green',
  review: 'amber',
  manual_review: 'amber',
  represent: 'red',
  reject: 'red',
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

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  const v = n <= 1 ? n * 100 : n
  return `${v.toFixed(1)}%`
}

export default function RulesPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<RuleSet | null>(null)
  const [selectLoading, setSelectLoading] = useState(false)

  // editor state
  const [name, setName] = useState('')
  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const [thresholds, setThresholds] = useState<Record<string, number>>(DEFAULT_THRESHOLDS)
  const [autoEligible, setAutoEligible] = useState('')
  const [editorErr, setEditorErr] = useState<string | null>(null)
  const [savingEditor, setSavingEditor] = useState(false)
  const [isNew, setIsNew] = useState(false)

  const [sim, setSim] = useState<SimResult['results'] | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simErr, setSimErr] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState<RuleSet | null>(null)

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listRuleSets(ws)
      setRuleSets(Array.isArray(res) ? res : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rule sets')
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

  const activeCount = useMemo(() => ruleSets.filter((r) => r.is_active).length, [ruleSets])

  function fillEditor(rs: RuleSet | null) {
    if (rs) {
      setName(rs.name)
      setWeights({ ...DEFAULT_WEIGHTS, ...(rs.weights ?? {}) })
      setThresholds({ ...DEFAULT_THRESHOLDS, ...(rs.thresholds ?? {}) })
      setAutoEligible(
        Array.isArray(rs.auto_deflect_eligible)
          ? rs.auto_deflect_eligible.join(', ')
          : '',
      )
    } else {
      setName('')
      setWeights({ ...DEFAULT_WEIGHTS })
      setThresholds({ ...DEFAULT_THRESHOLDS })
      setAutoEligible('')
    }
  }

  function newRuleSet() {
    setIsNew(true)
    setSelectedId('__new__')
    setSelected(null)
    setSim(null)
    setSimErr(null)
    setEditorErr(null)
    fillEditor(null)
  }

  async function openRuleSet(id: string) {
    setIsNew(false)
    setSelectedId(id)
    setSelected(null)
    setSim(null)
    setSimErr(null)
    setEditorErr(null)
    setSelectLoading(true)
    try {
      const rs: RuleSet = await api.getRuleSet(id)
      setSelected(rs)
      fillEditor(rs)
    } catch (e) {
      setEditorErr(e instanceof Error ? e.message : 'Failed to load rule set')
    } finally {
      setSelectLoading(false)
    }
  }

  function parseEligible(): string[] {
    return autoEligible
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function saveEditor() {
    if (!wsId) return
    if (!name.trim()) {
      setEditorErr('Name is required')
      return
    }
    setSavingEditor(true)
    setEditorErr(null)
    const payload = {
      workspace_id: wsId,
      name: name.trim(),
      weights,
      thresholds,
      auto_deflect_eligible: parseEligible(),
    }
    try {
      if (isNew) {
        const created: RuleSet = await api.createRuleSet(payload)
        await load(wsId)
        setIsNew(false)
        if (created?.id) await openRuleSet(created.id)
      } else if (selected) {
        await api.updateRuleSet(selected.id, payload)
        await load(wsId)
        await openRuleSet(selected.id)
      }
    } catch (e) {
      setEditorErr(e instanceof Error ? e.message : 'Failed to save rule set')
    } finally {
      setSavingEditor(false)
    }
  }

  async function activate(rs: RuleSet) {
    if (!wsId) return
    setBusyId(rs.id)
    try {
      await api.activateRuleSet(rs.id)
      await load(wsId)
      if (selected?.id === rs.id) await openRuleSet(rs.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate')
    } finally {
      setBusyId(null)
    }
  }

  async function runSimulate() {
    if (!selected) return
    setSimLoading(true)
    setSimErr(null)
    setSim(null)
    try {
      const res: SimResult = await api.simulateRuleSet(selected.id, {
        weights,
        thresholds,
        auto_deflect_eligible: parseEligible(),
      })
      setSim(res?.results ?? (res as unknown as SimResult['results']) ?? null)
    } catch (e) {
      setSimErr(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setSimLoading(false)
    }
  }

  async function doDelete() {
    if (!confirmDelete || !wsId) return
    const target = confirmDelete
    setBusyId(target.id)
    try {
      await api.deleteRuleSet(target.id)
      setConfirmDelete(null)
      if (selectedId === target.id) {
        setSelectedId(null)
        setSelected(null)
      }
      await load(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusyId(null)
    }
  }

  const editorOpen = selectedId !== null

  if (loading) return <PageSpinner label="Loading decision rules..." />

  if (!wsId) {
    return (
      <EmptyState
        title="No workspace selected"
        description="Create or select a workspace on the dashboard to configure decision rules."
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
          <h1 className="text-2xl font-semibold text-slate-100">Decision Rules</h1>
          <p className="mt-1 text-sm text-slate-400">
            Weighted scoring rule sets that drive deflect-vs-represent recommendations.
          </p>
        </div>
        <Button onClick={newRuleSet}>+ New rule set</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Rule sets" value={ruleSets.length} />
        <Stat label="Active" value={activeCount} tone="green" />
        <Stat
          label="Latest version"
          value={ruleSets.reduce((m, r) => Math.max(m, r.version ?? 0), 0) || '—'}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {ruleSets.length === 0 ? (
        <EmptyState
          title="No rule sets yet"
          description="Create your first decision rule set to start scoring incoming alerts."
          action={<Button onClick={newRuleSet}>+ New rule set</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ruleSets.map((rs) => (
            <Card key={rs.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-100">{rs.name}</h3>
                      {rs.is_active ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="slate">Inactive</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      v{rs.version ?? 1} · created{' '}
                      {new Date(rs.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(rs.weights ?? {})
                    .slice(0, 5)
                    .map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-0.5 text-xs text-slate-400"
                      >
                        {k.replace(/_/g, ' ')}: <span className="text-slate-200">{v}</span>
                      </span>
                    ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    className="!px-3 !py-1.5 text-xs"
                    onClick={() => openRuleSet(rs.id)}
                  >
                    Edit & simulate
                  </Button>
                  {!rs.is_active && (
                    <Button
                      className="!px-3 !py-1.5 text-xs"
                      disabled={busyId === rs.id}
                      onClick={() => activate(rs)}
                    >
                      {busyId === rs.id ? 'Activating...' : 'Activate'}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    className="!px-3 !py-1.5 text-xs"
                    disabled={busyId === rs.id}
                    onClick={() => setConfirmDelete(rs)}
                  >
                    Delete
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Editor + simulator modal */}
      <Modal
        open={editorOpen}
        onClose={() => {
          setSelectedId(null)
          setSelected(null)
        }}
        className="max-w-3xl"
        title={isNew ? 'New rule set' : selected ? `Edit: ${selected.name}` : 'Rule set'}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedId(null)
                setSelected(null)
              }}
            >
              Close
            </Button>
            {!isNew && selected && (
              <Button variant="secondary" disabled={simLoading} onClick={runSimulate}>
                {simLoading ? 'Simulating...' : 'Run simulation'}
              </Button>
            )}
            <Button onClick={saveEditor} disabled={savingEditor}>
              {savingEditor ? 'Saving...' : isNew ? 'Create' : 'Save changes'}
            </Button>
          </>
        }
      >
        {selectLoading ? (
          <Spinner label="Loading rule set..." className="py-10" />
        ) : (
          <div className="space-y-5">
            {editorErr && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {editorErr}
              </div>
            )}

            <FormField label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard deflection policy"
              />
            </FormField>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Scoring weights
              </div>
              <div className="space-y-3">
                {Object.keys(weights).map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <label className="w-44 shrink-0 text-sm capitalize text-slate-300">
                      {k.replace(/_/g, ' ')}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={weights[k]}
                      onChange={(e) =>
                        setWeights({ ...weights, [k]: Number(e.target.value) })
                      }
                      className="flex-1 accent-orange-500"
                    />
                    <span className="w-10 text-right text-sm font-medium text-orange-300">
                      {weights[k]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Decision thresholds
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Object.keys(thresholds).map((k) => (
                  <FormField key={k} label={k.replace(/_/g, ' ')}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className={inputCls}
                      value={thresholds[k]}
                      onChange={(e) =>
                        setThresholds({ ...thresholds, [k]: Number(e.target.value) })
                      }
                    />
                  </FormField>
                ))}
              </div>
            </div>

            <FormField label="Auto-deflect eligible reason categories (comma separated)">
              <input
                className={inputCls}
                value={autoEligible}
                onChange={(e) => setAutoEligible(e.target.value)}
                placeholder="fraud, subscription, friendly"
              />
            </FormField>

            {/* Simulation results */}
            {(simErr || sim) && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Simulation over historical alerts
                </div>
                {simErr ? (
                  <div className="text-sm text-red-300">{simErr}</div>
                ) : sim ? (
                  <SimView sim={sim} />
                ) : null}
              </div>
            )}

            {isNew && (
              <p className="text-xs text-slate-500">
                Save the rule set first to run a simulation against historical alerts.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete rule set"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busyId === confirmDelete?.id}
              onClick={doDelete}
            >
              {busyId === confirmDelete?.id ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete rule set{' '}
          <span className="font-semibold text-slate-100">{confirmDelete?.name}</span>? This cannot
          be undone.
          {confirmDelete?.is_active && (
            <span className="mt-2 block text-amber-300">
              This rule set is currently active.
            </span>
          )}
        </p>
      </Modal>
    </div>
  )
}

function SimView({ sim }: { sim: NonNullable<SimResult['results']> }) {
  const dispo = sim.by_disposition ?? {}
  const total = sim.total ?? Object.values(dispo).reduce((s, n) => s + n, 0)
  const entries = Object.entries(dispo)
  const max = Math.max(1, ...entries.map(([, n]) => n))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div>
          <div className="text-xs text-slate-500">Alerts evaluated</div>
          <div className="text-xl font-semibold text-slate-100">{total}</div>
        </div>
        {sim.projected_deflection_rate != null && (
          <div>
            <div className="text-xs text-slate-500">Projected deflection rate</div>
            <div className="text-xl font-semibold text-emerald-400">
              {pct(sim.projected_deflection_rate)}
            </div>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([k, n]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm capitalize text-slate-400">
                {k.replace(/_/g, ' ')}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-slate-900">
                <div
                  className={`h-full ${
                    dispoTones[k] === 'green'
                      ? 'bg-emerald-500/70'
                      : dispoTones[k] === 'red'
                        ? 'bg-red-500/70'
                        : dispoTones[k] === 'amber'
                          ? 'bg-amber-500/70'
                          : 'bg-slate-600'
                  }`}
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-medium text-slate-200">{n}</span>
            </div>
          ))}
        </div>
      )}

      {sim.dispositions && sim.dispositions.length > 0 && (
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {sim.dispositions.slice(0, 40).map((d) => (
            <div
              key={d.alert_id}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-xs"
            >
              <span className="font-mono text-slate-500">{d.alert_id.slice(0, 8)}</span>
              <span className="text-slate-400">{d.reason_code || '—'}</span>
              <Badge tone={dispoTones[d.recommendation] ?? 'slate'}>{d.recommendation}</Badge>
              <span className="text-slate-300">{d.score}</span>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && (!sim.dispositions || sim.dispositions.length === 0) && (
        <p className="text-sm text-slate-500">
          No historical alerts to simulate against yet.
        </p>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-orange-500 focus:outline-none'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide capitalize text-slate-500">
        {label}
      </span>
      {children}
    </label>
  )
}
