import Link from 'next/link'

const FEATURES = [
  {
    title: 'Unified Alert Triage Queue',
    body: 'Ingest Ethoca, Verifi CDRN, and Visa RDR alerts into one canonical record. Filter by network, status, amount band, deadline urgency, and reason code. Deduplicate the same transaction arriving on multiple feeds.',
  },
  {
    title: 'Deterministic Decision Engine',
    body: 'A per-alert, explainable score weighs amount, margin, recoverability, customer history, and projected ratio impact to recommend REFUND_DEFLECT, REPRESENT, or REVIEW. Override with a recorded reason.',
  },
  {
    title: 'Deflection Deadline Timer',
    body: 'Every alert gets a deadline from its network SLA window. Urgency banding and breach warnings stop a deflectable alert from silently lapsing into a chargeback.',
  },
  {
    title: 'Chargeback-Ratio Guardrail',
    body: 'Track the live dispute ratio per network against Visa VDMP and Mastercard ECP thresholds, project the end-of-period ratio under your decision mix, and get breach alerting before the penalty cliff.',
  },
  {
    title: 'Double-Refund-Prevention Ledger',
    body: 'Every alert links to its underlying order. The refund ledger blocks paying twice and reconciles alerts against orders against refunds.',
  },
  {
    title: 'ROI & Savings Dashboard',
    body: 'Quantify chargebacks avoided, fines averted by monitoring-program tier, reserve exposure reduced, and net savings, with trend and per-network breakdown.',
  },
  {
    title: 'Auto-Deflection Rules',
    body: 'Auto-execute refunds for alerts matching eligibility (amount cap, reason category, clean customer) with dry-run mode and per-day safety caps.',
  },
  {
    title: 'Audit Trail & Reporting',
    body: 'An immutable log of every decision, override, refund, and rule change, plus deflection and monitoring-posture reports with CSV/JSON export for acquirer audits.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
          <span className="text-lg font-black text-orange-400">PreventionAlertDeflectionDesk</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
          Pre-dispute alert deflection, not representment
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl">
          Deflect the alert before it ever becomes a chargeback.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          A deflected pre-dispute alert never becomes a chargeback, so it never counts against the ratio the card
          networks use to levy fines, mandatory reserves, and termination. PreventionAlertDeflectionDesk unifies the
          Ethoca, Verifi CDRN, and Visa RDR feeds, decides refund-vs-represent under the deadline, and keeps you off
          the VDMP and ECP penalty cliff.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold text-white">The penalty cliff is time-boxed and severe</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <div className="text-sm font-semibold text-orange-300">Winning a representment still hurts</div>
              <p className="mt-2 text-sm text-slate-400">
                Even a won dispute counts the chargeback against your ratio for a period. Deflection on the alert layer
                prevents the ratio hit entirely.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-orange-300">The window is 24-72 hours</div>
              <p className="mt-2 text-sm text-slate-400">
                Alerts arrive across three feeds in three formats. A manual analyst cannot reliably weigh amount vs
                margin vs recoverability vs ratio impact under deadline pressure.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-orange-300">Three failure modes</div>
              <p className="mt-2 text-sm text-slate-400">
                Missed deflections that lapse to chargebacks, wasted refunds on low-risk transactions, and double
                refunds on orders already refunded.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">Everything you need to run the deflection desk</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-3xl font-black text-white">Stop chargebacks before they exist.</h2>
          <p className="mt-4 text-slate-400">
            Free for all signed-in users. Seed sample data and run a full deflection desk in minutes.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500">
              Create your account
            </Link>
            <Link href="/pricing" className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>PreventionAlertDeflectionDesk &middot; Pre-dispute alert deflection for payments risk teams</p>
      </footer>
    </main>
  )
}
