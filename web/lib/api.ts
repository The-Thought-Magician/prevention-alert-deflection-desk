// All calls are relative same-origin fetches to /api/proxy/<path>, which maps 1:1
// to the backend /api/v1/<path>. The proxy route injects X-User-Id after resolving
// the Neon Auth session server-side.

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

function get(path: string) {
  return req(path)
}
function send(method: string, path: string, body?: unknown) {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  createWorkspace: (body: unknown) => send('POST', 'workspaces', body),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  updateWorkspace: (id: string, body: unknown) => send('PUT', `workspaces/${id}`, body),
  joinWorkspace: (invite_code: string) => send('POST', 'workspaces/join', { invite_code }),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  removeMember: (id: string, userId: string) => send('DELETE', `workspaces/${id}/members/${userId}`),

  // Orders
  listOrders: (ws: string) => get(`orders${qs({ workspace_id: ws })}`),
  getOrder: (id: string) => get(`orders/${id}`),
  createOrder: (body: unknown) => send('POST', 'orders', body),
  updateOrder: (id: string, body: unknown) => send('PUT', `orders/${id}`, body),
  deleteOrder: (id: string) => send('DELETE', `orders/${id}`),
  bulkOrders: (body: unknown) => send('POST', 'orders/bulk', body),

  // Customers
  listCustomers: (ws: string) => get(`customers${qs({ workspace_id: ws })}`),
  getCustomer: (id: string) => get(`customers/${id}`),
  createCustomer: (body: unknown) => send('POST', 'customers', body),
  updateCustomer: (id: string, body: unknown) => send('PUT', `customers/${id}`, body),
  toggleWatchlist: (id: string) => send('POST', `customers/${id}/watchlist`),

  // Alerts
  listAlerts: (ws: string, filters?: Record<string, string | number | boolean | undefined>) =>
    get(`alerts${qs({ workspace_id: ws, ...(filters ?? {}) })}`),
  getAlert: (id: string) => get(`alerts/${id}`),
  createAlert: (body: unknown) => send('POST', 'alerts', body),
  updateAlertStatus: (id: string, status: string) => send('PUT', `alerts/${id}/status`, { status }),
  bulkAlerts: (body: unknown) => send('POST', 'alerts/bulk', body),
  dedupeAlert: (id: string, body: unknown) => send('POST', `alerts/${id}/dedupe`, body),

  // Decisions
  listDecisions: (ws: string) => get(`decisions${qs({ workspace_id: ws })}`),
  getDecisionForAlert: (alertId: string) => get(`decisions/alert/${alertId}`),
  evaluateAlert: (body: unknown) => send('POST', 'decisions/evaluate', body),
  batchEvaluate: (body: unknown) => send('POST', 'decisions/batch', body),
  overrideDecision: (id: string, body: unknown) => send('POST', `decisions/${id}/override`, body),

  // Refunds
  listRefunds: (ws: string) => get(`refunds${qs({ workspace_id: ws })}`),
  executeRefund: (body: unknown) => send('POST', 'refunds', body),
  checkDoubleRefund: (orderId: string) => get(`refunds/check${qs({ order_id: orderId })}`),
  listRefundLinks: (ws: string) => get(`refunds/links${qs({ workspace_id: ws })}`),

  // Rules
  listRuleSets: (ws: string) => get(`rules${qs({ workspace_id: ws })}`),
  getRuleSet: (id: string) => get(`rules/${id}`),
  createRuleSet: (body: unknown) => send('POST', 'rules', body),
  updateRuleSet: (id: string, body: unknown) => send('PUT', `rules/${id}`, body),
  activateRuleSet: (id: string) => send('POST', `rules/${id}/activate`),
  simulateRuleSet: (id: string, body: unknown) => send('POST', `rules/${id}/simulate`, body),
  deleteRuleSet: (id: string) => send('DELETE', `rules/${id}`),

  // Automation
  listAutoRules: (ws: string) => get(`automation${qs({ workspace_id: ws })}`),
  createAutoRule: (body: unknown) => send('POST', 'automation', body),
  updateAutoRule: (id: string, body: unknown) => send('PUT', `automation/${id}`, body),
  runAutoRule: (id: string) => send('POST', `automation/${id}/run`),
  deleteAutoRule: (id: string) => send('DELETE', `automation/${id}`),

  // Reason codes
  listReasonCodes: (ws: string) => get(`reason-codes${qs({ workspace_id: ws })}`),
  reasonCodeStats: (ws: string) => get(`reason-codes/stats${qs({ workspace_id: ws })}`),
  createReasonCode: (body: unknown) => send('POST', 'reason-codes', body),
  updateReasonCode: (id: string, body: unknown) => send('PUT', `reason-codes/${id}`, body),

  // Feeds
  listFeeds: (ws: string) => get(`feeds${qs({ workspace_id: ws })}`),
  createFeed: (body: unknown) => send('POST', 'feeds', body),
  updateFeed: (id: string, body: unknown) => send('PUT', `feeds/${id}`, body),
  syncFeed: (id: string) => send('POST', `feeds/${id}/sync`),

  // Ratio
  getCurrentRatio: (ws: string) => get(`ratio/current${qs({ workspace_id: ws })}`),
  getRatioProjection: (ws: string) => get(`ratio/projection${qs({ workspace_id: ws })}`),
  listRatioSnapshots: (ws: string) => get(`ratio/snapshots${qs({ workspace_id: ws })}`),
  captureRatioSnapshot: (body: unknown) => send('POST', 'ratio/snapshot', body),

  // Thresholds
  listThresholds: (ws: string) => get(`thresholds${qs({ workspace_id: ws })}`),
  updateThreshold: (id: string, body: unknown) => send('PUT', `thresholds/${id}`, body),
  createThreshold: (body: unknown) => send('POST', 'thresholds', body),

  // Deadlines
  getDeadlineBoard: (ws: string) => get(`deadlines/board${qs({ workspace_id: ws })}`),
  getDeadlineBreaches: (ws: string) => get(`deadlines/breaches${qs({ workspace_id: ws })}`),

  // Notifications
  listNotifications: (ws: string) => get(`notifications${qs({ workspace_id: ws })}`),
  markNotificationRead: (id: string) => send('POST', `notifications/${id}/read`),
  markAllNotificationsRead: (body: unknown) => send('POST', 'notifications/read-all', body),

  // Audit
  listAuditEvents: (ws: string, filters?: Record<string, string | number | boolean | undefined>) =>
    get(`audit${qs({ workspace_id: ws, ...(filters ?? {}) })}`),

  // Analytics
  getTrends: (ws: string) => get(`analytics/trends${qs({ workspace_id: ws })}`),
  getPerformance: (ws: string) => get(`analytics/performance${qs({ workspace_id: ws })}`),

  // ROI
  getRoiSummary: (ws: string) => get(`roi/summary${qs({ workspace_id: ws })}`),
  listSavingsRecords: (ws: string) => get(`roi/records${qs({ workspace_id: ws })}`),
  getRoiTrend: (ws: string) => get(`roi/trend${qs({ workspace_id: ws })}`),

  // Reports
  listReports: (ws: string) => get(`reports${qs({ workspace_id: ws })}`),
  getReport: (id: string) => get(`reports/${id}`),
  generateReport: (body: unknown) => send('POST', 'reports/generate', body),
  exportReport: (id: string, format: string) => get(`reports/${id}/export${qs({ format })}`),

  // Saved views
  listSavedViews: (ws: string) => get(`saved-views${qs({ workspace_id: ws })}`),
  createSavedView: (body: unknown) => send('POST', 'saved-views', body),
  deleteSavedView: (id: string) => send('DELETE', `saved-views/${id}`),

  // Seed
  seedSample: (body: unknown) => send('POST', 'seed/sample', body),
  resetSample: (body: unknown) => send('POST', 'seed/reset', body),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => send('POST', 'billing/checkout'),
  openPortal: () => send('POST', 'billing/portal'),
}

export default api
