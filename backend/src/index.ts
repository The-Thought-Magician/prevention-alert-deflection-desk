import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  customers,
  orders,
  reason_codes,
  feed_connections,
  thresholds,
  rule_sets,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspacesRoutes from './routes/workspaces.js'
import ordersRoutes from './routes/orders.js'
import customersRoutes from './routes/customers.js'
import alertsRoutes from './routes/alerts.js'
import decisionsRoutes from './routes/decisions.js'
import refundsRoutes from './routes/refunds.js'
import rulesRoutes from './routes/rules.js'
import automationRoutes from './routes/automation.js'
import reasonCodesRoutes from './routes/reasonCodes.js'
import feedsRoutes from './routes/feeds.js'
import ratioRoutes from './routes/ratio.js'
import thresholdsRoutes from './routes/thresholds.js'
import deadlinesRoutes from './routes/deadlines.js'
import notificationsRoutes from './routes/notifications.js'
import auditRoutes from './routes/audit.js'
import analyticsRoutes from './routes/analytics.js'
import roiRoutes from './routes/roi.js'
import reportsRoutes from './routes/reports.js'
import savedViewsRoutes from './routes/savedViews.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://prevention-alert-deflection-desk.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/orders', ordersRoutes)
api.route('/customers', customersRoutes)
api.route('/alerts', alertsRoutes)
api.route('/decisions', decisionsRoutes)
api.route('/refunds', refundsRoutes)
api.route('/rules', rulesRoutes)
api.route('/automation', automationRoutes)
api.route('/reason-codes', reasonCodesRoutes)
api.route('/feeds', feedsRoutes)
api.route('/ratio', ratioRoutes)
api.route('/thresholds', thresholdsRoutes)
api.route('/deadlines', deadlinesRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/audit', auditRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/roi', roiRoutes)
api.route('/reports', reportsRoutes)
api.route('/saved-views', savedViewsRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ── Idempotent seeding (count-then-insert). Safe to run on every boot. ──────
async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db
      .insert(plans)
      .values([
        { id: 'free', name: 'Free', price_cents: 0 },
        { id: 'pro', name: 'Pro', price_cents: 4900 },
      ])
      .onConflictDoNothing()
    console.log('Seeded plans')
  }

  // Demo workspace + supporting reference rows
  const DEMO_WS_ID = 'demo-workspace'
  const DEMO_USER = 'demo-user'
  const existingWs = await db.select().from(workspaces).where(eq(workspaces.id, DEMO_WS_ID)).limit(1)
  if (existingWs.length === 0) {
    await db
      .insert(workspaces)
      .values({
        id: DEMO_WS_ID,
        name: 'Demo Workspace',
        invite_code: 'DEMO-0001',
        default_currency: 'USD',
        created_by: DEMO_USER,
      })
      .onConflictDoNothing()

    await db
      .insert(workspace_members)
      .values({ workspace_id: DEMO_WS_ID, user_id: DEMO_USER, role: 'owner' })
      .onConflictDoNothing()

    // Default thresholds for the two monitoring programs
    await db
      .insert(thresholds)
      .values([
        {
          workspace_id: DEMO_WS_ID,
          program: 'VDMP',
          network: 'visa',
          standard_ratio: 0.009,
          excessive_ratio: 0.018,
          standard_count: 100,
          fine_per_dispute_cents: 1000,
          sla_window_hours: 72,
        },
        {
          workspace_id: DEMO_WS_ID,
          program: 'ECP',
          network: 'mastercard',
          standard_ratio: 0.015,
          excessive_ratio: 0.03,
          standard_count: 100,
          fine_per_dispute_cents: 5000,
          sla_window_hours: 72,
        },
      ])
      .onConflictDoNothing()

    // Default feed connections for the three networks
    await db
      .insert(feed_connections)
      .values([
        {
          workspace_id: DEMO_WS_ID,
          network: 'ethoca',
          display_name: 'Ethoca Alerts',
          is_sample_mode: true,
          status: 'disconnected',
          created_by: DEMO_USER,
        },
        {
          workspace_id: DEMO_WS_ID,
          network: 'verifi_cdrn',
          display_name: 'Verifi CDRN',
          is_sample_mode: true,
          status: 'disconnected',
          created_by: DEMO_USER,
        },
        {
          workspace_id: DEMO_WS_ID,
          network: 'visa_rdr',
          display_name: 'Visa RDR',
          is_sample_mode: true,
          status: 'disconnected',
          created_by: DEMO_USER,
        },
      ])
      .onConflictDoNothing()

    // Starter reason codes
    await db
      .insert(reason_codes)
      .values([
        {
          workspace_id: DEMO_WS_ID,
          network: 'visa_rdr',
          code: '10.4',
          description: 'Other Fraud - Card Absent Environment',
          category: 'fraud',
          typical_deflectability: 0.85,
          recommended_handling: 'REFUND_DEFLECT',
        },
        {
          workspace_id: DEMO_WS_ID,
          network: 'visa_rdr',
          code: '13.1',
          description: 'Merchandise/Services Not Received',
          category: 'product_not_received',
          typical_deflectability: 0.6,
          recommended_handling: 'REVIEW',
        },
        {
          workspace_id: DEMO_WS_ID,
          network: 'ethoca',
          code: 'CB',
          description: 'Confirmed Fraud',
          category: 'fraud',
          typical_deflectability: 0.9,
          recommended_handling: 'REFUND_DEFLECT',
        },
      ])
      .onConflictDoNothing()

    // Default active rule set
    await db
      .insert(rule_sets)
      .values({
        workspace_id: DEMO_WS_ID,
        name: 'Default Deflection Policy',
        version: 1,
        is_active: true,
        weights: { amount: 0.3, reason_category: 0.4, customer_risk: 0.2, recoverable: 0.1 },
        thresholds: { deflect: 0.6, represent: 0.3 },
        auto_deflect_eligible: { max_amount_cents: 5000, categories: ['fraud'] },
        created_by: DEMO_USER,
      })
      .onConflictDoNothing()

    // A demo customer + order so the dashboard is not empty
    const [demoCustomer] = await db
      .insert(customers)
      .values({
        workspace_id: DEMO_WS_ID,
        external_ref: 'CUST-DEMO-1',
        email: 'demo.customer@example.com',
        name: 'Demo Customer',
        created_by: DEMO_USER,
      })
      .onConflictDoNothing()
      .returning()

    await db
      .insert(orders)
      .values({
        workspace_id: DEMO_WS_ID,
        customer_id: demoCustomer?.id ?? null,
        external_order_id: 'ORD-DEMO-1',
        arn: '74500000000000000000001',
        card_last4: '4242',
        amount_cents: 4999,
        currency: 'USD',
        margin_cents: 1500,
        product: 'Demo Subscription',
        refundable: true,
        created_by: DEMO_USER,
      })
      .onConflictDoNothing()

    console.log('Seeded demo workspace')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent),
// each wrapped in its own try/catch so a slow/cold DB never blocks port binding.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
    console.log('Migrations applied')
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
