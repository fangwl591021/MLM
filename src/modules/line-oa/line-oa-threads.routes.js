import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const FLOORS = new Set(['main', 'admin', 'smart']);
const FLOOR_MAIN = 'main';
const FLOOR_ADMIN = 'admin';
const ADMIN_ROLE = 'admin';
const STATUS = { pending: '待回覆', important: '待處理', done: '處理完畢' };
const PENDING_NAME = '名稱待同步';

const text = (v) => String(v ?? '').trim();
const parseArray = (v) => { if (Array.isArray(v)) return v.map(text).filter(Boolean); try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p.map(text).filter(Boolean) : []; } catch { return text(v).split(/[,，]/).map(text).filter(Boolean); } };
const parseObject = (v) => { try { const p = JSON.parse(v || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } };
const placeholder = (v, uid) => { const s = text(v); return !s || s === text(uid) || /^U[a-z0-9]{8,}$/i.test(s) || /^user\s*[a-z0-9]{4,}$/i.test(s) || /^用戶\s*[a-z0-9]{4,}$/i.test(s); };
const stableName = (uid, a, b) => (!placeholder(a, uid) ? text(a) : !placeholder(b, uid) ? text(b) : '');
const statusText = (v) => STATUS[text(v)] || text(v) || STATUS.pending;
const linePayload = (raw, fallback = 'text') => {
  if (Array.isArray(raw.lineMessages)) return { direction: raw.direction || 'outgoing', messages: raw.lineMessages };
  if (Array.isArray(raw.messages)) return { direction: raw.direction || 'outgoing', messages: raw.messages };
  if (raw.lineMessage && typeof raw.lineMessage === 'object') return { direction: raw.direction || 'outgoing', messages: [raw.lineMessage] };
  if (raw.message && typeof raw.message === 'object') return { direction: raw.direction || 'incoming', messages: [raw.message] };
  if (raw.type && raw.type !== 'message') return { direction: raw.direction || 'outgoing', messages: [raw] };
  return fallback && fallback !== 'text' ? { direction: raw.direction || 'unknown', messages: [{ type: fallback }] } : null;
};
const hidden = (m) => text(m.floor_id) === FLOOR_MAIN && text(m.text).replace(/\s+/g, '').toLowerCase() === '簽到贈k點'.toLowerCase();

function messageFromD1(thread, m) {
  const suggestions = parseArray(m.suggestions); const rawJson = parseObject(m.raw_json); const payload = linePayload(rawJson, m.message_type);
  return { id: m.id, type: m.message_type || 'text', senderRole: m.sender_role === ADMIN_ROLE ? ADMIN_ROLE : 'user', senderId: m.user_id,
    senderName: m.sender_role === ADMIN_ROLE ? '管理員' : (stableName(thread.user_id, thread.display_name, '') || PENDING_NAME), text: m.text,
    createdAt: m.created_at, category: m.category, suggestions, important: Boolean(m.important), rawJson, linePayload: payload,
    raw: { 時間: m.created_at, 身份: m.sender_role === ADMIN_ROLE ? 'admin' : 'user', 用戶ID: m.user_id, floor: thread.floor_id || FLOOR_MAIN,
      內容: m.text, 類別: m.category, AI建議: JSON.stringify(suggestions), 重要: m.important ? '是' : '否', 情緒: m.sentiment || 'neutral',
      狀態: statusText(thread.status), 用戶名稱: thread.display_name || '', 頭像URL: thread.picture_url || '', LINEPayload: payload } };
}
function threadFromD1(row, messages) {
  const name = stableName(row.user_id, row.display_name, row.profile_display_name) || stableName(row.user_id, row.linked_display_name, '') || PENDING_NAME;
  return { id: row.id, floor: row.floor_id || FLOOR_MAIN, userId: row.user_id, name, displayName: name,
    pictureUrl: text(row.picture_url || row.profile_picture_url || row.linked_picture_url), summary: text(row.summary), status: statusText(row.status),
    risk: row.risk || 'low', profileStatus: row.profile_status || null, profileError: text(row.profile_error), lastProfileSync: Number(row.last_profile_sync || 0),
    tags: parseArray(row.tags), note: text(row.note), lastMessageAt: Number(row.last_message_at || 0), hasRealName: !placeholder(name, row.user_id),
    messages: messages.map((m) => messageFromD1(row, m)) };
}
const chunks = (items, size = 50) => { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; };
function resolveFloor(request) { const url = new URL(request.url); const f = text(url.searchParams.get('floor') || request.headers.get('x-floor-id') || FLOOR_MAIN).toLowerCase(); return FLOORS.has(f) ? f : FLOOR_MAIN; }

export async function listLineOaThreadsCandidate(env, floor = FLOOR_MAIN, limit = 120) {
  if (!env.DB?.prepare) throw new Error('DB is not configured');
  const queryLimit = floor === FLOOR_ADMIN ? Math.min(Number(limit || 120) + 500, 800) : limit;
  let rows = (await env.DB.prepare(`SELECT t.*, p.display_name AS profile_display_name, p.picture_url AS profile_picture_url,
    (SELECT tx.display_name FROM threads tx WHERE tx.user_id=t.user_id AND tx.display_name<>'' AND tx.display_name<>tx.user_id ORDER BY tx.updated_at DESC LIMIT 1) AS linked_display_name,
    (SELECT tx.picture_url FROM threads tx WHERE tx.user_id=t.user_id AND tx.picture_url<>'' ORDER BY tx.updated_at DESC LIMIT 1) AS linked_picture_url,
    p.profile_status, p.profile_error, p.last_profile_sync FROM threads t LEFT JOIN profiles p ON p.user_id=t.user_id
    WHERE t.floor_id=? ORDER BY t.last_message_at DESC, t.updated_at DESC LIMIT ?`).bind(floor, queryLimit).all()).results || [];
  if (floor === FLOOR_ADMIN) {
    const suspects = rows.filter((r) => !text(r.display_name) && !text(r.picture_url) && Number(r.profile_status || 0) === 404 && text(r.user_id));
    const gateway = new Set();
    for (const batch of chunks([...new Set(suspects.map((r) => text(r.user_id))) ])) {
      const qs = batch.map(() => '?').join(',');
      const found = await env.DB.prepare(`SELECT DISTINCT line_user_id FROM webhook_events WHERE channel_key IN (?, ?) AND line_user_id IN (${qs})`).bind('oa1', 'oa2', ...batch).all();
      for (const r of found.results || []) gateway.add(text(r.line_user_id));
    }
    rows = rows.filter((r) => !(!text(r.display_name) && !text(r.picture_url) && Number(r.profile_status || 0) === 404 && gateway.has(text(r.user_id))));
  }
  const ids = rows.map((r) => r.id); const messages = [];
  for (const batch of chunks(ids)) { const qs = batch.map(() => '?').join(','); const found = await env.DB.prepare(`SELECT * FROM messages WHERE thread_id IN (${qs}) ORDER BY created_at ASC`).bind(...batch).all(); messages.push(...(found.results || [])); }
  const byId = new Map(ids.map((id) => [id, []]));
  for (const m of messages) if (!hidden(m)) { if (!byId.has(m.thread_id)) byId.set(m.thread_id, []); byId.get(m.thread_id).push(m); }
  return rows.map((r) => threadFromD1(r, byId.get(r.id) || [])).filter((t) => t.messages.length > 0);
}

function headers(request, env) { const req = request.headers.get('Origin') || ''; const allowed = env.ALLOWED_ORIGIN || ''; return { 'Access-Control-Allow-Origin': allowed && req === allowed ? allowed : allowed || '*', 'Content-Type': 'application/json; charset=utf-8' }; }
export async function lineOaThreadsCandidateResponse(request, env) { const data = await listLineOaThreadsCandidate(env, resolveFloor(request)); return new Response(JSON.stringify({ success: true, status: 'success', data }), { status: 200, headers: headers(request, env) }); }
export function registerLineOaThreadsShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _r, env) => url.pathname === '/api/line-oa/threads' && env.SHADOW_LINE_OA_THREADS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({ legacy: () => legacyFetch(request, env, ctx), candidate: () => lineOaThreadsCandidateResponse(request, env), logger, allowedStatuses: [200] });
    return result.response;
  }, { id: 'LINE-OA-THREADS-SHADOW-001', path: '/api/line-oa/threads', risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_LINE_OA_THREADS_ENABLED' });
}
