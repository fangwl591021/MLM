import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import {
  buildCorsHeaders,
  clampInteger,
  mapCrmMemberSearchCandidate,
  stringValue,
} from './crm-read-core.js';

export async function searchCrmMemberCandidatesCandidate(env, url) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const q = stringValue(url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('search')).trim();
  if (!q) return [];
  const lowered = q.toLowerCase();
  const like = `%${lowered}%`;
  const limit = clampInteger(url.searchParams.get('limit') || 20, 1, 100, 20);
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

  return (rows.results || [])
    .map(mapCrmMemberSearchCandidate)
    .filter((member) => member.member_ref);
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
