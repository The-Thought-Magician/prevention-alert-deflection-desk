'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const FREE_FEATURES = [
  'Unified Ethoca / Verifi CDRN / Visa RDR alert triage queue',
  'Deterministic refund-vs-represent decision engine',
  'Deflection deadline timer and breach alerting',
  'Chargeback-ratio guardrail vs VDMP / ECP',
  'Double-refund-prevention ledger',
  'ROI & savings dashboard',
  'Auto-deflection rules with dry-run',
  'Reason code library and analytics',
  'Reports, exports, and immutable audit trail',
  'Unlimited workspaces and team members',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (alive) setStripeEnabled(Boolean(res?.stripeEnabled))
      } catch {
        if (alive) setStripeEnabled(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
          <span className="text-lg font-black text-orange-400">PreventionAlertDeflectionDesk</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-neutral-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black text-white">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-400">
          Every feature is free for all signed-in users. A Pro tier is defined for future capacity, but checkout is
          disabled until billing is configured.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="rounded-2xl border border-orange-500/40 bg-neutral-900/80 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Free</h2>
              <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
                Current plan
              </span>
            </div>
            <div className="mt-4">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-neutral-400"> / forever</span>
            </div>
            <p className="mt-2 text-sm text-neutral-400">Full access to the entire deflection desk.</p>
            <ul className="mt-6 space-y-2">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-300">
                  <span className="mt-0.5 text-orange-400">&#10003;</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg bg-orange-600 py-3 text-center font-semibold text-white hover:bg-orange-500"
            >
              Start free
            </Link>
          </div>

          {/* Pro plan */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-left">
            <h2 className="text-xl font-bold text-white">Pro</h2>
            <div className="mt-4">
              <span className="text-4xl font-black text-white">Custom</span>
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Defined for future capacity (higher volume, premium support). All features are already free, so Pro adds
              no functional gate today.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-400">
              <li className="flex items-start gap-2"><span className="mt-0.5 text-neutral-500">&#10003;</span> Everything in Free</li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-neutral-500">&#10003;</span> Priority support</li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-neutral-500">&#10003;</span> Higher feed volume ceilings</li>
            </ul>
            <button
              disabled
              className="mt-8 w-full cursor-not-allowed rounded-lg border border-neutral-700 py-3 font-semibold text-neutral-400"
            >
              {stripeEnabled === null
                ? 'Checking availability...'
                : stripeEnabled
                  ? 'Contact sales'
                  : 'Coming soon'}
            </button>
            <p className="mt-3 text-center text-xs text-neutral-500">
              {stripeEnabled === false
                ? 'Billing is not configured (checkout returns 503).'
                : 'Reach out to enable a Pro plan for your account.'}
            </p>
          </div>
        </div>

        <p className="mt-12 text-sm text-neutral-500">
          <Link href="/" className="text-orange-400 hover:text-orange-300">&larr; Back home</Link>
        </p>
      </section>
    </main>
  )
}
