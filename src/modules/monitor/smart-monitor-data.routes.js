import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import { listPointStatsDataCandidate, pointStatsUserNameSql } from '../points/point-stats-data.routes.js';

const POINT_OA1 = 'oa1';
const FLOOR_MAIN = 'main';
const USER_ROLE = 'user';
const ADMIN_ROLE = 'admin';
const STATUS_PENDING = '待回覆';
const STATUS_IMPORTANT = '待處理';
const STATUS_DONE = '處理完畢';
const SOURCE_META = { label: '康立智能', shopId: 1086, loginUrl: 'https://k-link.cc/index.php/line_login/1086/', canGrant: true };

function stringValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function taipeiDate(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function addDaysDateString(value, days) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + Number(days || 0) * 86400000);
  return date.toISOString().slice(0, 10);
}

function taipeiStartOfDay(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value)).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60 * 1000;
}

function normalizeStatusForDisplay(status) {
  const value = stringValue(status);
  if (!value || value === 'pending') return STATUS_PENDING;
  if (value === 'important') return STATUS_IMPORTANT;
  if (value === 'done') return STATUS_DONE;
  return value;
}

function formatTaipeiTimestamp(value) {
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number) : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function pointStatsMemberName(row) {
  const name = stringValue(row && row.user_name);
  if (name) return name;
  const uid = stringValue(row && row.line_user_id);
  return uid ? `${uid.slice(0, 10)}...${uid.slice(-6)}` : '未命名會員';
}

export async function listSmartMonitorDataCandidate(env, url, { now = Date.now } = {}) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const days = clampNumber(url.searchParams.get('days') || 7, 1, 90);
  const statsUrl = new URL('https://local/admin/points/stats-data');
  statsUrl.searchParams.set('days', String(days));
  statsUrl.searchParams.set('scope', 'ops');
  statsUrl.searchParams.set('channel_key', POINT_OA1);
  statsUrl.searchParams.set('point_type', 'gift_money');
  const stats = await listPointStatsDataCandidate(env, statsUrl, { now });

  const current = now();
  const date = stringValue(url.searchParams.get('date') || taipeiDate(current)).slice(0, 10);
  const nextDate = addDaysDateString(date, 1);
  const checkinRows = await env.DB.prepare(`
    WITH checkins AS (
      SELECT line_user_id, '' AS master_member_ref, COUNT(*) AS hits,
             MIN(datetime(line_timestamp/1000,'unixepoch','+8 hours')) AS first_tw,
             MAX(datetime(line_timestamp/1000,'unixepoch','+8 hours')) AS last_tw
      FROM webhook_events
      WHERE channel_key = ? AND message_type = 'text' AND message_text = '會員打卡'
        AND line_timestamp >= strftime('%s', ?, '-8 hours') * 1000
        AND line_timestamp < strftime('%s', ?, '-8 hours') * 1000
      GROUP BY line_user_id
    ), rewards AS (
      SELECT line_user_id, SUM(points) AS points, MAX(balance_after) AS balance_after, MAX(updated_at) AS updated_at
      FROM daily_keyword_rewards
      WHERE reward_date = ? AND channel_key = ? AND point_type = 'gift_money' AND status = 'claimed'
      GROUP BY line_user_id
    )
    SELECT c.line_user_id, ${pointStatsUserNameSql('c')} AS user_name, c.hits, c.first_tw, c.last_tw,
           COALESCE(r.points,0) AS points, r.balance_after, r.updated_at,
           CASE WHEN r.line_user_id IS NULL THEN 1 ELSE 0 END AS missing
    FROM checkins c LEFT JOIN rewards r ON r.line_user_id = c.line_user_id
    ORDER BY c.first_tw DESC LIMIT 240
  `).bind(POINT_OA1, `${date} 00:00:00`, `${nextDate} 00:00:00`, date, POINT_OA1).all();

  const checkins = (checkinRows.results || []).map((row) => ({
    line_user_id: stringValue(row.line_user_id), user_name: pointStatsMemberName(row), hits: Number(row.hits || 0),
    first_tw: stringValue(row.first_tw), last_tw: stringValue(row.last_tw), points: Number(row.points || 0),
    balance_after: Number(row.balance_after || 0), updated_at: stringValue(row.updated_at), missing: Boolean(row.missing),
  }));
  const checkinSummary = checkins.reduce((sum, row) => {
    sum.users += 1; sum.messages += row.hits;
    if (row.missing) sum.missing += 1;
    else { sum.rewarded += 1; sum.points += row.points; }
    return sum;
  }, { date, users: 0, messages: 0, rewarded: 0, missing: 0, points: 0 });

  const todayStart = taipeiStartOfDay(current);
  const [chatStats, todayUserMessages, todayAdminReplies, recentThreads] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN risk = 'high' THEN 1 ELSE 0 END) AS high_risk FROM threads WHERE floor_id = ?`).bind(STATUS_PENDING, STATUS_IMPORTANT, STATUS_DONE, FLOOR_MAIN).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?').bind(FLOOR_MAIN, USER_ROLE, todayStart).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?').bind(FLOOR_MAIN, ADMIN_ROLE, todayStart).first(),
    env.DB.prepare(`SELECT t.id, t.user_id, t.display_name, t.summary, t.status, t.risk, t.last_message_at,
      (SELECT m.text FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id ORDER BY m.created_at DESC LIMIT 1) AS latest_text,
      (SELECT m.sender_role FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id ORDER BY m.created_at DESC LIMIT 1) AS latest_sender,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id) AS message_count
      FROM threads t WHERE t.floor_id = ? ORDER BY t.last_message_at DESC LIMIT 80`).bind(FLOOR_MAIN).all(),
  ]);

  const threads = (recentThreads.results || []).map((row) => ({
    id: stringValue(row.id), user_id: stringValue(row.user_id), display_name: stringValue(row.display_name) || stringValue(row.user_id),
    summary: stringValue(row.summary), status: normalizeStatusForDisplay(row.status), risk: stringValue(row.risk) || 'low',
    last_message_at: Number(row.last_message_at || 0), last_message_at_text: row.last_message_at ? formatTaipeiTimestamp(row.last_message_at) : '-',
    latest_text: stringValue(row.latest_text), latest_sender: stringValue(row.latest_sender), message_count: Number(row.message_count || 0),
  }));

  return {
    source: SOURCE_META, days, stats, checkinSummary, checkins,
    chatMonitor: {
      floor: FLOOR_MAIN, label: '康立智能聊天室', total: Number(chatStats && chatStats.total || 0),
      pending: Number(chatStats && chatStats.pending || 0), done: Number(chatStats && chatStats.done || 0),
      high_risk: Number(chatStats && chatStats.high_risk || 0), today_user_messages: Number(todayUserMessages && todayUserMessages.count || 0),
      today_admin_replies: Number(todayAdminReplies && todayAdminReplies.count || 0), threads,
    },
  };
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedOrigin = env.ALLOWED_ORIGIN || '';
  return { 'Access-Control-Allow-Origin': allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin || '*', 'Content-Type': 'application/json; charset=utf-8' };
}

export async function smartMonitorDataCandidateResponse(request, env, options = {}) {
  const data = await listSmartMonitorDataCandidate(env, new URL(request.url), options);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), { status: 200, headers: buildCorsHeaders(request, env) });
}

export function registerSmartMonitorDataShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/smart-monitor-data' && env.SHADOW_SMART_MONITOR_DATA_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({ legacy: () => legacyFetch(request, env, ctx), candidate: () => smartMonitorDataCandidateResponse(request, env, { now }), logger, allowedStatuses: [200] });
    return result.response;
  }, { id: 'SMART-MONITOR-DATA-SHADOW-001', path: '/admin/smart-monitor-data', risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_SMART_MONITOR_DATA_ENABLED' });
}
