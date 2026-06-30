'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { Card, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  type?: string
  title?: string
  body?: string
  entity_type?: string
  entity_id?: string
  is_read?: boolean
  created_at?: string
}

const TYPE_TONES: Record<string, 'orange' | 'red' | 'amber' | 'green' | 'blue' | 'slate'> = {
  deadline: 'red',
  breach: 'red',
  ratio: 'amber',
  alert: 'orange',
  refund: 'green',
  decision: 'blue',
  automation: 'blue',
  system: 'slate',
}

function typeTone(t?: string): 'orange' | 'red' | 'amber' | 'green' | 'blue' | 'slate' {
  return TYPE_TONES[(t ?? '').toLowerCase()] ?? 'slate'
}

const ENTITY_PATH: Record<string, string> = {
  alert: '/dashboard/alerts',
  order: '/dashboard/orders',
  customer: '/dashboard/customers',
  refund: '/dashboard/refunds',
  decision: '/dashboard/decisions',
}

function entityLink(n: Notification): string | null {
  const base = ENTITY_PATH[(n.entity_type ?? '').toLowerCase()]
  if (!base) return null
  return n.entity_id ? `${base}/${n.entity_id}` : base
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [items, setItems] = useState<Notification[]>([])
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const resolveWorkspace = useCallback(async (): Promise<string | null> => {
    const stored = getActiveWorkspace()
    if (stored) return stored
    try {
      const list = await api.listWorkspaces()
      const first = Array.isArray(list) && list.length ? list[0]?.id : null
      if (first) setActiveWorkspace(first)
      return first ?? null
    } catch {
      return null
    }
  }, [])

  const load = useCallback(async (workspaceId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listNotifications(workspaceId)
      setItems(Array.isArray(res) ? res : Array.isArray(res?.notifications) ? res.notifications : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const id = await resolveWorkspace()
      if (!alive) return
      if (!id) {
        setNoWorkspace(true)
        setLoading(false)
        return
      }
      setWs(id)
      await load(id)
    })()
    return () => {
      alive = false
    }
  }, [resolveWorkspace, load])

  const markRead = useCallback(async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await api.markNotificationRead(id)
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as read')
    } finally {
      setBusy(null)
    }
  }, [])

  const markAll = useCallback(async () => {
    if (!ws) return
    setMarkingAll(true)
    setError(null)
    try {
      await api.markAllNotificationsRead({ workspace_id: ws })
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all as read')
    } finally {
      setMarkingAll(false)
    }
  }, [ws])

  const types = useMemo(() => {
    const set = new Set<string>()
    items.forEach((n) => n.type && set.add(n.type))
    return Array.from(set).sort()
  }, [items])

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items])

  const visible = useMemo(() => {
    return items
      .filter((n) => {
        if (filter === 'unread' && n.is_read) return false
        if (filter === 'read' && !n.is_read) return false
        if (typeFilter !== 'all' && (n.type ?? '').toLowerCase() !== typeFilter.toLowerCase()) return false
        return true
      })
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
  }, [items, filter, typeFilter])

  if (loading) return <PageSpinner label="Loading notifications..." />

  if (noWorkspace) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace from the dashboard to view notifications."
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Deadline warnings, ratio guardrail alerts, and deflection activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => ws && load(ws)}>
            Refresh
          </Button>
          <Button onClick={markAll} disabled={markingAll || unreadCount === 0}>
            {markingAll ? 'Marking...' : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total" value={items.length.toLocaleString()} />
        <Stat label="Unread" value={unreadCount.toLocaleString()} tone={unreadCount ? 'orange' : 'default'} />
        <Stat label="Read" value={(items.length - unreadCount).toLocaleString()} tone="green" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
          {(['all', 'unread', 'read'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'No notifications' : 'Nothing matches'}
          description={
            items.length === 0
              ? 'You are all caught up. New deadline and ratio alerts will appear here.'
              : 'No notifications match the current filters.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((n) => {
            const link = entityLink(n)
            return (
              <Card
                key={n.id}
                className={n.is_read ? 'opacity-70' : 'border-l-2 border-l-orange-500'}
              >
                <CardBody className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.is_read && <span className="inline-block h-2 w-2 rounded-full bg-orange-500" aria-hidden />}
                      {n.type && <Badge tone={typeTone(n.type)}>{n.type}</Badge>}
                      <span className="text-sm font-semibold text-slate-100">{n.title ?? 'Notification'}</span>
                      <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body && <p className="mt-1.5 text-sm text-slate-400">{n.body}</p>}
                    {link && (
                      <a href={link} className="mt-2 inline-block text-xs font-medium text-orange-400 hover:text-orange-300">
                        View {n.entity_type} →
                      </a>
                    )}
                  </div>
                  <div className="shrink-0">
                    {!n.is_read && (
                      <Button variant="ghost" onClick={() => markRead(n.id)} disabled={busy === n.id}>
                        {busy === n.id ? 'Marking...' : 'Mark read'}
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
