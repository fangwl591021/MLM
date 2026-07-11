import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const RESULT_PREFIX = '/assets/ai-wear/result/';
const DEFAULT_PUBLIC_BASE_URL = 'https://mlm.fangwl591021.workers.dev';

function stringValue(value) {
  return value == null ? '' : String(value);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function publicBaseUrl(env) {
  return stringValue(env.PUBLIC_BASE_URL || env.WORKER_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
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

function resultToClient(row, env) {
  const id = stringValue(row && row.id);
  return {
    id,
    lineUserId: stringValue(row && row.line_user_id),
    displayName: stringValue(row && row.display_name),
    modelId: stringValue(row && row.model_id),
    modelTitle: stringValue(row && row.model_title),
    personImageUrl: stringValue(row && row.person_image_url),
    resultImageUrl: row && row.has_result_blob
      ? `${publicBaseUrl(env)}${RESULT_PREFIX}${encodeURIComponent(id)}`
      : stringValue(row && row.result_image_url),
    pointCost: numberOrZero(row && row.point_cost),
    pointChannelKey: stringValue(row && row.point_channel_key),
    pointType: stringValue(row && row.point_type),
    status: stringValue(row && row.status),
    createdAt: numberOrZero(row && row.created_at),
  };
}

export async function listAiWearResultsCandidate(env, searchParams) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const limit = Math.max(1, Math.min(200, Number(searchParams && searchParams.get('limit')) || 50));
  const rows = await env.DB.prepare(`
    SELECT id, line_user_id, display_name, model_id, model_title, person_image_url,
           result_image_url, result_mime_type,
           CASE WHEN result_base64 != '' THEN 1 ELSE 0 END AS has_result_blob,
           point_cost, point_channel_key, point_type, status, created_at
    FROM ai_wear_results
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();
  return { items: (rows.results || []).map((row) => resultToClient(row, env)) };
}

export async function aiWearResultsCandidateResponse(request, env) {
  const data = await listAiWearResultsCandidate(env, new URL(request.url).searchParams);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAiWearResultsShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-results' && env.SHADOW_AI_WEAR_RESULTS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => aiWearResultsCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AI-WEAR-RESULTS-SHADOW-001',
    path: '/api/ai-wear-results',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AI_WEAR_RESULTS_ENABLED',
  });
}
