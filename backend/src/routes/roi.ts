import { Hono } from 'hono'
import { db } from '../db/index.js'
import { savings_records, alerts } from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

function monthKey(d: Date | string | null): string {
  if (!d) return 'unknown'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return 'unknown'
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

// ── GET /summary ─ chargebacks avoided, fines averted, exposure, net savings ─
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const records = await db
    .select()
    .from(savings_records)
    .where(eq(savings_records.workspace_id, workspaceId))

  let refundPaidCents = 0
  let chargebackCostAvoidedCents = 0
  let fineAvertedCents = 0
  let netSavingsCents = 0
  for (const r of records) {
    refundPaidCents += r.refund_paid_cents ?? 0
    chargebackCostAvoidedCents += r.chargeback_cost_avoided_cents ?? 0
    fineAvertedCents += r.fine_averted_cents ?? 0
    netSavingsCents += r.net_savings_cents ?? 0
  }

  // Reserve exposure reduced is the chargeback cost avoided (disputes that
  // would otherwise count against reserve/ratio) plus fines averted.
  const reserveExposureReducedCents = chargebackCostAvoidedCents + fineAvertedCents

  return c.json({
    summary: {
      chargebacksAvoided: records.length,
      chargebackCostAvoidedCents,
      finesAvertedCents: fineAvertedCents,
      reserveExposureReducedCents,
      refundPaidCents,
      netSavingsCents,
    },
  })
})

// ── GET /records ─ savings records list ──────────────────────────────────────
router.get('/records', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const records = await db
    .select()
    .from(savings_records)
    .where(eq(savings_records.workspace_id, workspaceId))
    .orderBy(desc(savings_records.created_at))

  return c.json(records)
})

// ── GET /trend ─ net savings trend over time, per network ────────────────────
router.get('/trend', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const records = await db
    .select()
    .from(savings_records)
    .where(eq(savings_records.workspace_id, workspaceId))

  // Aggregate net savings per period (month) and per network.
  const byPeriod: Record<
    string,
    { netSavingsCents: number; chargebackCostAvoidedCents: number; finesAvertedCents: number; count: number }
  > = {}
  const byNetwork: Record<
    string,
    { netSavingsCents: number; chargebackCostAvoidedCents: number; finesAvertedCents: number; count: number }
  > = {}

  for (const r of records) {
    const period = monthKey(r.created_at)
    const network = r.network ?? 'unknown'
    if (!byPeriod[period]) {
      byPeriod[period] = { netSavingsCents: 0, chargebackCostAvoidedCents: 0, finesAvertedCents: 0, count: 0 }
    }
    if (!byNetwork[network]) {
      byNetwork[network] = { netSavingsCents: 0, chargebackCostAvoidedCents: 0, finesAvertedCents: 0, count: 0 }
    }
    byPeriod[period].netSavingsCents += r.net_savings_cents ?? 0
    byPeriod[period].chargebackCostAvoidedCents += r.chargeback_cost_avoided_cents ?? 0
    byPeriod[period].finesAvertedCents += r.fine_averted_cents ?? 0
    byPeriod[period].count++
    byNetwork[network].netSavingsCents += r.net_savings_cents ?? 0
    byNetwork[network].chargebackCostAvoidedCents += r.chargeback_cost_avoided_cents ?? 0
    byNetwork[network].finesAvertedCents += r.fine_averted_cents ?? 0
    byNetwork[network].count++
  }

  const trend = Object.entries(byPeriod)
    .map(([period, v]) => ({ period, ...v }))
    .sort((a, b) => a.period.localeCompare(b.period))

  const networkTrend = Object.entries(byNetwork)
    .map(([network, v]) => ({ network, ...v }))
    .sort((a, b) => b.netSavingsCents - a.netSavingsCents)

  return c.json({ trend, byNetwork: networkTrend })
})

export default router
