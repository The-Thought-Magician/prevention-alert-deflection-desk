import Link from 'next/link'

const FEATURES = [
  {
    title: 'One queue for three alert feeds',
    body: 'Ethoca, Verifi CDRN, and Visa RDR land in one canonical record. Filter by network, status, amount band, deadline urgency, reason code. Duplicate alerts on the same transaction get merged, not double-worked.',
  },
  {
    title: 'The engine decides, you can override',
    body: 'Every alert gets a score from amount, margin, recoverability, customer history, and ratio impact. Output: REFUND_DEFLECT, REPRESENT, or REVIEW. Override requires a reason. Reason gets logged.',
  },
  {
    title: 'The clock is the point',
    body: 'Every alert gets a deadline computed from its network SLA. Urgency bands and breach warnings fire before the window closes, not after.',
  },
  {
    title: 'Ratio guardrail, not a vanity dashboard',
    body: 'Live dispute ratio per network against VDMP and ECP thresholds. Projected end-of-period ratio under your current decision mix. Breach alerts before you hit the cliff.',
  },
  {
    title: 'No double refunds',
    body: 'Every alert is linked to its order. The ledger blocks a second refund on an order already refunded and reconciles alerts against orders against refunds.',
  },
  {
    title: 'ROI, in numbers',
    body: 'Chargebacks avoided. Fines averted by monitoring-program tier. Reserve exposure reduced. Trend and per-network breakdown.',
  },
  {
    title: 'Auto-deflection when the rules say yes',
    body: 'Alerts under your amount cap, in an eligible reason category, from a clean customer, get refunded automatically. Dry-run mode and per-day caps included.',
  },
  {
    title: 'Every action is logged',
    body: 'Decisions, overrides, refunds, and rule changes go into an immutable audit trail. Export as CSV or JSON when the acquirer asks.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-sm font-black text-white">PD</span>
          <span className="text-lg font-black text-orange-400">PreventionAlertDeflectionDesk</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-neutral-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-neutral-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
          Deflection, not representment
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl">
          Kill the alert before it becomes a chargeback.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-400">
          A deflected pre-dispute alert never becomes a chargeback. It never touches the ratio the networks use to
          levy fines, demand reserves, or pull your processing. We pull in Ethoca, Verifi CDRN, and Visa RDR,
          score refund-vs-represent against the deadline, and keep you off the VDMP and ECP cliff.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-neutral-700 px-6 py-3 font-semibold text-neutral-200 hover:bg-neutral-800">
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-neutral-800 bg-neutral-900/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold text-white">The penalty cliff does not wait</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <div className="text-sm font-semibold text-orange-300">Winning representment still costs you</div>
              <p className="mt-2 text-sm text-neutral-400">
                A won dispute still counts against your ratio for a period. Deflecting on the alert layer means it
                never counts at all.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-orange-300">You get 24 to 72 hours</div>
              <p className="mt-2 text-sm text-neutral-400">
                Three feeds, three formats. An analyst weighing amount vs margin vs recoverability vs ratio impact
                by hand will miss deadlines.
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-orange-300">Three ways to lose</div>
              <p className="mt-2 text-sm text-neutral-400">
                Missed deflections that lapse to chargebacks. Refunds wasted on low-risk transactions. Double
                refunds on orders already refunded.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">What the desk does</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-6">
              <h3 className="text-base font-semibold text-neutral-100">{f.title}</h3>
              <p className="mt-2 text-sm text-neutral-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-neutral-800 bg-neutral-900/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-3xl font-black text-white">Stop the chargeback before it exists.</h2>
          <p className="mt-4 text-neutral-400">
            Free for signed-in users. Seed sample data and run the full desk in minutes.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500">
              Create your account
            </Link>
            <Link href="/pricing" className="rounded-lg border border-neutral-700 px-6 py-3 font-semibold text-neutral-200 hover:bg-neutral-800">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-8 text-center text-sm text-neutral-600">
        <p>PreventionAlertDeflectionDesk &middot; Pre-dispute alert deflection for payments risk teams</p>
      </footer>
    </main>
  )
}
