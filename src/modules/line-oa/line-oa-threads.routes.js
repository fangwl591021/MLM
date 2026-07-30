import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import {
  chunkItems,
  isMonitorHiddenMessage,
  lineOaThreadFromD1,
  resolveLineOaFloor,
  stringValue,
} from './line-oa-read-core.js';

const FLOOR_MAIN = 'main';
const FLOOR_ADMIN = 'admin';

export async function listLineOaThreadsCandidate(env, floor = FLOOR_MAIN, limit = 120) {
  if (!env.DB?.prepare) throw new Error('DB is not configured');
  const queryLimit = floor === FLOOR_ADMIN ? Math.min(Number(limit || 120) + 500, 800) : limit;
  let rows = (await env.DB.prepare(`SELECT t.*, p.display_name AS profile_display_name, p.picture_url AS profile_picture_url,
    (SELECT tx.display_name FROM threads tx WHERE tx.user_id=t.user_id AND tx.display_name<>'' AND tx.display_name<>tx.user_id ORDER BY tx.updated_at DESC LIMIT 1) AS linked_display_name,
    (SELECT tx.picture_url FROM threads tx WHERE tx.user_id=t.user_id AND tx.picture_url<>'' ORDER BY tx.updated_at DESC LIMIT 1) AS linked_picture_url,
    p.profile_status, p.profile_error, p.last_profile_sync FROM threads t LEFT JOIN profiles p ON p.user_id=t.user_id
    WHERE t.floor_id=? ORDER BY t.last_message_at DESC, t.updated_at DESC LIMIT ?`).bind(floor, queryLimit).all()).results || [];
  if (floor === FLOOR_ADMIN) {
    const suspects = rows.filter((row) => !stringValue(row.display_name)
      && !stringValue(row.picture_url)
      && Number(row.profile_status || 0) === 404
      && stringValue(row.user_id));
    const gateway = new Set();
    for (const batch of chunkItems([...new Set(suspects.map((row) => stringValue(row.user_id))) ])) {
      const placeholders = batch.map(() => '?').join(',');
      const found = await env.DB.prepare(`SELECT DISTINCT line_user_id FROM webhook_events WHERE channel_key IN (?, ?) AND line_user_id IN (${placeholders})`).bind('oa1', 'oa2', ...batch).all();
      for (const row of found.results || []) gateway.add(stringValue(row.line_user_id));
    }
    rows = rows.filter((row) => !(!stringValue(row.display_name)
      && !stringValue(row.picture_url)
      && Number(row.profile_status || 0) === 404
      && gateway.has(stringValue(row.user_id))));
  }
  const ids = rows.map((row) => row.id);
  const messages = [];
  for (const batch of chunkItems(ids)) {
    const placeholders = batch.map(() => '?').join(',');
    const found = await env.DB.prepare(`SELECT * FROM messages WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC`).bind(...batch).all();
    messages.push(...(found.results || []));
  }
  const byId = new Map(ids.map((id) => [id, []]));
  for (const message of messages) {
    if (isMonitorHiddenMessage(message)) continue;
    if (!byId.has(message.thread_id)) byId.set(message.thread_id, []);
    byId.get(message.thread_id).push(message);
  }
  return rows
    .map((row) => lineOaThreadFromD1(row, byId.get(row.id) || []))
    .filter((thread) => thread.messages.length > 0);
}

function headers(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';
  return {
    'Access-Control-Allow-Origin': allowed && requestOrigin === allowed ? allowed : allowed || '*',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function lineOaThreadsCandidateResponse(request, env) {
  const data = await listLineOaThreadsCandidate(env, resolveLineOaFloor(request));
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: headers(request, env),
  });
}

export function registerLineOaThreadsShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/line-oa/threads' && env.SHADOW_LINE_OA_THREADS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => lineOaThreadsCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'LINE-OA-THREADS-SHADOW-001',
    path: '/api/line-oa/threads',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_LINE_OA_THREADS_ENABLED',
  });
}
