'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Triage',
    items: [
      { label: 'Alert Queue', href: '/dashboard/alerts' },
      { label: 'New Alert', href: '/dashboard/alerts/new' },
      { label: 'Deadlines', href: '/dashboard/deadlines' },
      { label: 'Decisions', href: '/dashboard/decisions' },
    ],
  },
  {
    title: 'Ratio & Risk',
    items: [
      { label: 'Ratio Guardrail', href: '/dashboard/ratio' },
      { label: 'ROI & Savings', href: '/dashboard/roi' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    title: 'Records',
    items: [
      { label: 'Orders', href: '/dashboard/orders' },
      { label: 'Customers', href: '/dashboard/customers' },
      { label: 'Refunds', href: '/dashboard/refunds' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { label: 'Decision Rules', href: '/dashboard/rules' },
      { label: 'Automation', href: '/dashboard/automation' },
      { label: 'Reason Codes', href: '/dashboard/reason-codes' },
      { label: 'Feeds', href: '/dashboard/feeds' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Audit Trail', href: '/dashboard/audit' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Team', href: '/dashboard/team' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [userLabel, setUserLabel] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = await authClient.getSession()
      const user = (s as any)?.data?.user ?? (s as any)?.user
      if (!alive) return
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      setUserLabel(user.name ?? user.email ?? 'Signed in')
      setChecking(false)
    })()
    return () => { alive = false }
  }, [router])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
        <span className="text-sm font-bold leading-tight text-slate-100">
          Prevention Alert<br />Deflection Desk
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-600">{section.title}</div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-orange-500/15 font-medium text-orange-300'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-800 bg-slate-900/60 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-slate-800 bg-slate-900">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              &#9776;
            </button>
            <span className="text-sm font-medium text-slate-300">PreventionAlertDeflectionDesk</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-400 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
