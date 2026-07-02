'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Report = {
  id: string
  workspace_id: string
  kind: string
  title: string
  period_start: string
  period_end: string
  data: any
  created_by: string
  created_at: string
}

const KINDS: { value: string; label: string; desc: string }[] = [
  { value: 'deflection', label: 'Deflection Summary', desc: 'Alerts resolved by refund vs lapse, savings, per-network breakdown.' },
  { value: 'monitoring', label: 'Monitoring Posture', desc: 'Ratio standing vs VDMP/ECP thresholds and exposure.' },
]

function kindTone(kind: string): 'orange' | 'blue' | 'slate' {
  if (kind === 'deflection') return 'orange'
  if (kind === 'monitoring') return 'blue'
  return 'slate'
}

function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoISO(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function ReportsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [kindFilter, setKindFilter] = useState('')
  const [search, setSearch] = useState('')

  const [genOpen, setGenOpen] = useState(false)
  const [genKind, setGenKind] = useState('deflection')
  const [genTitle, setGenTitle] = useState('')
  const [genStart, setGenStart] = useState(daysAgoISO(30))
  const [genEnd, setGenEnd] = useState(todayISO())
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  const [selected, setSelected] = useState<Report | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)

  useEffect(() => {
    setWs(getActiveWorkspace())
  }, [])

  const load = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await api.listReports(ws)
      setReports(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [ws])

  useEffect(() => {
    load()
  }, [load])

  const openGenerate = () => {
    setGenKind('deflection')
    setGenTitle('')
    setGenStart(daysAgoISO(30))
    setGenEnd(todayISO())
    setGenError('')
    setGenOpen(true)
  }

  const submitGenerate = async () => {
    if (!ws) return
    setGenerating(true)
    setGenError('')
    try {
      const body = {
        workspace_id: ws,
        kind: genKind,
        title: genTitle.trim() || `${KINDS.find((k) => k.value === genKind)?.label ?? genKind} ${genStart} → ${genEnd}`,
        period_start: genStart,
        period_end: genEnd,
      }
      const created: Report = await api.generateReport(body)
      setGenOpen(false)
      await load()
      if (created?.id) {
        void openDetail(created.id)
      }
    } catch (e: any) {
      setGenError(e?.message || 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setSelected(null)
    try {
      const full = await api.getReport(id)
      setSelected(full)
    } catch (e: any) {
      setError(e?.message || 'Failed to load report detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const doExport = async (id: string, format: 'csv' | 'json') => {
    setExportingId(id)
    try {
      const payload = await api.exportReport(id, format)
      const isJson = format === 'json'
      const content = isJson
        ? JSON.stringify(payload, null, 2)
        : typeof payload === 'string'
          ? payload
          : String(payload ?? '')
      const blob = new Blob([content], { type: isJson ? 'application/json' : 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report-${id}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e?.message || `Failed to export ${format.toUpperCase()}`)
    } finally {
      setExportingId(null)
    }
  }

  const filtered = reports.filter((r) => {
    if (kindFilter && r.kind !== kindFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(`${r.title} ${r.kind}`.toLowerCase().includes(q))) return false
    }
    return true
  })

  const deflectionCount = reports.filter((r) => r.kind === 'deflection').length
  const monitoringCount = reports.filter((r) => r.kind === 'monitoring').length
  const lastGenerated = reports.length
    ? reports.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b))
    : null

  if (!ws && !loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace from the dashboard to generate reports."
          action={
            <a href="/dashboard">
              <Button>Go to dashboard</Button>
            </a>
          }
        />
      </div>
    )
  }

  if (loading) return <PageSpinner label="Loading reports..." />

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Reports</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Generate and export deflection and monitoring-posture reports for any date range.
          </p>
        </div>
        <Button onClick={openGenerate}>+ Generate report</Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total reports" value={reports.length} />
        <Stat label="Deflection" value={deflectionCount} tone="orange" />
        <Stat label="Monitoring posture" value={monitoringCount} />
        <Stat label="Last generated" value={lastGenerated ? fmtDate(lastGenerated.created_at) : '—'} sub={lastGenerated?.title} />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setKindFilter('')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${kindFilter === '' ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
            >
              All
            </button>
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKindFilter(k.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${kindFilter === k.value ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none sm:w-64"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={reports.length === 0 ? 'No reports yet' : 'No matching reports'}
                description={
                  reports.length === 0
                    ? 'Generate your first deflection or monitoring-posture report to capture a point-in-time snapshot.'
                    : 'Adjust the filters or search to find reports.'
                }
                action={reports.length === 0 ? <Button onClick={openGenerate}>Generate report</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Kind</TH>
                  <TH>Period</TH>
                  <TH>Generated</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-neutral-100">{r.title}</TD>
                    <TD>
                      <Badge tone={kindTone(r.kind)}>{r.kind}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-neutral-400">
                      {fmtDate(r.period_start)} → {fmtDate(r.period_end)}
                    </TD>
                    <TD className="whitespace-nowrap text-neutral-400">{fmtDateTime(r.created_at)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => openDetail(r.id)}>
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-xs"
                          disabled={exportingId === r.id}
                          onClick={() => doExport(r.id, 'csv')}
                        >
                          CSV
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-xs"
                          disabled={exportingId === r.id}
                          onClick={() => doExport(r.id, 'json')}
                        >
                          JSON
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Generate modal */}
      <Modal
        open={genOpen}
        onClose={() => !generating && setGenOpen(false)}
        title="Generate report"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={submitGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {genError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{genError}</div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Report kind</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setGenKind(k.value)}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${genKind === k.value ? 'border-orange-500 bg-orange-500/10' : 'border-neutral-700 bg-neutral-950 hover:border-neutral-600'}`}
                >
                  <div className="text-sm font-semibold text-neutral-100">{k.label}</div>
                  <div className="mt-1 text-xs text-neutral-400">{k.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Title (optional)</label>
            <input
              value={genTitle}
              onChange={(e) => setGenTitle(e.target.value)}
              placeholder="Auto-generated if left blank"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Period start</label>
              <input
                type="date"
                value={genStart}
                onChange={(e) => setGenStart(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Period end</label>
              <input
                type="date"
                value={genEnd}
                onChange={(e) => setGenEnd(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={detailLoading || !!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.title : 'Report'}
        className="max-w-2xl"
        footer={
          selected ? (
            <>
              <Button variant="secondary" onClick={() => doExport(selected.id, 'csv')} disabled={exportingId === selected.id}>
                Export CSV
              </Button>
              <Button onClick={() => doExport(selected.id, 'json')} disabled={exportingId === selected.id}>
                Export JSON
              </Button>
            </>
          ) : undefined
        }
      >
        {detailLoading ? (
          <Spinner label="Loading report..." />
        ) : selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={kindTone(selected.kind)}>{selected.kind}</Badge>
              <span className="text-sm text-neutral-400">
                {fmtDate(selected.period_start)} → {fmtDate(selected.period_end)}
              </span>
              <span className="text-sm text-neutral-500">Generated {fmtDateTime(selected.created_at)}</span>
            </div>
            <ReportDataView data={selected.data} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function ReportDataView({ data }: { data: any }) {
  if (data == null) {
    return <p className="text-sm text-neutral-400">No report data captured.</p>
  }

  // Render top-level numeric metrics as stat tiles when present.
  const entries = typeof data === 'object' && !Array.isArray(data) ? Object.entries(data) : []
  const scalarMetrics = entries.filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
  const nested = entries.filter(([, v]) => v && typeof v === 'object')

  return (
    <div className="space-y-4">
      {scalarMetrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {scalarMetrics.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-xs uppercase tracking-wide text-neutral-500">{k.replace(/_/g, ' ')}</div>
              <div className="mt-1 text-lg font-semibold text-neutral-100">{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      {nested.map(([k, v]) => (
        <div key={k}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{k.replace(/_/g, ' ')}</div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
            {JSON.stringify(v, null, 2)}
          </pre>
        </div>
      ))}
      {scalarMetrics.length === 0 && nested.length === 0 && (
        <pre className="max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}
