# Prevention Alert Deflection Desk — Build Contract (AUTHORITATIVE)

This is the single source of truth. Every other agent follows it exactly. Filenames, mount paths, api method names, and page files declared here are binding. Stack and conventions per `/home/chiranjeet/projects-cc/ventures/_template-report.md`: Hono backend, child `api` router mounted at `/api/v1`, every route file `export default router`, backend trusts `X-User-Id` via `getUserId(c)`, public reads / auth-gated writes with zod + ownership checks; Next.js 16 frontend, `proxy.ts` only, `lib/api.ts` calls relative `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`; auth pages use client onSubmit + authClient; landing page purely static.

---

## (a) Tables (columns)

1. **workspaces** — id, name, invite_code(uniq), default_currency, created_by, created_at
2. **workspace_members** — id, workspace_id(fk), user_id, role, joined_at; uniq(workspace_id,user_id)
3. **customers** — id, workspace_id(fk), external_ref, email, name, is_watchlisted, risk_score, notes, created_by, created_at; uniq(workspace_id,external_ref)
4. **orders** — id, workspace_id(fk), customer_id(fk), external_order_id, arn, card_last4, amount_cents, currency, margin_cents, product, recoverable, refundable, captured_at, metadata(jsonb), created_by, created_at; uniq(workspace_id,external_order_id)
5. **alerts** — id, workspace_id(fk), order_id(fk), customer_id(fk), network, alert_type, external_alert_id, arn, card_last4, amount_cents, currency, reason_code, reason_category, status, received_at, deadline_at, is_duplicate, raw_payload(jsonb), created_by, created_at
6. **decisions** — id, workspace_id(fk), alert_id(fk), rule_set_id(fk), recommendation, score, factors(jsonb), is_override, override_reason, decided_by, created_at
7. **refunds** — id, workspace_id(fk), alert_id(fk), order_id(fk), amount_cents, currency, method, source, executed_by, created_at
8. **refund_ledger_links** — id, workspace_id(fk), refund_id(fk), order_id(fk), alert_id(fk), created_at; uniq(refund_id,order_id)
9. **rule_sets** — id, workspace_id(fk), name, version, is_active, weights(jsonb), thresholds(jsonb), auto_deflect_eligible(jsonb), created_by, created_at
10. **auto_deflect_rules** — id, workspace_id(fk), name, max_amount_cents, reason_categories(jsonb), require_clean_customer, max_per_day, is_dry_run, is_enabled, execution_count, created_by, created_at
11. **reason_codes** — id, workspace_id(fk), network, code, description, category, typical_deflectability, recommended_handling, created_at; uniq(workspace_id,network,code)
12. **feed_connections** — id, workspace_id(fk), network, display_name, endpoint, is_enabled, is_sample_mode, status, last_sync_at, alert_volume, config(jsonb), created_by, created_at; uniq(workspace_id,network)
13. **ratio_snapshots** — id, workspace_id(fk), network, period, transaction_count, chargeback_count, ratio, created_at
14. **thresholds** — id, workspace_id(fk), program, network, standard_ratio, excessive_ratio, standard_count, fine_per_dispute_cents, sla_window_hours, created_at; uniq(workspace_id,program,network)
15. **notifications** — id, workspace_id(fk), user_id, type, title, body, entity_type, entity_id, is_read, created_at
16. **audit_events** — id, workspace_id(fk), actor, action, entity_type, entity_id, detail(jsonb), created_at
17. **saved_views** — id, workspace_id(fk), user_id, name, filters(jsonb), created_at
18. **savings_records** — id, workspace_id(fk), alert_id(fk), refund_paid_cents, chargeback_cost_avoided_cents, fine_averted_cents, net_savings_cents, network, created_at
19. **reports** — id, workspace_id(fk), kind, title, period_start, period_end, data(jsonb), created_by, created_at
20. **plans** — id('free'|'pro'), name, price_cents
21. **subscriptions** — id, user_id(uniq), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

All write endpoints require auth (`X-User-Id` via `getUserId(c)`), use zod validation, and enforce workspace-membership / ownership checks. "auth? Y" = requires header; "N" = public read. Response shapes are JSON.

### `workspaces.ts` → mount `workspaces`
- `GET /` — Y — list workspaces the user is a member of — `Workspace[]`
- `POST /` — Y — create workspace (creator auto-added as owner, default thresholds+feeds seeded) — `Workspace`
- `GET /:id` — Y — get one (membership checked) — `Workspace`
- `PUT /:id` — Y — update name/currency (owner) — `Workspace`
- `POST /join` — Y — join by invite_code — `{ workspace, membership }`
- `GET /:id/members` — Y — list members — `Member[]`
- `DELETE /:id/members/:userId` — Y — remove member (owner) — `{ success }`

### `orders.ts` → mount `orders`
- `GET /` — N — list orders for workspace (query `workspace_id`) — `Order[]`
- `GET /:id` — N — order detail incl. linked alerts + refunds — `{ order, alerts, refunds }`
- `POST /` — Y — create order — `Order`
- `PUT /:id` — Y — update (ownership) — `Order`
- `DELETE /:id` — Y — delete (ownership) — `{ success }`
- `POST /bulk` — Y — bulk create from rows array — `{ created: number }`

### `customers.ts` → mount `customers`
- `GET /` — N — list customers (workspace_id) — `Customer[]`
- `GET /:id` — N — risk profile: orders, alerts, refunds, history summary — `{ customer, stats, alerts, orders }`
- `POST /` — Y — create customer — `Customer`
- `PUT /:id` — Y — update notes/risk (ownership) — `Customer`
- `POST /:id/watchlist` — Y — toggle watchlist — `Customer`

### `alerts.ts` → mount `alerts`
- `GET /` — N — list alerts (workspace_id + optional filters: network/status/urgency/reason) — `Alert[]`
- `GET /:id` — N — alert detail incl. decision, linked order, action log — `{ alert, decision, order, audit }`
- `POST /` — Y — create alert (auto match order by arn/last4, compute deadline, dedupe) — `Alert`
- `PUT /:id/status` — Y — transition status — `Alert`
- `POST /bulk` — Y — bulk upload alerts (CSV-parsed rows) — `{ created: number }`
- `POST /:id/dedupe` — Y — mark/unmark duplicate — `Alert`

### `decisions.ts` → mount `decisions`
- `GET /` — N — decision history (workspace_id) — `Decision[]`
- `GET /alert/:alertId` — N — latest decision for an alert — `Decision`
- `POST /evaluate` — Y — run deterministic engine on one alert, persist decision — `Decision`
- `POST /batch` — Y — evaluate all undecided alerts in workspace — `{ evaluated: number, decisions }`
- `POST /:id/override` — Y — override recommendation with reason — `Decision`

### `refunds.ts` → mount `refunds`
- `GET /` — N — refund ledger (workspace_id) — `Refund[]`
- `POST /` — Y — execute deflection refund (idempotent per alert; double-refund check; creates ledger link, savings_record, marks alert deflected) — `{ refund, savings }`
- `GET /check` — N — double-refund check for an order (query `order_id`) — `{ alreadyRefunded: boolean, refunds }`
- `GET /links` — N — ledger links (workspace_id) — `RefundLink[]`

### `rules.ts` → mount `rules`
- `GET /` — N — list rule sets (workspace_id) — `RuleSet[]`
- `GET /:id` — N — get rule set — `RuleSet`
- `POST /` — Y — create rule set — `RuleSet`
- `PUT /:id` — Y — update weights/thresholds (ownership) — `RuleSet`
- `POST /:id/activate` — Y — activate (deactivates others in workspace) — `RuleSet`
- `POST /:id/simulate` — Y — run rule set over historical alerts, return projected dispositions — `{ results }`
- `DELETE /:id` — Y — delete (ownership) — `{ success }`

### `automation.ts` → mount `automation`
- `GET /` — N — list auto-deflect rules (workspace_id) — `AutoRule[]`
- `POST /` — Y — create auto-deflect rule — `AutoRule`
- `PUT /:id` — Y — update (ownership) — `AutoRule`
- `POST /:id/run` — Y — run rule (dry-run records matches; live executes refunds) — `{ matched, executed, dryRun }`
- `DELETE /:id` — Y — delete — `{ success }`

### `reasonCodes.ts` → mount `reason-codes`
- `GET /` — N — list reason codes (workspace_id) — `ReasonCode[]`
- `GET /stats` — N — per-reason-code alert counts/dispositions (workspace_id) — `ReasonStat[]`
- `POST /` — Y — create reason code — `ReasonCode`
- `PUT /:id` — Y — update — `ReasonCode`

### `feeds.ts` → mount `feeds`
- `GET /` — N — list feed connections (workspace_id) — `Feed[]`
- `POST /` — Y — create/configure feed — `Feed`
- `PUT /:id` — Y — update (enable/disable, sample-mode) — `Feed`
- `POST /:id/sync` — Y — sample sync: generates sample alerts, updates last_sync/volume — `{ synced: number }`

### `ratio.ts` → mount `ratio`
- `GET /current` — N — live ratio per network + overall (workspace_id) — `{ overall, byNetwork }`
- `GET /projection` — N — projected end-of-period ratio under current decision mix — `{ projected, scenarios }`
- `GET /snapshots` — N — historical ratio snapshots (workspace_id) — `RatioSnapshot[]`
- `POST /snapshot` — Y — capture a snapshot — `RatioSnapshot`

### `thresholds.ts` → mount `thresholds`
- `GET /` — N — thresholds (workspace_id) — `Threshold[]`
- `PUT /:id` — Y — update threshold values — `Threshold`
- `POST /` — Y — create threshold — `Threshold`

### `deadlines.ts` → mount `deadlines`
- `GET /board` — N — alerts sorted by deadline, with urgency band (workspace_id) — `{ critical, warning, safe }`
- `GET /breaches` — N — alerts past/near deadline still deflectable (workspace_id) — `Alert[]`

### `notifications.ts` → mount `notifications`
- `GET /` — Y — current user's notifications (workspace_id) — `Notification[]`
- `POST /:id/read` — Y — mark read — `Notification`
- `POST /read-all` — Y — mark all read — `{ updated: number }`

### `audit.ts` → mount `audit`
- `GET /` — N — audit events filtered by actor/entity/action/date (workspace_id) — `AuditEvent[]`

### `analytics.ts` → mount `analytics`
- `GET /trends` — N — alert volume by network/reason/disposition over time (workspace_id) — `{ byNetwork, byReason, byDisposition }`
- `GET /performance` — N — deflection rate, auto-deflection rate, lapse rate, avg decision latency, deadline utilization — `{ metrics }`

### `roi.ts` → mount `roi`
- `GET /summary` — N — chargebacks avoided, $ value, fines averted, reserve exposure reduced, net savings (workspace_id) — `{ summary }`
- `GET /records` — N — savings records list (workspace_id) — `SavingsRecord[]`
- `GET /trend` — N — net savings trend over time, per network — `{ trend }`

### `reports.ts` → mount `reports`
- `GET /` — N — list generated reports (workspace_id) — `Report[]`
- `GET /:id` — N — report detail — `Report`
- `POST /generate` — Y — generate deflection or monitoring-posture report for date range — `Report`
- `GET /:id/export` — N — export report as CSV/JSON (query `format`) — file payload

### `savedViews.ts` → mount `saved-views`
- `GET /` — Y — current user's saved views (workspace_id) — `SavedView[]`
- `POST /` — Y — create saved view — `SavedView`
- `DELETE /:id` — Y — delete (ownership) — `{ success }`

### `seed.ts` → mount `seed`
- `POST /sample` — Y — seed sample orders, alerts (all 3 networks), customers, reason codes, default rule set, thresholds, feeds for a workspace — `{ seeded }`
- `POST /reset` — Y — clear workspace sample data — `{ cleared }`

### `billing.ts` → mount `billing`
- `GET /plan` — N(header optional) — current subscription + plan + `stripeEnabled` — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — N(header) — Stripe checkout; 503 if unconfigured — `{ url }` | 503
- `POST /portal` — N(header) — Stripe billing portal; 503 if unconfigured — `{ url }` | 503
- `POST /webhook` — N — Stripe webhook; 503 if unconfigured — `{ received }` | 503

Total route files: **23** (workspaces, orders, customers, alerts, decisions, refunds, rules, automation, reasonCodes, feeds, ratio, thresholds, deadlines, notifications, audit, analytics, roi, reports, savedViews, seed, billing — plus implicit `/health` in index.ts; 21 domain files + billing = exactly the list above counts 21 mounts). Mounted in `index.ts` via `api.route('/<mount>', router)`.

---

## (c) `lib/api.ts` methods (relative `/api/proxy/...` → verb)

Workspaces:
- `listWorkspaces()` GET `/api/proxy/workspaces`
- `createWorkspace(body)` POST `/api/proxy/workspaces`
- `getWorkspace(id)` GET `/api/proxy/workspaces/{id}`
- `updateWorkspace(id, body)` PUT `/api/proxy/workspaces/{id}`
- `joinWorkspace(invite_code)` POST `/api/proxy/workspaces/join`
- `listMembers(id)` GET `/api/proxy/workspaces/{id}/members`
- `removeMember(id, userId)` DELETE `/api/proxy/workspaces/{id}/members/{userId}`

Orders:
- `listOrders(ws)` GET `/api/proxy/orders?workspace_id={ws}`
- `getOrder(id)` GET `/api/proxy/orders/{id}`
- `createOrder(body)` POST `/api/proxy/orders`
- `updateOrder(id, body)` PUT `/api/proxy/orders/{id}`
- `deleteOrder(id)` DELETE `/api/proxy/orders/{id}`
- `bulkOrders(body)` POST `/api/proxy/orders/bulk`

Customers:
- `listCustomers(ws)` GET `/api/proxy/customers?workspace_id={ws}`
- `getCustomer(id)` GET `/api/proxy/customers/{id}`
- `createCustomer(body)` POST `/api/proxy/customers`
- `updateCustomer(id, body)` PUT `/api/proxy/customers/{id}`
- `toggleWatchlist(id)` POST `/api/proxy/customers/{id}/watchlist`

Alerts:
- `listAlerts(ws, filters)` GET `/api/proxy/alerts?workspace_id={ws}&...`
- `getAlert(id)` GET `/api/proxy/alerts/{id}`
- `createAlert(body)` POST `/api/proxy/alerts`
- `updateAlertStatus(id, status)` PUT `/api/proxy/alerts/{id}/status`
- `bulkAlerts(body)` POST `/api/proxy/alerts/bulk`
- `dedupeAlert(id, body)` POST `/api/proxy/alerts/{id}/dedupe`

Decisions:
- `listDecisions(ws)` GET `/api/proxy/decisions?workspace_id={ws}`
- `getDecisionForAlert(alertId)` GET `/api/proxy/decisions/alert/{alertId}`
- `evaluateAlert(body)` POST `/api/proxy/decisions/evaluate`
- `batchEvaluate(body)` POST `/api/proxy/decisions/batch`
- `overrideDecision(id, body)` POST `/api/proxy/decisions/{id}/override`

Refunds:
- `listRefunds(ws)` GET `/api/proxy/refunds?workspace_id={ws}`
- `executeRefund(body)` POST `/api/proxy/refunds`
- `checkDoubleRefund(orderId)` GET `/api/proxy/refunds/check?order_id={orderId}`
- `listRefundLinks(ws)` GET `/api/proxy/refunds/links?workspace_id={ws}`

Rules:
- `listRuleSets(ws)` GET `/api/proxy/rules?workspace_id={ws}`
- `getRuleSet(id)` GET `/api/proxy/rules/{id}`
- `createRuleSet(body)` POST `/api/proxy/rules`
- `updateRuleSet(id, body)` PUT `/api/proxy/rules/{id}`
- `activateRuleSet(id)` POST `/api/proxy/rules/{id}/activate`
- `simulateRuleSet(id, body)` POST `/api/proxy/rules/{id}/simulate`
- `deleteRuleSet(id)` DELETE `/api/proxy/rules/{id}`

Automation:
- `listAutoRules(ws)` GET `/api/proxy/automation?workspace_id={ws}`
- `createAutoRule(body)` POST `/api/proxy/automation`
- `updateAutoRule(id, body)` PUT `/api/proxy/automation/{id}`
- `runAutoRule(id)` POST `/api/proxy/automation/{id}/run`
- `deleteAutoRule(id)` DELETE `/api/proxy/automation/{id}`

Reason codes:
- `listReasonCodes(ws)` GET `/api/proxy/reason-codes?workspace_id={ws}`
- `reasonCodeStats(ws)` GET `/api/proxy/reason-codes/stats?workspace_id={ws}`
- `createReasonCode(body)` POST `/api/proxy/reason-codes`
- `updateReasonCode(id, body)` PUT `/api/proxy/reason-codes/{id}`

Feeds:
- `listFeeds(ws)` GET `/api/proxy/feeds?workspace_id={ws}`
- `createFeed(body)` POST `/api/proxy/feeds`
- `updateFeed(id, body)` PUT `/api/proxy/feeds/{id}`
- `syncFeed(id)` POST `/api/proxy/feeds/{id}/sync`

Ratio:
- `getCurrentRatio(ws)` GET `/api/proxy/ratio/current?workspace_id={ws}`
- `getRatioProjection(ws)` GET `/api/proxy/ratio/projection?workspace_id={ws}`
- `listRatioSnapshots(ws)` GET `/api/proxy/ratio/snapshots?workspace_id={ws}`
- `captureRatioSnapshot(body)` POST `/api/proxy/ratio/snapshot`

Thresholds:
- `listThresholds(ws)` GET `/api/proxy/thresholds?workspace_id={ws}`
- `updateThreshold(id, body)` PUT `/api/proxy/thresholds/{id}`
- `createThreshold(body)` POST `/api/proxy/thresholds`

Deadlines:
- `getDeadlineBoard(ws)` GET `/api/proxy/deadlines/board?workspace_id={ws}`
- `getDeadlineBreaches(ws)` GET `/api/proxy/deadlines/breaches?workspace_id={ws}`

Notifications:
- `listNotifications(ws)` GET `/api/proxy/notifications?workspace_id={ws}`
- `markNotificationRead(id)` POST `/api/proxy/notifications/{id}/read`
- `markAllNotificationsRead(body)` POST `/api/proxy/notifications/read-all`

Audit:
- `listAuditEvents(ws, filters)` GET `/api/proxy/audit?workspace_id={ws}&...`

Analytics:
- `getTrends(ws)` GET `/api/proxy/analytics/trends?workspace_id={ws}`
- `getPerformance(ws)` GET `/api/proxy/analytics/performance?workspace_id={ws}`

ROI:
- `getRoiSummary(ws)` GET `/api/proxy/roi/summary?workspace_id={ws}`
- `listSavingsRecords(ws)` GET `/api/proxy/roi/records?workspace_id={ws}`
- `getRoiTrend(ws)` GET `/api/proxy/roi/trend?workspace_id={ws}`

Reports:
- `listReports(ws)` GET `/api/proxy/reports?workspace_id={ws}`
- `getReport(id)` GET `/api/proxy/reports/{id}`
- `generateReport(body)` POST `/api/proxy/reports/generate`
- `exportReport(id, format)` GET `/api/proxy/reports/{id}/export?format={format}`

Saved views:
- `listSavedViews(ws)` GET `/api/proxy/saved-views?workspace_id={ws}`
- `createSavedView(body)` POST `/api/proxy/saved-views`
- `deleteSavedView(id)` DELETE `/api/proxy/saved-views/{id}`

Seed:
- `seedSample(body)` POST `/api/proxy/seed/sample`
- `resetSample(body)` POST `/api/proxy/seed/reset`

Billing:
- `getBillingPlan()` GET `/api/proxy/billing/plan`
- `startCheckout()` POST `/api/proxy/billing/checkout`
- `openPortal()` POST `/api/proxy/billing/portal`

Every method above is implemented by exactly one route endpoint in section (b) and consumed by at least one page in section (d). (`billing/webhook` is Stripe-only, not called from the browser, so it has no api method.)

---

## (d) Pages (URL → file → kind → api methods → renders)

Public:
1. `/` → `web/app/page.tsx` → public → none → static landing: hero, the deflection-vs-representment thesis, feature grid, CTAs.
2. `/auth/sign-in` → `web/app/auth/sign-in/page.tsx` → public → authClient.signIn.email → sign-in form.
3. `/auth/sign-up` → `web/app/auth/sign-up/page.tsx` → public → authClient.signUp.email → sign-up form.
4. `/pricing` → `web/app/pricing/page.tsx` → public → `getBillingPlan` → Free vs Pro tiers, Pro shows "contact / coming soon" (503-aware).

Dashboard (wrapped by `web/app/dashboard/layout.tsx` → `DashboardLayout` sidebar):
5. `/dashboard` → `web/app/dashboard/page.tsx` → dashboard → `getCurrentRatio`, `getRoiSummary`, `getDeadlineBoard`, `listAlerts`, `listWorkspaces`, `createWorkspace`, `joinWorkspace`, `seedSample` → overview: ratio gauge, ROI cards, deadline snippet, recent alerts; workspace picker/create/seed when none.
6. `/dashboard/alerts` → `web/app/dashboard/alerts/page.tsx` → dashboard → `listAlerts`, `listSavedViews`, `createSavedView`, `deleteSavedView`, `batchEvaluate` → triage queue with filters + saved views.
7. `/dashboard/alerts/[id]` → `web/app/dashboard/alerts/[id]/page.tsx` → dashboard → `getAlert`, `getDecisionForAlert`, `evaluateAlert`, `overrideDecision`, `updateAlertStatus`, `executeRefund`, `checkDoubleRefund`, `dedupeAlert` → alert detail: decision panel, deadline timer, linked order, refund/deflect action, action log.
8. `/dashboard/alerts/new` → `web/app/dashboard/alerts/new/page.tsx` → dashboard → `createAlert`, `bulkAlerts`, `listOrders` → manual entry + bulk CSV upload.
9. `/dashboard/deadlines` → `web/app/dashboard/deadlines/page.tsx` → dashboard → `getDeadlineBoard`, `getDeadlineBreaches` → deadline board by urgency band.
10. `/dashboard/decisions` → `web/app/dashboard/decisions/page.tsx` → dashboard → `listDecisions`, `overrideDecision` → decision history and overrides.
11. `/dashboard/ratio` → `web/app/dashboard/ratio/page.tsx` → dashboard → `getCurrentRatio`, `getRatioProjection`, `listRatioSnapshots`, `captureRatioSnapshot`, `listThresholds` → ratio guardrail vs VDMP/ECP, projection, trend.
12. `/dashboard/refunds` → `web/app/dashboard/refunds/page.tsx` → dashboard → `listRefunds`, `listRefundLinks`, `checkDoubleRefund` → refund ledger + double-refund prevention reconciliation.
13. `/dashboard/orders` → `web/app/dashboard/orders/page.tsx` → dashboard → `listOrders`, `createOrder`, `bulkOrders`, `deleteOrder` → orders registry + upload.
14. `/dashboard/orders/[id]` → `web/app/dashboard/orders/[id]/page.tsx` → dashboard → `getOrder`, `updateOrder` → order detail with linked alerts/refunds.
15. `/dashboard/customers` → `web/app/dashboard/customers/page.tsx` → dashboard → `listCustomers`, `getCustomer`, `createCustomer`, `updateCustomer`, `toggleWatchlist` → customer history + watchlist.
16. `/dashboard/rules` → `web/app/dashboard/rules/page.tsx` → dashboard → `listRuleSets`, `getRuleSet`, `createRuleSet`, `updateRuleSet`, `activateRuleSet`, `simulateRuleSet`, `deleteRuleSet` → rule sets list/edit/activate/simulate.
17. `/dashboard/automation` → `web/app/dashboard/automation/page.tsx` → dashboard → `listAutoRules`, `createAutoRule`, `updateAutoRule`, `runAutoRule`, `deleteAutoRule` → auto-deflection rules + dry-run.
18. `/dashboard/reason-codes` → `web/app/dashboard/reason-codes/page.tsx` → dashboard → `listReasonCodes`, `reasonCodeStats`, `createReasonCode`, `updateReasonCode` → reason code library + stats.
19. `/dashboard/feeds` → `web/app/dashboard/feeds/page.tsx` → dashboard → `listFeeds`, `createFeed`, `updateFeed`, `syncFeed` → network feed connections + health + sample sync.
20. `/dashboard/roi` → `web/app/dashboard/roi/page.tsx` → dashboard → `getRoiSummary`, `listSavingsRecords`, `getRoiTrend` → ROI & savings dashboard.
21. `/dashboard/analytics` → `web/app/dashboard/analytics/page.tsx` → dashboard → `getTrends`, `getPerformance` → analytics & trends.
22. `/dashboard/notifications` → `web/app/dashboard/notifications/page.tsx` → dashboard → `listNotifications`, `markNotificationRead`, `markAllNotificationsRead` → notifications center.
23. `/dashboard/reports` → `web/app/dashboard/reports/page.tsx` → dashboard → `listReports`, `getReport`, `generateReport`, `exportReport` → reports generation + exports.
24. `/dashboard/audit` → `web/app/dashboard/audit/page.tsx` → dashboard → `listAuditEvents` → audit trail with filters.
25. `/dashboard/team` → `web/app/dashboard/team/page.tsx` → dashboard → `listMembers`, `removeMember`, `getWorkspace`, `updateWorkspace`, `joinWorkspace` → workspace & team membership, invite code.
26. `/dashboard/settings` → `web/app/dashboard/settings/page.tsx` → dashboard → `listThresholds`, `updateThreshold`, `createThreshold`, `updateWorkspace`, `getBillingPlan`, `startCheckout`, `openPortal`, `seedSample`, `resetSample` → workspace settings, thresholds, billing/plan, sample data tools.

Plus route handlers: `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

Total pages: **26** (4 public + 22 dashboard).

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` (`'use client'`, `usePathname()` active state, mobile drawer). Sections:

- **Overview**
  - Dashboard → `/dashboard`
- **Triage**
  - Alert Queue → `/dashboard/alerts`
  - New Alert → `/dashboard/alerts/new`
  - Deadlines → `/dashboard/deadlines`
  - Decisions → `/dashboard/decisions`
- **Ratio & Risk**
  - Ratio Guardrail → `/dashboard/ratio`
  - ROI & Savings → `/dashboard/roi`
  - Analytics → `/dashboard/analytics`
- **Records**
  - Orders → `/dashboard/orders`
  - Customers → `/dashboard/customers`
  - Refunds → `/dashboard/refunds`
- **Configuration**
  - Decision Rules → `/dashboard/rules`
  - Automation → `/dashboard/automation`
  - Reason Codes → `/dashboard/reason-codes`
  - Feeds → `/dashboard/feeds`
- **Workspace**
  - Reports → `/dashboard/reports`
  - Audit Trail → `/dashboard/audit`
  - Notifications → `/dashboard/notifications`
  - Team → `/dashboard/team`
  - Settings → `/dashboard/settings`
