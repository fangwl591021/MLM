import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) {
  return value == null ? '' : String(value);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(stringValue(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function crmLineUserId(member) {
  const raw = parseJsonObject(member && member.source_json);
  return stringValue(raw.LINE_user_id || raw.user_login || raw.line_user_id || raw.lineUserId);
}

export async function searchCrmMemberCandidatesCandidate(env, url) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const q = stringValue(url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('search')).trim();
  if (!q) return [];
  const lowered = q.toLowerCase();
  const like = `%${lowered}%`;
  const limit = clamp(url.searchParams.get('limit') || 20, 1, 100, 20);
  const rows = await env.DB.prepare(`
    SELECT member_ref, name, phone, email, level, source, source_json, updated_at
    FROM crm_members
    WHERE LOWER(member_ref) LIKE ?
       OR LOWER(name) LIKE ?
       OR LOWER(phone) LIKE ?
       OR LOWER(email) LIKE ?
       OR LOWER(source_json) LIKE ?
    ORDER BY CASE
      WHEN LOWER(member_ref) = ? THEN 0
      WHEN LOWER(phone) = ? THEN 1
      WHEN LOWER(name) = ? THEN 2
      WHEN LOWER(name) LIKE ? THEN 3
      ELSE 4
    END,
    updated_at DESC
    LIMIT ?
  `).bind(like, like, like, like, like, lowered, lowered, lowered, like, limit).all();

  return (rows.results || []).map((member) => {
    const raw = parseJsonObject(member.source_json);
    return {
      member_ref: stringValue(member.member_ref),
      name: stringValue(member.name || raw.display_name || raw.LINE_display_name),
      phone: stringValue(member.phone || raw.phone),
      line_user_id: crmLineUserId(member),
      line_display_name: stringValue(raw.LINE_display_name || raw.display_name),
      shop_id: stringValue(raw.shop_id || member.level),
      source: stringValue(member.source),
      updated_at: stringValue(member.updated_at),
    };
  }).filter((member) => member.member_ref);
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

export async function crmMemberSearchCandidateResponse(request, env) {
  const candidates = await searchCrmMemberCandidatesCandidate(env, new URL(request.url));
  return new Response(JSON.stringify({ success: true, status: 'success', candidates }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerCrmMemberSearchShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/crm/member-search' && env.SHADOW_CRM_MEMBER_SEARCH_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => crmMemberSearchCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'CRM-MEMBER-SEARCH-SHADOW-001',
    path: '/admin/crm/member-search',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_CRM_MEMBER_SEARCH_ENABLED',
  });
}
