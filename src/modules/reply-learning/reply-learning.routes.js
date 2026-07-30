import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function clampLimit(value) {
  const number = Number(value || 50);
  if (!Number.isFinite(number)) return 50;
  return Math.max(1, Math.min(200, Math.floor(number)));
}

function stringValue(value) {
  return value == null ? '' : String(value);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function resolveFloor(request) {
  const url = new URL(request.url);
  const requested = stringValue(url.searchParams.get('floor') || request.headers.get('X-Floor-Id'));
  return ['main', 'admin', 'smart'].includes(requested) ? requested : 'main';
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

export async function fetchReplyLearningCandidate(env, request) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const url = new URL(request.url);
  const floor = resolveFloor(request);
  const limit = clampLimit(url.searchParams.get('limit'));
  const [countRow, rows] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM reply_learning WHERE floor_id = ?').bind(floor).first(),
    env.DB.prepare(`
      SELECT learning_key, floor_id, user_name, user_text, reply_text, category, tags, source, quality, use_count, created_at, updated_at
      FROM reply_learning
      WHERE floor_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(floor, limit).all(),
  ]);
  return {
    count: numberOrZero(countRow && countRow.count),
    items: (rows.results || []).map((row) => ({
      learning_key: stringValue(row.learning_key),
      floor_id: stringValue(row.floor_id),
      user_name: stringValue(row.user_name),
      user_text: stringValue(row.user_text),
      reply_text: stringValue(row.reply_text),
      category: stringValue(row.category),
      tags: stringValue(row.tags),
      source: stringValue(row.source),
      quality: stringValue(row.quality),
      use_count: numberOrZero(row.use_count),
      created_at: numberOrZero(row.created_at),
      updated_at: numberOrZero(row.updated_at),
    })),
  };
}

export async function replyLearningCandidateResponse(request, env) {
  const learning = await fetchReplyLearningCandidate(env, request);
  return new Response(JSON.stringify({ status: 'success', ...learning }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerReplyLearningShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/reply-learning' && env.SHADOW_REPLY_LEARNING_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => replyLearningCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'REPLY-LEARNING-SHADOW-001',
    path: '/api/reply-learning',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_REPLY_LEARNING_ENABLED',
  });
}
