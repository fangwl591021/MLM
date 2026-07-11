import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) {
  return value == null ? '' : String(value);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
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

export async function listCrmMembersCandidate(env, url) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const channelKey = stringValue(url.searchParams.get('channel_key'));
  const q = stringValue(url.searchParams.get('q')).toLowerCase();
  const limit = clampNumber(url.searchParams.get('limit') || 100, 1, 500);
  let sql = `
    SELECT member_ref, name, phone, email, level, source, source_json,
           ai_wear_purchase_line_url, ai_wear_share_caption, points_snapshot, updated_at
    FROM crm_members
  `;
  const bindings = [];
  if (q) {
    sql += ' WHERE (LOWER(member_ref) LIKE ? OR LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ? OR LOWER(source_json) LIKE ?)';
    const like = `%${q}%`;
    bindings.push(like, like, like, like, like);
  }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  bindings.push(limit);
  const rows = await env.DB.prepare(sql).bind(...bindings).all();
  const members = rows.results || [];
  if (!channelKey) return members;

  const links = await env.DB.prepare(`
    SELECT master_member_ref, channel_key, line_user_id, linked_at
    FROM member_line_links
    WHERE channel_key = ?
  `).bind(channelKey).all();
  const linkMap = new Map((links.results || []).map((link) => [link.master_member_ref, link]));
  return members.map((member) => ({ ...member, line_link: linkMap.get(member.member_ref) || null }));
}

export async function crmMembersCandidateResponse(request, env) {
  const data = await listCrmMembersCandidate(env, new URL(request.url));
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerCrmMembersShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/crm/members' && env.SHADOW_CRM_MEMBERS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => crmMembersCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'CRM-MEMBERS-SHADOW-001',
    path: '/admin/crm/members',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_CRM_MEMBERS_ENABLED',
  });
}
