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

const WS_KEY = 'pad_workspace_id'

type Feed = {
  id: string
  workspace_id: string
  network: string
  display_name: string
  endpoint: string
  is_enabled: boolean
  is_sample_mode: boolean
  status: string
  last_sync_at: string | null
  alert_volume: number
  config: Record<string, unknown> | null
  created_at: string
}

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover']

function networkTone(n: string): 'blue' | 'amber' | 'green' | 'purple' | 'slate' {
  const k = (n || '').toLowerCase()
  if (k === 'visa') return 'blue'
  if (k === 'mastercard') return 'amber'
  if (k === 'amex') return 'green'
  if (k === 'discover') return 'purple'
  return 'slate'
}

function statusMeta(status: string, enabled: boolean): { tone: 'green' | 'amber' | 'red' | 'slate'; label: string } {
  if (!enabled) return { tone: 'slate', label: 'Disabled' }
  const k = (status || '').toLowerCase()
  if (k === 'healthy' || k === 'connected' || k === 'active' || k === 'ok') return { tone: 'green', label: status || 'Healthy' }
  if (k === 'degraded' || k === 'warning' || k === 'stale') return { tone: 'amber', label: status || 'Degraded' }
  if (k === 'error' || k === 'failed' || k === 'down' || k === 'disconnected') return { tone: 'red', label: status || 'Error' }
  return { tone: 'slate', label: status || 'Unknown' }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'Never'
  const diff = Date.now() - t
  if (diff < 0) return 'Just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function blankForm() {
  return {
    network: 'visa',
    display_name: '',
    endpoint: '',
    is_sample_mode: true,
    is_enabled: true,
  }
}

export default function FeedsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [networkFilter, setNetworkFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Feed | null>(null)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncResults, setSyncResults] = useState<Record<string, number>>({})

  const load = useCallback(async (workspaceId: string) => {
    setError(null)
    try {
      const data = await api.listFeeds(workspaceId)
      setFeeds(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feeds')
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
        await load(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return feeds.filter((f) => {
      if (networkFilter !== 'all' && (f.network || '').toLowerCase() !== networkFilter) return false
      if (q) {
        const hay = `${f.display_name} ${f.network} ${f.endpoint}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [feeds, search, networkFilter])

  const summary = useMemo(() => {
    const enabled = feeds.filter((f) => f.is_enabled).length
    const healthy = feeds.filter((f) => f.is_enabled && statusMeta(f.status, f.is_enabled).tone === 'green').length
    const volume = feeds.reduce((acc, f) => acc + (f.alert_volume || 0), 0)
    const sample = feeds.filter((f) => f.is_sample_mode).length
    return { total: feeds.length, enabled, healthy, volume, sample }
  }, [feeds])

  function openCreate() {
    setEditing(null)
    setForm(blankForm())
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(feed: Feed) {
    setEditing(feed)
    setForm({
      network: feed.network,
      display_name: feed.display_name,
      endpoint: feed.endpoint ?? '',
      is_sample_mode: feed.is_sample_mode,
      is_enabled: feed.is_enabled,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!ws) return
    setFormError(null)
    if (!form.display_name.trim()) {
      setFormError('Display name is required')
      return
    }
    if (!form.is_sample_mode && !form.endpoint.trim()) {
      setFormError('Endpoint is required for live feeds')
      return
    }
    const body = {
      workspace_id: ws,
      network: form.network,
      display_name: form.display_name.trim(),
      endpoint: form.endpoint.trim(),
      is_sample_mode: form.is_sample_mode,
      is_enabled: form.is_enabled,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateFeed(editing.id, body)
      } else {
        await api.createFeed(body)
      }
      setModalOpen(false)
      await load(ws)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save feed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(feed: Feed) {
    if (!ws) return
    setActionError(null)
    try {
      await api.updateFeed(feed.id, { is_enabled: !feed.is_enabled })
      await load(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update feed')
    }
  }

  async function toggleSampleMode(feed: Feed) {
    if (!ws) return
    setActionError(null)
    try {
      await api.updateFeed(feed.id, { is_sample_mode: !feed.is_sample_mode })
      await load(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update feed')
    }
  }

  async function sync(feed: Feed) {
    if (!ws) return
    setActionError(null)
    setSyncingId(feed.id)
    try {
      const res = await api.syncFeed(feed.id)
      const synced = typeof res?.synced === 'number' ? res.synced : 0
      setSyncResults((prev) => ({ ...prev, [feed.id]: synced }))
      await load(ws)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to sync feed')
    } finally {
      setSyncingId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading feeds..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No workspace yet"
          description="Create or join a workspace from the dashboard before connecting network feeds."
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
          <h1 className="text-2xl font-semibold text-slate-100">Feeds</h1>
          <p className="mt-1 text-sm text-slate-400">
            Network alert connections (Visa RDR, Mastercard Ethoca, Amex, Discover). Run a sample sync to generate alerts for testing.
          </p>
        </div>
        <Button onClick={openCreate}>+ Connect feed</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Feeds" value={summary.total} sub={`${summary.sample} in sample mode`} />
        <Stat label="Enabled" value={summary.enabled} tone="orange" />
        <Stat label="Healthy" value={summary.healthy} tone="green" />
        <Stat label="Alert volume" value={summary.volume.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-200">Connections</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search feeds..."
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All networks</option>
              {NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={feeds.length === 0 ? 'No feeds connected' : 'No feeds match your filters'}
              description={
                feeds.length === 0
                  ? 'Connect a network feed in sample mode to start generating alerts, or wire up a live endpoint.'
                  : 'Adjust the search or network filter to see more feeds.'
              }
              action={feeds.length === 0 ? <Button onClick={openCreate}>Connect your first feed</Button> : undefined}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((feed) => {
                const meta = statusMeta(feed.status, feed.is_enabled)
                const lastSynced = syncResults[feed.id]
                return (
                  <div
                    key={feed.id}
                    className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              meta.tone === 'green'
                                ? 'bg-emerald-400'
                                : meta.tone === 'amber'
                                  ? 'bg-amber-400'
                                  : meta.tone === 'red'
                                    ? 'bg-red-400'
                                    : 'bg-slate-600'
                            }`}
                          />
                          <span className="font-medium text-slate-100">{feed.display_name}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={networkTone(feed.network)}>{feed.network}</Badge>
                          {feed.is_sample_mode && <Badge tone="purple">Sample</Badge>}
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                      </div>
                    </div>

                    {feed.endpoint && (
                      <div className="mt-3 truncate font-mono text-xs text-slate-500" title={feed.endpoint}>
                        {feed.endpoint}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                        <div className="text-slate-500">Alert volume</div>
                        <div className="mt-0.5 text-sm font-semibold text-slate-200">
                          {(feed.alert_volume || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                        <div className="text-slate-500">Last sync</div>
                        <div className="mt-0.5 text-sm font-semibold text-slate-200">{timeAgo(feed.last_sync_at)}</div>
                      </div>
                    </div>

                    {lastSynced != null && (
                      <div className="mt-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-300">
                        Synced {lastSynced} sample alert{lastSynced === 1 ? '' : 's'}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-800 pt-3">
                      <Button
                        variant="primary"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => sync(feed)}
                        disabled={syncingId === feed.id || !feed.is_enabled}
                      >
                        {syncingId === feed.id ? 'Syncing...' : 'Sample sync'}
                      </Button>
                      <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => toggleEnabled(feed)}>
                        {feed.is_enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => toggleSampleMode(feed)}>
                        {feed.is_sample_mode ? 'Go live' : 'To sample'}
                      </Button>
                      <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => openEdit(feed)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit feed connection' : 'Connect network feed'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Connect feed'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Network</label>
              <select
                value={form.network}
                onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
                disabled={!!editing}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none disabled:opacity-60"
              >
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Display name</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Visa RDR"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Endpoint <span className="normal-case text-slate-600">(optional in sample mode)</span>
            </label>
            <input
              value={form.endpoint}
              onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
              placeholder="https://feed.network.example/alerts"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_sample_mode}
                onChange={(e) => setForm((f) => ({ ...f, is_sample_mode: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-orange-500"
              />
              Sample mode (generate synthetic alerts on sync)
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
