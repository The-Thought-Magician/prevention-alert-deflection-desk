import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ── Workspaces & membership ─────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  invite_code: text('invite_code').notNull().unique(),
  default_currency: text('default_currency').notNull().default('USD'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  joined_at: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ── Customers & orders ──────────────────────────────────────────────────

export const customers = pgTable('customers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  external_ref: text('external_ref').notNull(),
  email: text('email'),
  name: text('name'),
  is_watchlisted: boolean('is_watchlisted').default(false).notNull(),
  risk_score: real('risk_score').default(0),
  notes: text('notes'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.external_ref)])

export const orders = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  customer_id: text('customer_id').references(() => customers.id),
  external_order_id: text('external_order_id').notNull(),
  arn: text('arn'),
  card_last4: text('card_last4'),
  amount_cents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  margin_cents: integer('margin_cents').default(0),
  product: text('product'),
  recoverable: boolean('recoverable').default(false).notNull(),
  refundable: boolean('refundable').default(true).notNull(),
  captured_at: timestamp('captured_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.external_order_id)])

// ── Alerts ──────────────────────────────────────────────────────────────

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  order_id: text('order_id').references(() => orders.id),
  customer_id: text('customer_id').references(() => customers.id),
  network: text('network').notNull(), // ethoca | verifi_cdrn | visa_rdr
  alert_type: text('alert_type').notNull(),
  external_alert_id: text('external_alert_id'),
  arn: text('arn'),
  card_last4: text('card_last4'),
  amount_cents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  reason_code: text('reason_code'),
  reason_category: text('reason_category'),
  status: text('status').notNull().default('new'), // new|triaging|decided|action_pending|deflected|represented|lapsed_to_chargeback
  received_at: timestamp('received_at').defaultNow().notNull(),
  deadline_at: timestamp('deadline_at'),
  is_duplicate: boolean('is_duplicate').default(false).notNull(),
  raw_payload: jsonb('raw_payload').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Decisions ───────────────────────────────────────────────────────────

export const decisions = pgTable('decisions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  alert_id: text('alert_id').notNull().references(() => alerts.id),
  rule_set_id: text('rule_set_id').references(() => rule_sets.id),
  recommendation: text('recommendation').notNull(), // REFUND_DEFLECT|REPRESENT|REVIEW
  score: real('score').default(0),
  factors: jsonb('factors').$type<Array<{ name: string; value: number; weight: number; contribution: number }>>().default([]),
  is_override: boolean('is_override').default(false).notNull(),
  override_reason: text('override_reason'),
  decided_by: text('decided_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Refunds & ledger links ──────────────────────────────────────────────

export const refunds = pgTable('refunds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  alert_id: text('alert_id').references(() => alerts.id),
  order_id: text('order_id').references(() => orders.id),
  amount_cents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  method: text('method').notNull().default('manual'), // manual|deflection|auto_deflection
  source: text('source').notNull().default('deflection'),
  executed_by: text('executed_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const refund_ledger_links = pgTable('refund_ledger_links', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  refund_id: text('refund_id').notNull().references(() => refunds.id),
  order_id: text('order_id').notNull().references(() => orders.id),
  alert_id: text('alert_id').references(() => alerts.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.refund_id, t.order_id)])

// ── Rule sets & automation ──────────────────────────────────────────────

export const rule_sets = pgTable('rule_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  is_active: boolean('is_active').default(false).notNull(),
  weights: jsonb('weights').$type<Record<string, number>>().default({}),
  thresholds: jsonb('thresholds').$type<Record<string, number>>().default({}),
  auto_deflect_eligible: jsonb('auto_deflect_eligible').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const auto_deflect_rules = pgTable('auto_deflect_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  max_amount_cents: integer('max_amount_cents').notNull().default(0),
  reason_categories: jsonb('reason_categories').$type<string[]>().default([]),
  require_clean_customer: boolean('require_clean_customer').default(true).notNull(),
  max_per_day: integer('max_per_day').default(0),
  is_dry_run: boolean('is_dry_run').default(true).notNull(),
  is_enabled: boolean('is_enabled').default(false).notNull(),
  execution_count: integer('execution_count').default(0).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Reason codes ────────────────────────────────────────────────────────

export const reason_codes = pgTable('reason_codes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  network: text('network').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  category: text('category'), // fraud|product_not_received|subscription|friendly_fraud|processing_error
  typical_deflectability: real('typical_deflectability').default(0),
  recommended_handling: text('recommended_handling'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.network, t.code)])

// ── Feed connections ────────────────────────────────────────────────────

export const feed_connections = pgTable('feed_connections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  network: text('network').notNull(), // ethoca | verifi_cdrn | visa_rdr
  display_name: text('display_name').notNull(),
  endpoint: text('endpoint'),
  is_enabled: boolean('is_enabled').default(false).notNull(),
  is_sample_mode: boolean('is_sample_mode').default(true).notNull(),
  status: text('status').notNull().default('disconnected'),
  last_sync_at: timestamp('last_sync_at'),
  alert_volume: integer('alert_volume').default(0).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.network)])

// ── Ratio guardrail ─────────────────────────────────────────────────────

export const ratio_snapshots = pgTable('ratio_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  network: text('network').notNull().default('all'),
  period: text('period').notNull(), // e.g. 2026-06
  transaction_count: integer('transaction_count').default(0).notNull(),
  chargeback_count: integer('chargeback_count').default(0).notNull(),
  ratio: real('ratio').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const thresholds = pgTable('thresholds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  program: text('program').notNull(), // VDMP | ECP
  network: text('network').notNull(),
  standard_ratio: real('standard_ratio').notNull(),
  excessive_ratio: real('excessive_ratio').notNull(),
  standard_count: integer('standard_count').default(0),
  fine_per_dispute_cents: integer('fine_per_dispute_cents').default(0),
  sla_window_hours: integer('sla_window_hours').default(72),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.program, t.network)])

// ── Notifications ───────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(), // deadline_warning|threshold_breach|high_value_alert|auto_deflection
  title: text('title').notNull(),
  body: text('body'),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Audit ───────────────────────────────────────────────────────────────

export const audit_events = pgTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Saved views ─────────────────────────────────────────────────────────

export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Savings records ─────────────────────────────────────────────────────

export const savings_records = pgTable('savings_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  alert_id: text('alert_id').references(() => alerts.id),
  refund_paid_cents: integer('refund_paid_cents').default(0).notNull(),
  chargeback_cost_avoided_cents: integer('chargeback_cost_avoided_cents').default(0).notNull(),
  fine_averted_cents: integer('fine_averted_cents').default(0).notNull(),
  net_savings_cents: integer('net_savings_cents').default(0).notNull(),
  network: text('network'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Reports ─────────────────────────────────────────────────────────────

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  kind: text('kind').notNull(), // deflection|monitoring_posture
  title: text('title').notNull(),
  period_start: timestamp('period_start'),
  period_end: timestamp('period_end'),
  data: jsonb('data').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Billing ─────────────────────────────────────────────────────────────

export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
