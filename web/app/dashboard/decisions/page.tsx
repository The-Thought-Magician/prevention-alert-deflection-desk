'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Decision = {
  id: string
  alert_id?: string
  rule_set_id?: string
  recommendation?: string
  score?: number
  factors?: Record<string, unknown> | null
  is_override?: boolean
  override_reason?: string | null
  decided_by?: string | null
  created_at?: string
}

const RECOMMENDATIONS = ['REFUND_DEFLECT', 'REPRESENT', 'REVIEW']

function recTone(rec?: string): 'green' | 'red' | 'amber' | 'slate' {
  switch (rec) {
    case 'REFUND_DEFLECT': return 'green'
    case 'REPRESENT': return 'red'
    case 'REVIEW': return 'amber'
    default: return 'slate'
  }
}

function recLabel(rec?: string) {
  return rec ? rec.replace(/_/g, ' ') : '—'
}

export default function DecisionsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])

  const [search, setSearch] = useState('')
  const [recFilter, setRecFilter] = useState<string>('all')
  const [overrideFilter, setOverrideFilter] = useState<'all' | 'override' | 'engine'>('all')

  // Override modal
  const [target, setTarget] = useState<Decision | null>(null)
  const [overrideRec, setOverrideRec] = useState('REVIEW')
  const [overrideReason, setOverrideReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Factors inspector
  const [inspect, setInspect] = useState<Decision | null>(null)

  async function load(ws: string) {
    const d = await api.listDecisions(ws)
    setDecisions(Array.isArray(d) ? d : [])
  }

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
        if (!ws) { setLoading(false); return }
        setWorkspaceId(ws)
        await load(ws)
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'Failed to load decisions')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return decisions.filter((d) => {
      if (recFilter !== 'all' && d.recommendation !== recFilter) return false
      if (overrideFilter === 'override' && !d.is_override) return false
      if (overrideFilter === 'engine' && d.is_override) return false
      if (q) {
        const hay = `${d.id} ${d.alert_id ?? ''} ${d.recommendation ?? ''} ${d.override_reason ?? ''} ${d.decided_by ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [decisions, search, recFilter, overrideFilter])

  const stats = useMemo(() => {
    const total = decisions.length
    const deflect = decisions.filter((d) => d.recommendation === 'REFUND_DEFLECT').length
    const represent = decisions.filter((d) => d.recommendation === 'REPRESENT').length
    const overrides = decisions.filter((d) => d.is_override).length
    return { total, deflect, represent, overrides }
  }, [decisions])

  function openOverride(d: Decision) {
    setTarget(d)
    setOverrideRec(d.recommendation && RECOMMENDATIONS.includes(d.recommendation)
      ? (d.recommendation === 'REFUND_DEFLECT' ? 'REPRESENT' : 'REFUND_DEFLECT')
      : 'REVIEW')
    setOverrideReason('')
    setModalError(null)
  }

  async function submitOverride() {
    if (!target || !workspaceId) return
    if (!overrideReason.trim()) { setModalError('A reason is required to override.'); return }
    setSubmitting(true)
    setModalError(null)
    try {
      const updated = await api.overrideDecision(target.id, {
        recommendation: overrideRec,
        override_reason: overrideReason.trim(),
      })
      // Optimistically merge; reload to stay authoritative.
      setDecisions((prev) => prev.map((d) => (d.id === target.id ? { ...d, ...(updated || {}), is_override: true, recommendation: overrideRec, override_reason: overrideReason.trim() } : d)))
      setTarget(null)
      await load(workspaceId)
    } catch (e: any) {
      setModalError(e?.message ?? 'Override failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading decision history..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace from the dashboard to view decision history."
          action={<Link href="/dashboard"><Button>Go to dashboard</Button></Link>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Decisions</h1>
          <p className="mt-1 text-sm text-slate-400">
            History of every engine recommendation and manual override, with the explainable factor breakdown.
          </p>
        </div>
        <Link href="/dashboard/alerts" className="text-sm text-orange-400 hover:text-orange-300">
          Triage queue →
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Decisions" value={stats.total} />
        <Stat label="Deflect" value={stats.deflect} tone="green" />
        <Stat label="Represent" value={stats.represent} tone="red" />
        <Stat label="Overrides" value={stats.overrides} tone="orange" sub={stats.total ? `${Math.round((stats.overrides / stats.total) * 100)}% override rate` : undefined} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-200">History</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search alert / reason / actor"
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
              <select
                value={recFilter}
                onChange={(e) => setRecFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All recommendations</option>
                {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{recLabel(r)}</option>)}
              </select>
              <select
                value={overrideFilter}
                onChange={(e) => setOverrideFilter(e.target.value as any)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">Engine + overrides</option>
                <option value="engine">Engine only</option>
                <option value="override">Overrides only</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {decisions.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No decisions yet"
                description="Decisions appear after you evaluate alerts. Run the engine from the alert queue or an alert's detail page."
                action={<Link href="/dashboard/alerts"><Button>Go to alert queue</Button></Link>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No decisions match the current filters.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Alert</TH>
                  <TH>Recommendation</TH>
                  <TH>Score</TH>
                  <TH>Source</TH>
                  <TH>Decided by</TH>
                  <TH>When</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-medium text-slate-200">
                      {d.alert_id ? (
                        <Link href={`/dashboard/alerts/${d.alert_id}`} className="hover:text-orange-300">
                          {d.alert_id.slice(0, 8)}…
                        </Link>
                      ) : '—'}
                    </TD>
                    <TD>
                      <Badge tone={recTone(d.recommendation)}>{recLabel(d.recommendation)}</Badge>
                    </TD>
                    <TD>
                      {d.score != null ? (
                        <span className="font-mono text-slate-200">{Number(d.score).toFixed(2)}</span>
                      ) : '—'}
                    </TD>
                    <TD>
                      {d.is_override
                        ? <Badge tone="orange">Override</Badge>
                        : <Badge tone="slate">Engine</Badge>}
                    </TD>
                    <TD className="text-xs">{d.decided_by ?? '—'}</TD>
                    <TD className="text-xs text-slate-500">
                      {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setInspect(d)}
                          className="text-xs text-slate-400 hover:text-slate-200"
                        >
                          Factors
                        </button>
                        <button
                          onClick={() => openOverride(d)}
                          className="text-xs text-orange-400 hover:text-orange-300"
                        >
                          Override
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

      {/* Override modal */}
      <Modal
        open={!!target}
        onClose={() => !submitting && setTarget(null)}
        title="Override decision"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={submitOverride} disabled={submitting}>
              {submitting ? 'Saving…' : 'Record override'}
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Current</span>
                <Badge tone={recTone(target.recommendation)}>{recLabel(target.recommendation)}</Badge>
              </div>
              {target.alert_id && (
                <div className="mt-1 text-xs text-slate-500">Alert {target.alert_id}</div>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">New recommendation</span>
              <select
                value={overrideRec}
                onChange={(e) => setOverrideRec(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{recLabel(r)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">Reason <span className="text-orange-400">*</span></span>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
                placeholder="Why are you overriding the engine recommendation?"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            {modalError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                {modalError}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Factors inspector */}
      <Modal
        open={!!inspect}
        onClose={() => setInspect(null)}
        title="Decision factors"
        footer={<Button variant="secondary" onClick={() => setInspect(null)}>Close</Button>}
      >
        {inspect && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={recTone(inspect.recommendation)}>{recLabel(inspect.recommendation)}</Badge>
              {inspect.score != null && (
                <span className="font-mono text-sm text-slate-300">score {Number(inspect.score).toFixed(2)}</span>
              )}
            </div>
            {inspect.is_override && inspect.override_reason && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-sm text-orange-200">
                <span className="font-medium">Override reason:</span> {inspect.override_reason}
              </div>
            )}
            {inspect.factors && Object.keys(inspect.factors).length > 0 ? (
              <div className="space-y-1.5">
                {Object.entries(inspect.factors).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
                    <span className="text-slate-400">{k.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-slate-200">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No factor breakdown recorded for this decision.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
