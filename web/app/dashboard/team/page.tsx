'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspace, setActiveWorkspace } from '@/lib/workspace'
import { authClient } from '@/lib/auth/client'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Workspace = {
  id: string
  name: string
  invite_code: string
  default_currency: string
  created_by: string
  created_at: string
}

type Member = {
  id: string
  workspace_id: string
  user_id: string
  role: string
  joined_at: string
}

function roleTone(role: string): 'orange' | 'blue' | 'slate' {
  const r = (role || '').toLowerCase()
  if (r === 'owner') return 'orange'
  if (r === 'admin') return 'blue'
  return 'slate'
}

function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function TeamPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Rename workspace
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editCurrency, setEditCurrency] = useState('USD')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Join workspace
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  // Remove member
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removing, setRemoving] = useState(false)

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setWs(getActiveWorkspace())
    ;(async () => {
      try {
        const s = await authClient.getSession()
        const user = (s as any)?.data?.user ?? (s as any)?.user
        if (user?.id) setCurrentUserId(user.id)
      } catch {
        /* ignore */
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [w, m] = await Promise.all([api.getWorkspace(ws), api.listMembers(ws)])
      setWorkspace(w)
      setMembers(Array.isArray(m) ? m : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }, [ws])

  useEffect(() => {
    load()
  }, [load])

  const isOwner = !!workspace && (workspace.created_by === currentUserId ||
    members.some((m) => m.user_id === currentUserId && (m.role || '').toLowerCase() === 'owner'))

  const openEdit = () => {
    if (!workspace) return
    setEditName(workspace.name)
    setEditCurrency(workspace.default_currency || 'USD')
    setEditError('')
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!ws) return
    setSaving(true)
    setEditError('')
    try {
      const updated = await api.updateWorkspace(ws, { name: editName.trim(), default_currency: editCurrency.trim() })
      setWorkspace(updated)
      setEditOpen(false)
      setNotice('Workspace updated.')
    } catch (e: any) {
      setEditError(e?.message || 'Failed to update workspace')
    } finally {
      setSaving(false)
    }
  }

  const submitJoin = async () => {
    const code = joinCode.trim()
    if (!code) return
    setJoining(true)
    setJoinError('')
    try {
      const res = await api.joinWorkspace(code)
      const joinedId = res?.workspace?.id
      if (joinedId) {
        setActiveWorkspace(joinedId)
        setWs(joinedId)
      }
      setJoinOpen(false)
      setJoinCode('')
      setNotice('Joined workspace successfully.')
    } catch (e: any) {
      setJoinError(e?.message || 'Failed to join workspace')
    } finally {
      setJoining(false)
    }
  }

  const confirmRemove = async () => {
    if (!ws || !removeTarget) return
    setRemoving(true)
    setError('')
    try {
      await api.removeMember(ws, removeTarget.user_id)
      setMembers((prev) => prev.filter((m) => m.user_id !== removeTarget.user_id))
      setRemoveTarget(null)
      setNotice('Member removed.')
    } catch (e: any) {
      setError(e?.message || 'Failed to remove member')
      setRemoveTarget(null)
    } finally {
      setRemoving(false)
    }
  }

  const copyInvite = async () => {
    if (!workspace?.invite_code) return
    try {
      await navigator.clipboard.writeText(workspace.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  if (!ws && !loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace from the dashboard, or join an existing one with an invite code."
          action={
            <div className="flex gap-2">
              <a href="/dashboard">
                <Button variant="secondary">Go to dashboard</Button>
              </a>
              <Button onClick={() => setJoinOpen(true)}>Join with code</Button>
            </div>
          }
        />
        <JoinModal
          open={joinOpen}
          onClose={() => setJoinOpen(false)}
          code={joinCode}
          setCode={setJoinCode}
          onSubmit={submitJoin}
          joining={joining}
          error={joinError}
        />
      </div>
    )
  }

  if (loading) return <PageSpinner label="Loading team..." />

  const ownerCount = members.filter((m) => (m.role || '').toLowerCase() === 'owner').length

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Team</h1>
          <p className="mt-1 text-sm text-slate-400">Manage workspace membership, roles, and invite access.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setJoinOpen(true)}>
            Join workspace
          </Button>
          {isOwner && <Button onClick={openEdit}>Edit workspace</Button>}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-400 hover:text-emerald-200">
            &times;
          </button>
        </div>
      )}

      {/* Workspace summary */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-100">Workspace</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Name</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{workspace?.name ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Default currency</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{workspace?.default_currency ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Created</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{fmtDate(workspace?.created_at)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Invite code</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-orange-300">
                  {workspace?.invite_code ?? '—'}
                </code>
                {workspace?.invite_code && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={copyInvite}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Share the invite code with teammates. They can join from their own Team page using
            <span className="font-medium text-slate-300"> Join workspace</span>.
          </p>
        </CardBody>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Members" value={members.length} tone="orange" />
        <Stat label="Owners" value={ownerCount} />
        <Stat label="Your role" value={isOwner ? 'Owner' : members.find((m) => m.user_id === currentUserId)?.role ?? 'Member'} />
      </div>

      {/* Members table */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-100">Members</h2>
        </CardHeader>
        <CardBody className="p-0">
          {members.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No members" description="This workspace has no members yet." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH>Joined</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => {
                  const isSelf = m.user_id === currentUserId
                  const isMemberOwner = (m.role || '').toLowerCase() === 'owner'
                  return (
                    <TR key={m.id}>
                      <TD className="font-mono text-xs text-slate-300">
                        {m.user_id}
                        {isSelf && (
                          <Badge tone="slate" className="ml-2">
                            You
                          </Badge>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={roleTone(m.role)}>{m.role || 'member'}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-slate-400">{fmtDate(m.joined_at)}</TD>
                      <TD className="text-right">
                        {isOwner && !isSelf && !(isMemberOwner && ownerCount <= 1) ? (
                          <Button
                            variant="danger"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => setRemoveTarget(m)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit workspace modal */}
      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title="Edit workspace"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={saving || !editName.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{editError}</div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Workspace name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Default currency</label>
            <select
              value={editCurrency}
              onChange={(e) => setEditCurrency(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
            >
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Join workspace modal */}
      <JoinModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        code={joinCode}
        setCode={setJoinCode}
        onSubmit={submitJoin}
        joining={joining}
        error={joinError}
      />

      {/* Remove member confirm */}
      <Modal
        open={!!removeTarget}
        onClose={() => !removing && setRemoveTarget(null)}
        title="Remove member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRemove} disabled={removing}>
              {removing ? 'Removing...' : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Remove member <span className="font-mono text-slate-100">{removeTarget?.user_id}</span> from this workspace? They
          will lose access immediately.
        </p>
      </Modal>
    </div>
  )
}

function JoinModal({
  open,
  onClose,
  code,
  setCode,
  onSubmit,
  joining,
  error,
}: {
  open: boolean
  onClose: () => void
  code: string
  setCode: (v: string) => void
  onSubmit: () => void
  joining: boolean
  error: string
}) {
  return (
    <Modal
      open={open}
      onClose={() => !joining && onClose()}
      title="Join a workspace"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={joining}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={joining || !code.trim()}>
            {joining ? 'Joining...' : 'Join'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Invite code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. PADD-XXXX"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-orange-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim() && !joining) onSubmit()
            }}
          />
          <p className="mt-2 text-xs text-slate-500">
            Joining sets this workspace as your active workspace across the dashboard.
          </p>
        </div>
      </div>
    </Modal>
  )
}
