'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import {
  LayoutDashboard,
  Inbox,
  PlusCircle,
  Clock,
  GitBranch,
  ShieldAlert,
  LineChart,
  BarChart3,
  Package,
  Users,
  RotateCcw,
  Settings2,
  Bot,
  Tag,
  Rss,
  FileText,
  ScrollText,
  Bell,
  UsersRound,
  Cog,
  Menu,
  type LucideIcon,
} from 'lucide-react'

type NavItem = { label: string; href: string; icon: LucideIcon }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Triage',
    items: [
      { label: 'Alert Queue', href: '/dashboard/alerts', icon: Inbox },
      { label: 'New Alert', href: '/dashboard/alerts/new', icon: PlusCircle },
      { label: 'Deadlines', href: '/dashboard/deadlines', icon: Clock },
      { label: 'Decisions', href: '/dashboard/decisions', icon: GitBranch },
    ],
  },
  {
    title: 'Ratio & Risk',
    items: [
      { label: 'Ratio Guardrail', href: '/dashboard/ratio', icon: ShieldAlert },
      { label: 'ROI & Savings', href: '/dashboard/roi', icon: LineChart },
      { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Records',
    items: [
      { label: 'Orders', href: '/dashboard/orders', icon: Package },
      { label: 'Customers', href: '/dashboard/customers', icon: Users },
      { label: 'Refunds', href: '/dashboard/refunds', icon: RotateCcw },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { label: 'Decision Rules', href: '/dashboard/rules', icon: Settings2 },
      { label: 'Automation', href: '/dashboard/automation', icon: Bot },
      { label: 'Reason Codes', href: '/dashboard/reason-codes', icon: Tag },
      { label: 'Feeds', href: '/dashboard/feeds', icon: Rss },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Reports', href: '/dashboard/reports', icon: FileText },
      { label: 'Audit Trail', href: '/dashboard/audit', icon: ScrollText },
      { label: 'Notifications', href: '/dashboard/notifications', icon: Bell },
      { label: 'Team', href: '/dashboard/team', icon: UsersRound },
      { label: 'Settings', href: '/dashboard/settings', icon: Cog },
    ],
  },
]

const ALL_ITEMS: NavItem[] = SECTIONS.flatMap((s) => s.items)

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
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex items-center gap-3 text-neutral-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-orange-500" />
          Loading workspace...
        </div>
      </div>
    )
  }

  // Icon-only rail: fixed narrow width, icons + hover tooltips, no text labels inline.
  const rail = (
    <nav className="flex h-full flex-col items-center">
      <Link
        href="/dashboard"
        className="flex h-14 w-full items-center justify-center border-b border-neutral-800"
        title="Prevention Alert Deflection Desk"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
      </Link>
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {ALL_ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          const Icon = item.icon
          return (
            <div key={item.href} className="group relative w-full px-2">
              <Link
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={`flex h-10 w-10 mx-auto items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-orange-500/15 text-orange-300'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
                }`}
              >
                <Icon size={18} strokeWidth={2} />
              </Link>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-100 opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100"
              >
                {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-neutral-950">
      {/* Desktop icon rail: persistent, narrow, always visible */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 border-r border-neutral-800 bg-neutral-900/60 lg:block">
        {rail}
      </aside>

      {/* Mobile drawer: full labels for usability on small screens */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-neutral-800 bg-neutral-900 overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
              <span className="text-sm font-bold leading-tight text-neutral-100">
                Prevention Alert<br />Deflection Desk
              </span>
            </div>
            <div className="px-3 py-4">
              {SECTIONS.map((section) => (
                <div key={section.title} className="mb-5">
                  <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600">{section.title}</div>
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = isActive(pathname, item.href)
                      const Icon = item.icon
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                              active
                                ? 'bg-orange-500/15 font-medium text-orange-300'
                                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
                            }`}
                          >
                            <Icon size={16} strokeWidth={2} />
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-16">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-800 bg-neutral-950/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <span className="text-sm font-medium text-neutral-300">PreventionAlertDeflectionDesk</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-400 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
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
