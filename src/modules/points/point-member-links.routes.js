import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) {
  return value == null ? '' : String(value);
}

function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(number)));
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

export async function listPointMemberLinksCandidate(env, url) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const masterMemberRef = stringValue(url.searchParams.get('master_member_ref'));
  const limit = clampLimit(url.searchParams.get('limit') || 50);

  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT master_member_ref, channel_key, line_user_id, binding_code, linked_at
      FROM member_line_links
      WHERE master_member_ref = ?
      ORDER BY linked_at DESC
    `).bind(masterMemberRef).all();
    return rows.results || [];
  }

  const rows = await env.DB.prepare(`
    SELECT master_member_ref, channel_key, line_user_id, binding_code, linked_at
    FROM member_line_links
    ORDER BY linked_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
}

export async function pointMemberLinksCandidateResponse(request, env) {
  const links = await listPointMemberLinksCandidate(env, new URL(request.url));
  return new Response(JSON.stringify({ success: true, status: 'success', links }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerPointMemberLinksShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/points/member-links' && env.SHADOW_POINT_MEMBER_LINKS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => pointMemberLinksCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'POINT-MEMBER-LINKS-SHADOW-001',
    path: '/admin/points/member-links',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_POINT_MEMBER_LINKS_ENABLED',
  });
}
