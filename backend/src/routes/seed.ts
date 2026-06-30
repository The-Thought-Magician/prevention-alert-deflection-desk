import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  customers,
  orders,
  alerts,
  reason_codes,
  rule_sets,
  thresholds,
  feed_connections,
  decisions,
  refunds,
  refund_ledger_links,
  savings_records,
  ratio_snapshots,
  notifications,
  audit_events,
  reports,
  saved_views,
  auto_deflect_rules,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const bodySchema = z.object({
  workspace_id: z.string().min(1),
})

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const NETWORKS = ['ethoca', 'verifi_cdrn', 'visa_rdr'] as const

// Reason-code catalog (per-network) used for both reason_codes rows and alert generation.
const REASON_CATALOG: Array<{
  network: (typeof NETWORKS)[number]
  code: string
  description: string
  category: string
  typical_deflectability: number
  recommended_handling: string
}> = [
  { network: 'ethoca', code: 'CB', description: 'Confirmed fraud (issuer)', category: 'fraud', typical_deflectability: 0.92, recommended_handling: 'Refund/deflect immediately' },
  { network: 'ethoca', code: 'DA', description: 'Dispute advice — cardholder dispute', category: 'friendly_fraud', typical_deflectability: 0.78, recommended_handling: 'Refund if low value' },
  { network: 'ethoca', code: 'SUB', description: 'Unrecognized subscription charge', category: 'subscription', typical_deflectability: 0.85, recommended_handling: 'Cancel + refund' },
  { network: 'verifi_cdrn', code: '10.4', description: 'Fraud — card-absent environment', category: 'fraud', typical_deflectability: 0.9, recommended_handling: 'Deflect' },
  { network: 'verifi_cdrn', code: '13.1', description: 'Merchandise/services not received', category: 'product_not_received', typical_deflectability: 0.6, recommended_handling: 'Review fulfillment' },
  { network: 'verifi_cdrn', code: '13.7', description: 'Cancelled merchandise/services', category: 'subscription', typical_deflectability: 0.7, recommended_handling: 'Refund if cancelled' },
  { network: 'visa_rdr', code: '10.4', description: 'Other fraud — card-absent', category: 'fraud', typical_deflectability: 0.95, recommended_handling: 'Auto-deflect eligible' },
  { network: 'visa_rdr', code: '12.6.1', description: 'Duplicate processing', category: 'processing_error', typical_deflectability: 0.5, recommended_handling: 'Verify duplicate then refund' },
  { network: 'visa_rdr', code: '13.2', description: 'Cancelled recurring transaction', category: 'subscription', typical_deflectability: 0.82, recommended_handling: 'Cancel recurring + refund' },
]

const ALERT_TYPE_BY_NETWORK: Record<(typeof NETWORKS)[number], string> = {
  ethoca: 'fraud_alert',
  verifi_cdrn: 'dispute',
  visa_rdr: 'rdr',
}

// Deterministic pseudo-random so seeds are reproducible per run index.
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]
}

router.post('/sample', authMiddleware, zValidator('json', bodySchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const now = Date.now()
  const counts = {
    customers: 0,
    orders: 0,
    alerts: 0,
    reason_codes: 0,
    rule_sets: 0,
    thresholds: 0,
    feeds: 0,
    ratio_snapshots: 0,
  }

  // ── Reason codes (upsert per workspace/network/code) ──────────────────
  for (const rc of REASON_CATALOG) {
    await db
      .insert(reason_codes)
      .values({
        workspace_id,
        network: rc.network,
        code: rc.code,
        description: rc.description,
        category: rc.category,
        typical_deflectability: rc.typical_deflectability,
        recommended_handling: rc.recommended_handling,
      })
      .onConflictDoNothing({ target: [reason_codes.workspace_id, reason_codes.network, reason_codes.code] })
    counts.reason_codes++
  }

  // ── Thresholds: VDMP (Visa) + ECP (Mastercard) per program ────────────
  const thresholdRows = [
    { program: 'VDMP', network: 'visa', standard_ratio: 0.009, excessive_ratio: 0.018, standard_count: 100, fine_per_dispute_cents: 1000, sla_window_hours: 72 },
    { program: 'ECP', network: 'mastercard', standard_ratio: 0.015, excessive_ratio: 0.03, standard_count: 100, fine_per_dispute_cents: 5000, sla_window_hours: 72 },
  ]
  for (const t of thresholdRows) {
    await db
      .insert(thresholds)
      .values({ workspace_id, ...t })
      .onConflictDoNothing({ target: [thresholds.workspace_id, thresholds.program, thresholds.network] })
    counts.thresholds++
  }

  // ── Feeds: one connection per network ─────────────────────────────────
  for (const network of NETWORKS) {
    const displayName =
      network === 'ethoca' ? 'Ethoca Alerts' : network === 'verifi_cdrn' ? 'Verifi CDRN' : 'Visa RDR'
    await db
      .insert(feed_connections)
      .values({
        workspace_id,
        network,
        display_name: displayName,
        endpoint: `https://sample.local/${network}`,
        is_enabled: true,
        is_sample_mode: true,
        status: 'connected',
        last_sync_at: new Date(now),
        alert_volume: 0,
        config: { mode: 'sample' },
        created_by: userId,
      })
      .onConflictDoNothing({ target: [feed_connections.workspace_id, feed_connections.network] })
    counts.feeds++
  }

  // ── Default rule set (deactivate any existing active ones first) ──────
  await db
    .update(rule_sets)
    .set({ is_active: false })
    .where(and(eq(rule_sets.workspace_id, workspace_id), eq(rule_sets.is_active, true)))
  const [ruleSet] = await db
    .insert(rule_sets)
    .values({
      workspace_id,
      name: 'Default Deflection Policy',
      version: 1,
      is_active: true,
      weights: {
        amount: 0.25,
        margin: 0.2,
        recoverable: 0.15,
        customer_risk: 0.2,
        deflectability: 0.2,
      },
      thresholds: { deflect_at: 0.6, review_at: 0.4 },
      auto_deflect_eligible: {
        categories: ['fraud', 'friendly_fraud', 'subscription'],
        max_amount_cents: 15000,
      },
      created_by: userId,
    })
    .returning()
  counts.rule_sets++

  // ── Customers ─────────────────────────────────────────────────────────
  const customerSpecs = [
    { external_ref: 'CUST-1001', email: 'alex@example.com', name: 'Alex Rivera', is_watchlisted: false, risk_score: 0.1 },
    { external_ref: 'CUST-1002', email: 'jordan@example.com', name: 'Jordan Lee', is_watchlisted: false, risk_score: 0.25 },
    { external_ref: 'CUST-1003', email: 'sam@example.com', name: 'Sam Patel', is_watchlisted: true, risk_score: 0.82 },
    { external_ref: 'CUST-1004', email: 'morgan@example.com', name: 'Morgan Diaz', is_watchlisted: false, risk_score: 0.4 },
    { external_ref: 'CUST-1005', email: 'casey@example.com', name: 'Casey Kim', is_watchlisted: true, risk_score: 0.71 },
  ]
  const customerIds: string[] = []
  for (const spec of customerSpecs) {
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.workspace_id, workspace_id), eq(customers.external_ref, spec.external_ref)))
    if (existing) {
      customerIds.push(existing.id)
      continue
    }
    const [cust] = await db
      .insert(customers)
      .values({
        workspace_id,
        external_ref: spec.external_ref,
        email: spec.email,
        name: spec.name,
        is_watchlisted: spec.is_watchlisted,
        risk_score: spec.risk_score,
        notes: spec.is_watchlisted ? 'Flagged for repeat disputes.' : null,
        created_by: userId,
      })
      .returning()
    customerIds.push(cust.id)
    counts.customers++
  }

  // ── Orders ────────────────────────────────────────────────────────────
  const products = ['Pro Subscription', 'Annual Plan', 'Hardware Kit', 'Add-on Pack', 'Premium Support']
  const orderIds: string[] = []
  const orderArns: string[] = []
  const orderLast4: string[] = []
  for (let i = 0; i < 12; i++) {
    const externalOrderId = `ORD-${5000 + i}`
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspace_id, workspace_id), eq(orders.external_order_id, externalOrderId)))
    if (existing) {
      orderIds.push(existing.id)
      orderArns.push(existing.arn ?? '')
      orderLast4.push(existing.card_last4 ?? '')
      continue
    }
    const amount = 1999 + i * 1100
    const arn = `74${String(1000000000000 + i * 137).padStart(13, '0')}`
    const last4 = String(4000 + (i * 7) % 9999).slice(-4).padStart(4, '0')
    const [ord] = await db
      .insert(orders)
      .values({
        workspace_id,
        customer_id: pick(customerIds, i),
        external_order_id: externalOrderId,
        arn,
        card_last4: last4,
        amount_cents: amount,
        currency: 'USD',
        margin_cents: Math.round(amount * 0.35),
        product: pick(products, i),
        recoverable: i % 3 === 0,
        refundable: i % 5 !== 0,
        captured_at: new Date(now - (i + 1) * 86_400_000),
        metadata: { channel: i % 2 === 0 ? 'web' : 'mobile' },
        created_by: userId,
      })
      .returning()
    orderIds.push(ord.id)
    orderArns.push(arn)
    orderLast4.push(last4)
    counts.orders++
  }

  // ── Alerts across all 3 networks ──────────────────────────────────────
  const statuses = ['new', 'triaging', 'decided', 'action_pending', 'deflected'] as const
  for (let i = 0; i < 18; i++) {
    const network = NETWORKS[i % NETWORKS.length]
    const networkCodes = REASON_CATALOG.filter((r) => r.network === network)
    const rc = networkCodes[i % networkCodes.length]
    const orderIdx = i % orderIds.length
    const receivedAt = new Date(now - (18 - i) * 3_600_000)
    const deadlineAt = new Date(receivedAt.getTime() + 72 * 3_600_000)
    const orderAmount = 1999 + orderIdx * 1100
    await db.insert(alerts).values({
      workspace_id,
      order_id: orderIds[orderIdx],
      customer_id: pick(customerIds, orderIdx),
      network,
      alert_type: ALERT_TYPE_BY_NETWORK[network],
      external_alert_id: `${network.toUpperCase()}-ALERT-${7000 + i}`,
      arn: orderArns[orderIdx],
      card_last4: orderLast4[orderIdx],
      amount_cents: orderAmount,
      currency: 'USD',
      reason_code: rc.code,
      reason_category: rc.category,
      status: pick([...statuses], i),
      received_at: receivedAt,
      deadline_at: deadlineAt,
      is_duplicate: false,
      raw_payload: { source: 'sample', network },
      created_by: userId,
    })
    counts.alerts++
  }

  // ── Ratio snapshots (last 3 periods, overall) ─────────────────────────
  for (let m = 0; m < 3; m++) {
    const d = new Date(now - m * 30 * 86_400_000)
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const txCount = 9000 + m * 500
    const cbCount = 60 + m * 8
    await db.insert(ratio_snapshots).values({
      workspace_id,
      network: 'all',
      period,
      transaction_count: txCount,
      chargeback_count: cbCount,
      ratio: cbCount / txCount,
    })
    counts.ratio_snapshots++
  }

  await db.insert(audit_events).values({
    workspace_id,
    actor: userId,
    action: 'seed.sample',
    entity_type: 'workspace',
    entity_id: workspace_id,
    detail: { ...counts },
  })

  return c.json({ seeded: counts })
})

router.post('/reset', authMiddleware, zValidator('json', bodySchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const cleared: Record<string, number> = {}

  // Delete in FK-safe order: dependents before parents.
  const del = async (label: string, table: any, col: any) => {
    const rows = (await db.delete(table).where(eq(col, workspace_id)).returning()) as unknown[]
    cleared[label] = rows.length
  }

  await del('refund_ledger_links', refund_ledger_links, refund_ledger_links.workspace_id)
  await del('savings_records', savings_records, savings_records.workspace_id)
  await del('refunds', refunds, refunds.workspace_id)
  await del('decisions', decisions, decisions.workspace_id)
  await del('alerts', alerts, alerts.workspace_id)
  await del('orders', orders, orders.workspace_id)
  await del('customers', customers, customers.workspace_id)
  await del('reason_codes', reason_codes, reason_codes.workspace_id)
  await del('auto_deflect_rules', auto_deflect_rules, auto_deflect_rules.workspace_id)
  await del('rule_sets', rule_sets, rule_sets.workspace_id)
  await del('thresholds', thresholds, thresholds.workspace_id)
  await del('feed_connections', feed_connections, feed_connections.workspace_id)
  await del('ratio_snapshots', ratio_snapshots, ratio_snapshots.workspace_id)
  await del('notifications', notifications, notifications.workspace_id)
  await del('reports', reports, reports.workspace_id)
  await del('saved_views', saved_views, saved_views.workspace_id)

  await db.insert(audit_events).values({
    workspace_id,
    actor: userId,
    action: 'seed.reset',
    entity_type: 'workspace',
    entity_id: workspace_id,
    detail: { ...cleared },
  })

  return c.json({ cleared })
})

export default router
