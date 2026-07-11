import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const FLOORS = new Set(['main', 'admin', 'smart', 'admin_all']);

function stringValue(value) {
  return value == null ? '' : String(value);
}

function resolveFloor(request) {
  const url = new URL(request.url);
  const requested = stringValue(url.searchParams.get('floor') || request.headers.get('X-Floor-Id'));
  return FLOORS.has(requested) ? requested : 'main';
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedOrigin = env.ALLOWED_ORIGIN || '';
  const origin = allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Id-Token, X-Operator-Id, X-Operator-Name, X-User-Id, X-Admin-User, X-Admin-Name, X-Floor-Id',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function parseEntries(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export async function fetchFloorWhitelistCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const rows = await env.DB.prepare('SELECT floor_id, entries, updated_at FROM floor_whitelist ORDER BY floor_id ASC').all();
  return (rows.results || []).map((row) => ({
    floor: stringValue(row.floor_id),
    entries: parseEntries(row.entries),
    updatedAt: Number(row.updated_at || 0),
  }));
}

export async function floorWhitelistCandidateResponse(request, env) {
  const data = await fetchFloorWhitelistCandidate(env, resolveFloor(request));
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerFloorWhitelistShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/floor-whitelist' && env.SHADOW_FLOOR_WHITELIST_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => floorWhitelistCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'FLOOR-WHITELIST-SHADOW-001',
    path: '/api/floor-whitelist',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_FLOOR_WHITELIST_ENABLED',
  });
}
