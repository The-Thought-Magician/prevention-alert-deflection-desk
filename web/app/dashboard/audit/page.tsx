'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type AuditEvent = {
  id: string
  workspace_id: string
  actor: string
  action: string
  entity_type: string
  entity_id: string
  detail: any
  created_at: string
}

function actionTone(action: string): 'green' | 'red' | 'amber' | 'blue' | 'orange' | 'slate' {
  const a = action.toLowerCase()
  if (a.includes('delete') || a.includes('remove') || a.includes('override')) return 'red'
  if (a.includes('create') || a.includes('add') || a.includes('refund') || a.includes('deflect')) return 'green'
  if (a.includes('update') || a.includes('edit') || a.includes('status')) return 'amber'
  if (a.includes('evaluate') || a.includes('decision')) return 'blue'
  if (a.includes('sync') || a.includes('run') || a.includes('generate')) return 'orange'
  return 'slate'
}

function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function relTime(s?: string) {
  if (!s) return ''
  const d = new Date(s).getTime()
  if (isNaN(d)) return ''
  const diff = Date.now() - d
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

export default function AuditPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Server-side filters (passed to listAuditEvents)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // Client-side text search across loaded rows
  const [search, setSearch] = useState('')

  const [detail, setDetail] = useState<AuditEvent | null>(null)

  useEffect(() => {
    setWs(getActiveWorkspace())
  }, [])

  const buildFilters = useCallback(() => {
    const f: Record<string, string> = {}
    if (actor.trim()) f.actor = actor.trim()
    if (action.trim()) f.action = action.trim()
    if (entityType.trim()) f.entity_type = entityType.trim()
    if (fromDate) f.from = fromDate
    if (toDate) f.to = toDate
    return f
  }, [actor, action, entityType, fromDate, toDate])

  const load = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await api.listAuditEvents(ws, buildFilters())
      setEvents(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load audit events')
    } finally {
      setLoading(false)
    }
  }, [ws, buildFilters])

  useEffect(() => {
    load()
  }, [load])

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault()
    load()
  }

  const clearFilters = () => {
    setActor('')
    setAction('')
    setEntityType('')
    setFromDate('')
    setToDate('')
    setSearch('')
  }

  const actionOptions = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.action))).sort()
  }, [events])
  const entityTypeOptions = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.entity_type))).sort()
  }, [events])

  const filtered = useMemo(() => {
    if (!search.trim()) return events
    const q = search.toLowerCase()
    return events.filter((e) =>
      `${e.actor} ${e.action} ${e.entity_type} ${e.entity_id} ${JSON.stringify(e.detail ?? '')}`
        .toLowerCase()
        .includes(q),
    )
  }, [events, search])

  const uniqueActors = useMemo(() => new Set(events.map((e) => e.actor)).size, [events])
  const todayCount = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return events.filter((e) => new Date(e.created_at) >= start).length
  }, [events])

  const hasActiveFilters = !!(actor || action || entityType || fromDate || toDate)

  if (!ws && !loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace from the dashboard to view the audit trail."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  if (loading && events.length === 0) return <PageSpinner label="Loading audit trail..." />

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Audit Trail</h1>
          <p className="mt-1 text-sm text-slate-400">
            Immutable log of every action taken across the workspace, with actor, entity, and detail.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Events loaded" value={events.length} />
        <Stat label="Distinct actors" value={uniqueActors} tone="orange" />
        <Stat label="Today" value={todayCount} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <form onSubmit={applyFilters} className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Actor"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">All actions</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">All entities</option>
              {entityTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                Apply
              </Button>
              {(hasActiveFilters || search) && (
                <Button type="button" variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          </form>
          <div className="mt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search within loaded events (actor, entity id, detail)..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-orange-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={events.length === 0 ? 'No audit events' : 'No matching events'}
                description={
                  events.length === 0
                    ? 'Actions taken in this workspace will appear here as they happen.'
                    : 'Adjust filters or search to find events.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH className="text-right">Detail</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((ev) => (
                  <TR key={ev.id}>
                    <TD className="whitespace-nowrap">
                      <div className="text-slate-200">{fmtDateTime(ev.created_at)}</div>
                      <div className="text-xs text-slate-500">{relTime(ev.created_at)}</div>
                    </TD>
                    <TD className="font-medium text-slate-200">{ev.actor || '—'}</TD>
                    <TD>
                      <Badge tone={actionTone(ev.action)}>{ev.action}</Badge>
                    </TD>
                    <TD>
                      <div className="text-slate-300">{ev.entity_type || '—'}</div>
                      {ev.entity_id && <div className="font-mono text-xs text-slate-500">{ev.entity_id}</div>}
                    </TD>
                    <TD className="text-right">
                      {ev.detail != null ? (
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setDetail(ev)}>
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Audit event detail" className="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Actor</div>
                <div className="mt-1 text-sm text-slate-100">{detail.actor || '—'}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Action</div>
                <div className="mt-1">
                  <Badge tone={actionTone(detail.action)}>{detail.action}</Badge>
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Entity</div>
                <div className="mt-1 text-sm text-slate-100">{detail.entity_type || '—'}</div>
                <div className="font-mono text-xs text-slate-500">{detail.entity_id}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">When</div>
                <div className="mt-1 text-sm text-slate-100">{fmtDateTime(detail.created_at)}</div>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Detail payload</div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                {JSON.stringify(detail.detail, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
