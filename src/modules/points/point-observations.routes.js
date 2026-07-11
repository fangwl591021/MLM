import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) { return value == null ? '' : String(value); }
function clamp(value, fallback = 50) { const n = Number(value); return Math.max(1, Math.min(200, Number.isFinite(n) ? n : fallback)); }
function cors(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';
  return {
    'Access-Control-Allow-Origin': allowed && requestOrigin === allowed ? allowed : allowed || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Dashboard-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function listPointObservationsCandidate(env, url) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const channelKey = stringValue(url.searchParams.get('channel_key'));
  const limit = clamp(url.searchParams.get('limit') || 50);
  if (channelKey) {
    const rows = await env.DB.prepare(`
      SELECT channel_key, line_user_id, first_seen_at, last_seen_at, event_count
      FROM line_identity_observations
      WHERE channel_key = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).bind(channelKey, limit).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT channel_key, line_user_id, first_seen_at, last_seen_at, event_count
    FROM line_identity_observations
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
}

export async function pointObservationsCandidateResponse(request, env) {
  const observations = await listPointObservationsCandidate(env, new URL(request.url));
  return new Response(JSON.stringify({ success: true, status: 'success', observations }), { status: 200, headers: cors(request, env) });
}

export function registerPointObservationsShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/points/observations' && env.SHADOW_POINT_OBSERVATIONS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => pointObservationsCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'POINT-OBSERVATIONS-SHADOW-001', path: '/admin/points/observations', risk: 'medium', write: false,
    mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_POINT_OBSERVATIONS_ENABLED',
  });
}
