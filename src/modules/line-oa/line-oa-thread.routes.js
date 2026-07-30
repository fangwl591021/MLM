import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import {
  isMonitorHiddenMessage,
  lineOaThreadFromD1,
  resolveLineOaFloor,
  stringValue,
  threadIdFor,
} from './line-oa-read-core.js';

export async function fetchLineOaThreadCandidate(env, floor, id) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const lookup = id.includes(':user:') || id.startsWith('user:') ? id : threadIdFor(floor, id);
  const row = await env.DB.prepare(`
    SELECT t.*, p.display_name AS profile_display_name, p.picture_url AS profile_picture_url,
      (SELECT tx.display_name FROM threads tx WHERE tx.user_id = t.user_id AND tx.display_name <> '' AND tx.display_name <> tx.user_id ORDER BY tx.updated_at DESC LIMIT 1) AS linked_display_name,
      (SELECT tx.picture_url FROM threads tx WHERE tx.user_id = t.user_id AND tx.picture_url <> '' ORDER BY tx.updated_at DESC LIMIT 1) AS linked_picture_url,
      p.profile_status, p.profile_error, p.last_profile_sync
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE t.floor_id = ? AND (t.id = ? OR t.user_id = ?)
  `).bind(floor, lookup, id.replace(/^(admin:)?user:/, '')).first();
  if (!row) return null;
  const messages = await env.DB.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC').bind(row.id).all();
  return lineOaThreadFromD1(row, (messages.results || []).filter((message) => !isMonitorHiddenMessage(message)));
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

export async function lineOaThreadCandidateResponse(request, env) {
  const url = new URL(request.url);
  const floor = resolveLineOaFloor(request);
  const id = stringValue(url.searchParams.get('id'));
  const data = await fetchLineOaThreadCandidate(env, floor, id);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerLineOaThreadShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/line-oa/thread' && env.SHADOW_LINE_OA_THREAD_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => lineOaThreadCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'LINE-OA-THREAD-SHADOW-001',
    path: '/api/line-oa/thread',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_LINE_OA_THREAD_ENABLED',
  });
}
