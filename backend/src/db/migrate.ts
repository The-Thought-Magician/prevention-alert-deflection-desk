import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    invite_code text NOT NULL UNIQUE,
    default_currency text NOT NULL DEFAULT 'USD',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS customers (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    external_ref text NOT NULL,
    email text,
    name text,
    is_watchlisted boolean NOT NULL DEFAULT false,
    risk_score real DEFAULT 0,
    notes text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, external_ref)
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    customer_id text REFERENCES customers(id),
    external_order_id text NOT NULL,
    arn text,
    card_last4 text,
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    margin_cents integer DEFAULT 0,
    product text,
    recoverable boolean NOT NULL DEFAULT false,
    refundable boolean NOT NULL DEFAULT true,
    captured_at timestamptz,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, external_order_id)
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    order_id text REFERENCES orders(id),
    customer_id text REFERENCES customers(id),
    network text NOT NULL,
    alert_type text NOT NULL,
    external_alert_id text,
    arn text,
    card_last4 text,
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    reason_code text,
    reason_category text,
    status text NOT NULL DEFAULT 'new',
    received_at timestamptz NOT NULL DEFAULT now(),
    deadline_at timestamptz,
    is_duplicate boolean NOT NULL DEFAULT false,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rule_sets (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT false,
    weights jsonb DEFAULT '{}'::jsonb,
    thresholds jsonb DEFAULT '{}'::jsonb,
    auto_deflect_eligible jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS decisions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    alert_id text NOT NULL REFERENCES alerts(id),
    rule_set_id text REFERENCES rule_sets(id),
    recommendation text NOT NULL,
    score real DEFAULT 0,
    factors jsonb DEFAULT '[]'::jsonb,
    is_override boolean NOT NULL DEFAULT false,
    override_reason text,
    decided_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS refunds (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    alert_id text REFERENCES alerts(id),
    order_id text REFERENCES orders(id),
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    method text NOT NULL DEFAULT 'manual',
    source text NOT NULL DEFAULT 'deflection',
    executed_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS refund_ledger_links (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    refund_id text NOT NULL REFERENCES refunds(id),
    order_id text NOT NULL REFERENCES orders(id),
    alert_id text REFERENCES alerts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (refund_id, order_id)
  )`,

  `CREATE TABLE IF NOT EXISTS auto_deflect_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    max_amount_cents integer NOT NULL DEFAULT 0,
    reason_categories jsonb DEFAULT '[]'::jsonb,
    require_clean_customer boolean NOT NULL DEFAULT true,
    max_per_day integer DEFAULT 0,
    is_dry_run boolean NOT NULL DEFAULT true,
    is_enabled boolean NOT NULL DEFAULT false,
    execution_count integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reason_codes (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    network text NOT NULL,
    code text NOT NULL,
    description text,
    category text,
    typical_deflectability real DEFAULT 0,
    recommended_handling text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, network, code)
  )`,

  `CREATE TABLE IF NOT EXISTS feed_connections (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    network text NOT NULL,
    display_name text NOT NULL,
    endpoint text,
    is_enabled boolean NOT NULL DEFAULT false,
    is_sample_mode boolean NOT NULL DEFAULT true,
    status text NOT NULL DEFAULT 'disconnected',
    last_sync_at timestamptz,
    alert_volume integer NOT NULL DEFAULT 0,
    config jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, network)
  )`,

  `CREATE TABLE IF NOT EXISTS ratio_snapshots (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    network text NOT NULL DEFAULT 'all',
    period text NOT NULL,
    transaction_count integer NOT NULL DEFAULT 0,
    chargeback_count integer NOT NULL DEFAULT 0,
    ratio real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS thresholds (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    program text NOT NULL,
    network text NOT NULL,
    standard_ratio real NOT NULL,
    excessive_ratio real NOT NULL,
    standard_count integer DEFAULT 0,
    fine_per_dispute_cents integer DEFAULT 0,
    sla_window_hours integer DEFAULT 72,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, program, network)
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    entity_type text,
    entity_id text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    actor text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS saved_views (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS savings_records (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    alert_id text REFERENCES alerts(id),
    refund_paid_cents integer NOT NULL DEFAULT 0,
    chargeback_cost_avoided_cents integer NOT NULL DEFAULT 0,
    fine_averted_cents integer NOT NULL DEFAULT 0,
    net_savings_cents integer NOT NULL DEFAULT 0,
    network text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    kind text NOT NULL,
    title text NOT NULL,
    period_start timestamptz,
    period_end timestamptz,
    data jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_workspace ON customers(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_arn ON orders(arn)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_order ON alerts(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_customer ON alerts(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_deadline ON alerts(deadline_at)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON decisions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_alert ON decisions(alert_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_workspace ON refunds(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_alert ON refunds(alert_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refund_links_workspace ON refund_ledger_links(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rule_sets_workspace ON rule_sets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auto_deflect_workspace ON auto_deflect_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reason_codes_workspace ON reason_codes(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feed_connections_workspace ON feed_connections(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ratio_snapshots_workspace ON ratio_snapshots(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_thresholds_workspace ON thresholds(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_workspace ON saved_views(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_records_workspace ON savings_records(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete')
}
