import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const FLOOR_MAIN = 'main';
const FLOOR_ADMIN = 'admin';
const FLOOR_SMART = 'smart';
const FLOOR_SUPER_ADMIN = 'admin_all';
const FLOOR_IDS = new Set([FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART]);

function stringValue(value) {
  return value == null ? '' : String(value);
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

export async function fetchFloorWhitelistCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') return { floors: {} };
  const rows = await env.DB.prepare(`
    SELECT floor_id, operator_id, operator_name, active, updated_at
    FROM floor_access_whitelist
    ORDER BY floor_id ASC, operator_id ASC
  `).all();
  const floors = { [FLOOR_MAIN]: [], [FLOOR_ADMIN]: [], [FLOOR_SMART]: [], adminAll: [] };
  for (const row of rows.results || []) {
    const floorId = row.floor_id === FLOOR_SUPER_ADMIN
      ? FLOOR_SUPER_ADMIN
      : (FLOOR_IDS.has(row.floor_id) ? row.floor_id : FLOOR_MAIN);
    const listKey = floorId === FLOOR_SUPER_ADMIN ? 'adminAll' : floorId;
    floors[listKey].push({
      floorId,
      operatorId: stringValue(row.operator_id),
      operatorName: stringValue(row.operator_name),
      active: Number(row.active || 0) === 1,
      updatedAt: row.updated_at,
    });
  }
  return { floors };
}

export async function floorWhitelistCandidateResponse(request, env) {
  const data = await fetchFloorWhitelistCandidate(env);
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
