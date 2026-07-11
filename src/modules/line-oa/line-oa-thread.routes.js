import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const FLOOR_MAIN = 'main';
const FLOOR_IDS = new Set(['main', 'admin', 'smart']);
const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';
const STATUS_PENDING = '待回覆';
const STATUS_IMPORTANT = '待處理';
const STATUS_DONE = '處理完畢';
const PENDING_DISPLAY_NAME = '名稱待同步';

function stringValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function resolveFloor(request) {
  const url = new URL(request.url);
  const raw = stringValue(url.searchParams.get('floor') || request.headers.get('x-floor-id') || FLOOR_MAIN).toLowerCase();
  return FLOOR_IDS.has(raw) ? raw : FLOOR_MAIN;
}

function threadIdFor(floor, userId) {
  return floor === FLOOR_MAIN ? `user:${userId}` : `${floor}:user:${userId}`;
}

function normalizeStatusForDisplay(status) {
  const value = stringValue(status);
  if (!value || value === 'pending') return STATUS_PENDING;
  if (value === 'important') return STATUS_IMPORTANT;
  if (value === 'done') return STATUS_DONE;
  return value;
}

function isPlaceholderName(value, userId) {
  const text = stringValue(value);
  return !text || text === stringValue(userId) || /^U[a-z0-9]{8,}$/i.test(text) || /^user\s*[a-z0-9]{4,}$/i.test(text) || /^用戶\s*[a-z0-9]{4,}$/i.test(text);
}

function chooseStableName(userId, incomingName, currentName) {
  const incoming = stringValue(incomingName);
  const current = stringValue(currentName);
  if (incoming && !isPlaceholderName(incoming, userId)) return incoming;
  if (current && !isPlaceholderName(current, userId)) return current;
  return '';
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  return stringValue(value).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(stringValue).filter(Boolean) : [];
  } catch (_error) {
    return normalizeTags(value);
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeStoredLinePayload(rawJson, fallbackType = 'text') {
  const raw = rawJson && typeof rawJson === 'object' ? rawJson : {};
  if (Array.isArray(raw.lineMessages)) return { direction: raw.direction || 'outgoing', messages: raw.lineMessages };
  if (Array.isArray(raw.messages)) return { direction: raw.direction || 'outgoing', messages: raw.messages };
  if (raw.lineMessage && typeof raw.lineMessage === 'object') return { direction: raw.direction || 'outgoing', messages: [raw.lineMessage] };
  if (raw.message && typeof raw.message === 'object') return { direction: raw.direction || 'incoming', messages: [raw.message] };
  if (raw.type && raw.type !== 'message') return { direction: raw.direction || 'outgoing', messages: [raw] };
  if (fallbackType && fallbackType !== 'text') return { direction: raw.direction || 'unknown', messages: [{ type: fallbackType }] };
  return null;
}

function normalizeTextKeyword(value) {
  return stringValue(value).replace(/\s+/g, '').toLowerCase();
}

function isMonitorHiddenMessage(message) {
  return stringValue(message && message.floor_id) === FLOOR_MAIN
    && normalizeTextKeyword(message && message.text) === normalizeTextKeyword('簽到贈K點');
}

function messageFromD1(thread, message) {
  const suggestions = parseJsonArray(message.suggestions);
  const rawJson = parseJsonObject(message.raw_json);
  const linePayload = normalizeStoredLinePayload(rawJson, message.message_type);
  const raw = {
    時間: message.created_at,
    身份: message.sender_role === ADMIN_ROLE ? 'admin' : 'user',
    用戶ID: message.user_id,
    floor: thread.floor_id || FLOOR_MAIN,
    內容: message.text,
    類別: message.category,
    AI建議: JSON.stringify(suggestions),
    重要: message.important ? '是' : '否',
    情緒: message.sentiment || 'neutral',
    狀態: normalizeStatusForDisplay(thread.status),
    用戶名稱: thread.display_name || '',
    頭像URL: thread.picture_url || '',
    LINEPayload: linePayload,
  };
  return {
    id: message.id,
    type: message.message_type || 'text',
    senderRole: message.sender_role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
    senderId: message.user_id,
    senderName: message.sender_role === ADMIN_ROLE ? '管理員' : (chooseStableName(thread.user_id, thread.display_name, '') || PENDING_DISPLAY_NAME),
    text: message.text,
    createdAt: message.created_at,
    category: message.category,
    suggestions,
    important: Boolean(message.important),
    rawJson,
    linePayload,
    raw,
  };
}

function threadFromD1(row, messages) {
  const tags = parseJsonArray(row.tags);
  const name = chooseStableName(row.user_id, row.display_name, row.profile_display_name)
    || chooseStableName(row.user_id, row.linked_display_name, '')
    || PENDING_DISPLAY_NAME;
  return {
    id: row.id,
    floor: row.floor_id || FLOOR_MAIN,
    userId: row.user_id,
    name,
    displayName: name,
    pictureUrl: stringValue(row.picture_url || row.profile_picture_url || row.linked_picture_url),
    summary: stringValue(row.summary),
    status: normalizeStatusForDisplay(row.status),
    risk: row.risk || 'low',
    profileStatus: row.profile_status || null,
    profileError: stringValue(row.profile_error),
    lastProfileSync: Number(row.last_profile_sync || 0),
    tags,
    note: stringValue(row.note),
    lastMessageAt: Number(row.last_message_at || 0),
    hasRealName: !isPlaceholderName(name, row.user_id),
    messages: messages.map((message) => messageFromD1(row, message)),
  };
}

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
  return threadFromD1(row, (messages.results || []).filter((message) => !isMonitorHiddenMessage(message)));
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
  const floor = resolveFloor(request);
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
