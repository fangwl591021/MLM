import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const DEFAULT_PUBLIC_BASE_URL = 'https://mlm.fangwl591021.workers.dev';

function stringValue(value) {
  return value == null ? '' : String(value);
}

function publicBaseUrl(env) {
  return stringValue(env.PUBLIC_BASE_URL || env.WORKER_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
}

function normalizeShareFormat(value) {
  return stringValue(value) === 'format2' ? 'format2' : 'format1';
}

function shareFlexAspectRatio(format) {
  return normalizeShareFormat(format) === 'format2' ? '3:4' : '1.91:1';
}

function normalizePurchaseLineUrl(value) {
  const text = stringValue(value).trim();
  if (!text) return '';
  if (!/^https:\/\/(lin\.ee|line\.me|liff\.line\.me)\//i.test(text)) return '';
  return text.slice(0, 500);
}

function normalizeImageUrl(value) {
  const text = stringValue(value);
  if (!text) return '';
  return /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(text) ? text : `${text}.jpg`;
}

export async function getAiWearShareCardCandidate(env, searchParams) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const id = stringValue(searchParams && searchParams.get('id')).trim();
  if (!id || id.includes('..') || id.includes('/')) return null;
  const row = await env.DB.prepare('SELECT id, sharer_name, caption, image_url, purchase_line_url, share_format FROM ai_wear_shares WHERE id = ?').bind(id).first();
  if (!row) return null;
  const shareUrl = `${publicBaseUrl(env)}/ai-wear/share/${encodeURIComponent(id)}`;
  const shareFormat = normalizeShareFormat(row.share_format);
  return {
    id,
    title: row.sharer_name ? `${stringValue(row.sharer_name)} 的 AI 眼鏡試戴` : 'AI 眼鏡試戴分享',
    caption: stringValue(row.caption || '看看我的 AI 眼鏡試戴對照圖。'),
    shareUrl,
    previewUrl: `${shareUrl}/preview`,
    imageUrl: normalizeImageUrl(row.image_url),
    shareFormat,
    flexAspectRatio: shareFlexAspectRatio(shareFormat),
    purchaseLineUrl: normalizePurchaseLineUrl(row.purchase_line_url),
  };
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

export async function aiWearShareCardCandidateResponse(request, env) {
  const data = await getAiWearShareCardCandidate(env, new URL(request.url).searchParams);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAiWearShareCardShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-share-card' && env.SHADOW_AI_WEAR_SHARE_CARD_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => aiWearShareCardCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AI-WEAR-SHARE-CARD-SHADOW-001',
    path: '/api/ai-wear-share-card',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AI_WEAR_SHARE_CARD_ENABLED',
  });
}
