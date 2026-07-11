import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) { return value == null ? '' : String(value); }
function numberOrZero(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.round(n * 10000) / 10000);
}
function currency(value) { return stringValue(value).trim().toUpperCase() === 'USD' ? 'USD' : 'TWD'; }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedOrigin = env.ALLOWED_ORIGIN || '';
  const origin = allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Id-Token, X-Operator-Id, X-Operator-Name, X-User-Id, X-Admin-User, X-Admin-Name',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
export function startOfTaipeiDay(time = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.parse(`${map.year}-${map.month}-${map.day}T00:00:00+08:00`);
}
export function startOfTaipeiMonth(time = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(new Date(time));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.parse(`${map.year}-${map.month}-01T00:00:00+08:00`);
}
function summaryRow(row) {
  return { count: numberOrZero(row?.count), successCount: numberOrZero(row?.success_count), totalCostTwd: money(row?.total_cost_twd), totalPointCost: numberOrZero(row?.total_point_cost) };
}
export async function getAiWearCostSummaryCandidate(env, searchParams, { now = Date.now } = {}) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const current = now();
  const todayStart = startOfTaipeiDay(current);
  const monthStart = startOfTaipeiMonth(current);
  const limit = clamp(searchParams?.get('limit') || 20, 1, 100, 20);
  const [settingsRow, today, month, byMember, byModel, recent] = await Promise.all([
    env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind('ai_wear_settings').first(),
    env.DB.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?").bind(todayStart).first(),
    env.DB.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?").bind(monthStart).first(),
    env.DB.prepare('SELECT line_user_id, display_name, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost, MAX(created_at) AS last_at FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY line_user_id, display_name ORDER BY total_cost_twd DESC, count DESC LIMIT ?').bind(monthStart, limit).all(),
    env.DB.prepare('SELECT model_id, model_title, ai_model, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY model_id, model_title, ai_model ORDER BY total_cost_twd DESC, count DESC LIMIT ?').bind(monthStart, limit).all(),
    env.DB.prepare('SELECT result_id, line_user_id, display_name, model_title, ai_model, provider, point_cost, estimated_cost_twd, actual_cost_usd, cost_source, status, created_at FROM ai_wear_cost_events ORDER BY created_at DESC LIMIT ?').bind(limit).all(),
  ]);
  let settings = {};
  try { settings = settingsRow?.value ? JSON.parse(settingsRow.value) : {}; } catch (_) { settings = {}; }
  return {
    settings: {
      costPerGeneration: Number(settings.costPerGeneration || 0),
      costCurrency: currency(settings.costCurrency),
      usdToTwdRate: Number(settings.usdToTwdRate || 32),
      costControlEnabled: settings.costControlEnabled === true,
      dailyCostLimitTwd: numberOrZero(settings.dailyCostLimitTwd),
      monthlyCostLimitTwd: numberOrZero(settings.monthlyCostLimitTwd),
      perUserDailyLimit: numberOrZero(settings.perUserDailyLimit),
    },
    today: summaryRow(today),
    month: summaryRow(month),
    byMember: (byMember.results || []).map((row) => ({ lineUserId: stringValue(row.line_user_id), displayName: stringValue(row.display_name), count: numberOrZero(row.count), totalCostTwd: money(row.total_cost_twd), totalPointCost: numberOrZero(row.total_point_cost), lastAt: numberOrZero(row.last_at) })),
    byModel: (byModel.results || []).map((row) => ({ modelId: stringValue(row.model_id), modelTitle: stringValue(row.model_title), aiModel: stringValue(row.ai_model), count: numberOrZero(row.count), totalCostTwd: money(row.total_cost_twd), totalPointCost: numberOrZero(row.total_point_cost) })),
    recent: (recent.results || []).map((row) => ({ resultId: stringValue(row.result_id), lineUserId: stringValue(row.line_user_id), displayName: stringValue(row.display_name), modelTitle: stringValue(row.model_title), aiModel: stringValue(row.ai_model), provider: stringValue(row.provider), pointCost: numberOrZero(row.point_cost), estimatedCostTwd: money(row.estimated_cost_twd), actualCostUsd: money(row.actual_cost_usd), costSource: stringValue(row.cost_source || 'estimate'), status: stringValue(row.status), createdAt: numberOrZero(row.created_at) })),
  };
}
export async function aiWearCostSummaryCandidateResponse(request, env, options = {}) {
  const data = await getAiWearCostSummaryCandidate(env, new URL(request.url).searchParams, options);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), { status: 200, headers: buildCorsHeaders(request, env) });
}
export function registerAiWearCostSummaryShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-cost-summary' && env.SHADOW_AI_WEAR_COST_SUMMARY_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({ legacy: () => legacyFetch(request, env, ctx), candidate: () => aiWearCostSummaryCandidateResponse(request, env, { now }), logger, allowedStatuses: [200] });
    return result.response;
  }, { id: 'AI-WEAR-COST-SUMMARY-SHADOW-001', path: '/api/ai-wear-cost-summary', risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_COST_SUMMARY_ENABLED' });
}
