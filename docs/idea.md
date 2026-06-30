# Prevention Alert Deflection Desk

## Overview

Prevention Alert Deflection Desk is a workbench for payments risk and operations teams that catches incoming pre-dispute alerts from the card networks (Visa RDR, Verifi CDRN, Ethoca) and helps the merchant decide, within the short 24-72 hour action window, whether to refund-and-deflect or to let the transaction proceed to representment. The core value is that a deflected pre-dispute alert never becomes a chargeback, so it never counts against the merchant's chargeback ratio, which is the number the card networks use to levy fines, mandatory reserves, and ultimately termination of processing.

The product unifies the three major pre-dispute alert feeds into a single triage queue, runs a deterministic refund-vs-represent decision engine over each alert, tracks the deflection deadline so nothing silently lapses into a chargeback, projects how each decision moves the live chargeback ratio against the network monitoring-program thresholds (Visa VDMP, Mastercard ECP), and prevents double refunds by linking every alert to its underlying order. An ROI dashboard quantifies chargebacks avoided, fines averted, and reserve exposure reduced.

All features are free for signed-in users. Stripe billing is wired but optional (returns 503 when unconfigured) so the same codebase can later gate a Pro tier without a rebuild.

## Problem

Merchants whose chargeback ratio sits near a network monitoring-program threshold face a survival-level penalty cliff. Once you cross into Visa's Dispute Monitoring Program (VDMP) or Mastercard's Excessive Chargeback Program (ECP), per-dispute fines escalate, the acquirer can demand a cash reserve, and persistent breach can cost the merchant its ability to process cards at all. A chargeback is the worst outcome: it costs the disputed amount plus a fee, and it counts against the ratio.

A pre-dispute alert (Ethoca / Verifi CDRN / Visa RDR) is a warning that a cardholder is about to dispute. If the merchant refunds within the alert's deflection window, the dispute is withdrawn or auto-resolved and never becomes a chargeback, so it never touches the ratio. But the window is short (often 24-72 hours), the alerts arrive across three different feeds in three different formats, and a manual analyst cannot reliably weigh amount vs margin vs recoverability vs ratio impact under deadline pressure. The result is a mix of missed deflections (alert lapses to chargeback), wasted refunds (refunding low-risk transactions that would never have been disputed), and double refunds (refunding an alert whose order was already refunded).

There is no single tool that sits on the pre-dispute alert layer, plays the chargeback-ratio threshold game explicitly, and enforces the deadline. Merchants stitch together spreadsheets, network portals, and gut feel.

## Target Users

- Payments risk and operations managers at high-volume subscription, travel, and digital-goods merchants whose chargeback ratio is near a network monitoring threshold.
- Chargeback analysts who triage alerts day to day and need a defensible, deterministic decision per alert.
- Finance and revenue-assurance leads who need to quantify avoided losses and reserve exposure.
- Fraud teams that want to feed customer-history and risk signals into the deflection decision.

The economic buyer is the payments risk/ops manager at a merchant near a monitoring threshold, where deflecting is unambiguously cheaper than losing and the penalty trigger is time-boxed and severe.

## Why this is NOT an existing project

This product operates specifically on the **pre-dispute alert layer** and the **chargeback-ratio threshold game**. Its scope is deliberately distinct from adjacent categories and from sibling ventures:

- **Representment / chargeback-fighting tools** (e.g. Chargebacks911, Midigator representment, Verifi Order Insight responders) act *after* a chargeback is already filed: they assemble compelling evidence to win the dispute. Prevention Alert Deflection Desk acts *before* the chargeback exists, on the alert, to stop it from ever being filed. Winning a representment still counts the chargeback against your ratio for a period; deflection prevents the ratio hit entirely. This is the load-bearing distinction.
- **General refund / order-management systems** refund for customer-service reasons and have no concept of network alert feeds, deflection deadlines, or ratio impact. We refund *as a deflection action tied to a specific alert* and track the ratio consequence.
- **Fraud-scoring / pre-auth decisioning** (Sift, Riskified, Signifyd) decides whether to *accept* a transaction at checkout. We act post-settlement on transactions that already cleared and are now flagged by a network alert.
- **settlement-funding-reconciler** (sibling venture) reconciles acquirer bank deposits against expected settlement; it never touches dispute alerts or ratio thresholds.
- **breach-notification-clock** (sibling venture) tracks regulatory data-breach disclosure deadlines; the only conceptual overlap is "a clock," but the domain (security/legal disclosure) is unrelated to payment disputes.
- **dispute-evidence-builder** type tools assemble representment packets; we explicitly do not build evidence packets because our whole thesis is to avoid the dispute before evidence is ever needed.

The unique surface is: multi-network pre-dispute alert intake, deterministic refund-vs-represent decisioning under a hard deadline, and live chargeback-ratio guardrails against VDMP/ECP thresholds.

## Major Features

### 1. Pre-Dispute Alert Intake & Unified Triage Queue
- Ingest alerts from Ethoca, Verifi CDRN, and Visa RDR feeds.
- Normalize three different payload formats into one canonical alert record (network, alert type, ARN, card last4, amount, currency, reason code, raw payload retained).
- Manual single-alert entry, bulk CSV upload, and a sample-data seeder for demo.
- Unified triage queue with filters by network, status, amount band, deadline urgency, and reason code.
- Deduplication of the same underlying transaction arriving on multiple feeds.
- Alert lifecycle states: new, triaging, decided, action_pending, deflected, represented, lapsed_to_chargeback.

### 2. Deterministic Refund-vs-Represent Decision Engine
- Per-alert deterministic score weighing amount, product margin, recoverability of goods/service, customer lifetime history, fraud signals, and projected ratio impact.
- Configurable, versioned decision-rule sets (thresholds, weights) per workspace.
- Explainable output: the recommended action plus the factor-by-factor contribution that produced it.
- Override capability with a required reason, recorded for audit.
- Batch evaluation across the whole queue.
- Recommendation: REFUND_DEFLECT, REPRESENT, or REVIEW.

### 3. Deflection Deadline Timer & Breach Alerts
- Per-alert deadline computed from received time + network/type SLA window.
- Countdown and urgency banding (safe, warning, critical, lapsed).
- Breach-warning notifications before a deflectable alert silently converts to a chargeback.
- Escalation rules: notify owner, then team, as deadline nears.
- A "deadline board" sorted by time remaining.

### 4. Chargeback-Ratio Guardrail
- Track live chargeback ratio (disputes / transactions) per workspace and per card network.
- Compare against configurable VDMP and ECP thresholds (standard and excessive tiers).
- Project the ratio impact of each decision: deflecting removes a potential chargeback from the numerator; representing leaves it (pending outcome).
- Forecast end-of-month ratio under current decision mix.
- Threshold-breach alerting and a historical ratio trend.

### 5. Double-Refund-Prevention Ledger
- Link every alert to its underlying order/transaction.
- Refund ledger recording every refund action with amount, method, and source (deflection vs manual).
- Block / warn when an alert's order already has a recorded refund (prevents paying twice).
- Auto-refund eligibility rules (e.g. amount under threshold + low recoverability + clean history -> auto-deflect).
- Reconciliation view of alerts vs orders vs refunds.

### 6. ROI & Savings Dashboard
- Chargebacks avoided count and dollar value.
- Estimated fines averted based on the merchant's monitoring-program tier.
- Reserve exposure reduced.
- Net savings = deflection refunds paid vs chargeback cost (amount + fee + ratio penalty) avoided.
- Trend over time and per-network breakdown.

### 7. Orders & Transactions Registry
- Store the merchant's orders/transactions (uploaded, connected, or seeded) for alert matching.
- Fields: order id, ARN, amount, currency, customer ref, product, margin, captured-at, refundable flag.
- Match alerts to orders by ARN / amount / card last4.
- Order detail showing all linked alerts and refunds.

### 8. Customer History & Risk Profile
- Aggregate per-customer order, alert, refund, and chargeback history.
- Repeat-disputer / friendly-fraud flag.
- Customer-level recommendation bias feeding the decision engine.
- Blocklist / watchlist of high-risk customer references.

### 9. Decision Rules Management
- CRUD on rule sets: weights, thresholds, auto-deflect eligibility, per-network overrides.
- Versioning with the ability to see which rule version decided a given alert.
- Simulate a rule set against historical alerts before activating.
- Activate exactly one rule set per workspace.

### 10. Reason Code Library
- Catalog of network reason codes (Visa, Mastercard, Amex) with descriptions, typical deflectability, and recommended handling.
- Per-reason-code statistics across the workspace's alerts.
- Map raw network reason codes to canonical categories (fraud, product not received, subscription, friendly fraud, processing error).

### 11. Network Feed Connections
- Configure connections for Ethoca, Verifi CDRN, Visa RDR (credentials/endpoint placeholders; sample/manual mode when unconfigured).
- Connection health, last-sync time, alert volume per feed.
- Enable/disable a feed; mark a feed as sample-mode.

### 12. Auto-Deflection Rules & Automation
- Rules that auto-execute REFUND_DEFLECT for alerts matching eligibility (amount cap, reason category, clean customer).
- Dry-run mode that records what would have auto-deflected without acting.
- Per-rule counters of auto-deflections performed.
- Safety caps (max auto-refund amount, max per day).

### 13. Refund Execution & Action Log
- Record the deflection action against an alert: refund issued, amount, method, executed-by.
- Action log per alert (state transitions, who/when/why).
- Idempotency: a deflected alert cannot be deflected twice.

### 14. Notifications & Alerting Center
- In-app notifications for deadline warnings, threshold breaches, new high-value alerts, auto-deflections.
- Per-user read/unread state.
- Notification preferences (which event types, urgency floor).

### 15. Workspaces & Team Membership
- A workspace represents a merchant/processing account.
- Invite members by code; members share alerts, orders, rules.
- Per-workspace settings (thresholds, SLA windows, currency).

### 16. Reporting & Exports
- Generate a deflection report for a date range (alerts, decisions, deflections, savings).
- Monthly monitoring-program posture report (ratio vs threshold, projection).
- CSV/JSON export of alerts, refunds, and savings.

### 17. Audit Trail
- Immutable event log of every decision, override, refund, rule change, and feed action.
- Filter by actor, entity, action type, date.
- Used for acquirer/network audits.

### 18. Analytics & Trends
- Alert volume trends by network, reason code, and disposition.
- Deflection rate, auto-deflection rate, lapse rate.
- Average decision latency and deadline-utilization.

### 19. Workspace Settings & Thresholds
- Configure VDMP/ECP threshold values, SLA windows per network/type, default currency, auto-deflect master switch.
- Fine schedule per monitoring tier (for ROI math).

### 20. Sample Data Seeder & Demo Mode
- One-click seeding of representative orders, alerts across all three networks, customers, reason codes, and a default rule set, so the product is immediately demoable.
- Reset/clear sample data.

### 21. Billing & Plan (Stripe optional)
- Free plan for all signed-in users; Pro plan defined but checkout returns 503 when Stripe is unconfigured.
- Plan view, checkout, portal, webhook endpoints.

### 22. Saved Views & Queue Filters
- Save named filter combinations on the triage queue (e.g. "Visa critical >$500").
- Quick-switch between saved views.

## Data Model (tables)

- workspaces
- workspace_members
- orders
- customers
- alerts
- decisions
- refunds
- refund_ledger_links
- rule_sets
- auto_deflect_rules
- reason_codes
- feed_connections
- ratio_snapshots
- thresholds
- notifications
- audit_events
- saved_views
- savings_records
- reports
- plans
- subscriptions

## API Surface (high level)

- Workspaces: create/list/get/update workspace, invite/join, list/manage members.
- Orders: CRUD, bulk upload, match-to-alert.
- Customers: list/get, risk profile, watchlist toggle.
- Alerts: list/get/create, bulk upload, status transition, dedupe.
- Decisions: evaluate single, batch evaluate, override, get for alert.
- Refunds: execute deflection, list, ledger links, double-refund check.
- Rule sets: CRUD, simulate, activate.
- Auto-deflect rules: CRUD, dry-run, counters.
- Reason codes: list/get, stats.
- Feed connections: CRUD, health, sync (sample).
- Ratio guardrail: current ratio, projection, snapshots, threshold compare.
- Thresholds: get/update.
- Deadlines: deadline board, breach list.
- Notifications: list, mark-read, preferences.
- Audit: list/filter.
- Analytics: trends, dispositions, latency.
- ROI/savings: summary, records, trend.
- Reports: generate, list, export.
- Saved views: CRUD.
- Billing: plan, checkout, portal, webhook.
- Seed: seed sample, reset.

## Frontend Pages (~22-26)

Public:
1. `/` Landing (static marketing).
2. `/auth/sign-in` Sign in.
3. `/auth/sign-up` Sign up.
4. `/pricing` Pricing.

Dashboard (authenticated):
5. `/dashboard` Overview: ratio gauge, deadline board snippet, ROI summary, recent alerts.
6. `/dashboard/alerts` Triage queue with filters and saved views.
7. `/dashboard/alerts/[id]` Alert detail: decision, deadline, linked order, action log.
8. `/dashboard/alerts/new` Manual alert entry + bulk upload.
9. `/dashboard/deadlines` Deadline board sorted by time remaining.
10. `/dashboard/decisions` Decision history and overrides.
11. `/dashboard/ratio` Chargeback-ratio guardrail and projections.
12. `/dashboard/refunds` Refund ledger and double-refund prevention.
13. `/dashboard/orders` Orders registry + upload.
14. `/dashboard/orders/[id]` Order detail with linked alerts/refunds.
15. `/dashboard/customers` Customer history and watchlist.
16. `/dashboard/rules` Decision rule sets (list/edit/activate/simulate).
17. `/dashboard/automation` Auto-deflection rules and dry-run.
18. `/dashboard/reason-codes` Reason code library and stats.
19. `/dashboard/feeds` Network feed connections and health.
20. `/dashboard/roi` ROI & savings dashboard.
21. `/dashboard/analytics` Analytics & trends.
22. `/dashboard/notifications` Notifications center.
23. `/dashboard/reports` Reports generation and exports.
24. `/dashboard/audit` Audit trail.
25. `/dashboard/team` Workspace & team membership.
26. `/dashboard/settings` Workspace settings, thresholds, billing/plan, sample data.
