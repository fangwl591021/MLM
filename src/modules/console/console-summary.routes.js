import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import { buildCorsHeaders } from '../frontend/frontend.routes.js';

const FLOOR_MAIN = 'main';
const FLOOR_ADMIN = 'admin';
const FLOOR_SMART = 'smart';
const USER_ROLE = 'user';
const ADMIN_ROLE = 'admin';
const STATUS_PENDING = '待回覆';
const STATUS_IMPORTANT = '待處理';
const STATUS_DONE = '處理完畢';

const text = (value) => String(value ?? '');
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function taipeiStartOfDay(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60 * 1000;
}

async function safeFirst(env, sql, bindings = []) {
  try { return await env.DB.prepare(sql).bind(...bindings).first(); } catch (_) { return null; }
}

async function safeAll(env, sql, bindings = []) {
  try { return (await env.DB.prepare(sql).bind(...bindings).all()).results || []; } catch (_) { return []; }
}

async function countTable(env, table, where = '', bindings = []) {
  const row = await safeFirst(env, `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`, bindings);
  return number(row?.count);
}

async function upcomingCalendar(env, from, limit = 24) {
  const rows = await safeAll(env, `SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, visibility FROM calendar_events WHERE starts_at >= ? ORDER BY starts_at ASC LIMIT ?`, [from, limit]);
  return rows.map((row) => ({
    id: text(row.id), title: text(row.title), description: text(row.description), startsAt: number(row.starts_at),
    endsAt: number(row.ends_at), checkinStartsAt: number(row.checkin_starts_at), checkinEndsAt: number(row.checkin_ends_at),
    location: text(row.location), visibility: text(row.visibility || 'internal'),
  }));
}

async function recentCheckins(env, limit = 12) {
  const rows = await safeAll(env, `SELECT campaign, line_user_id, channel_key, points, event_title, location_name, distance_meters, created_at FROM reward_claims WHERE status = 'success' ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map((row) => ({
    campaign: text(row.campaign), userId: text(row.line_user_id), channelKey: text(row.channel_key), points: number(row.points),
    eventTitle: text(row.event_title), location: text(row.location_name), distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters), createdAt: text(row.created_at),
  }));
}

async function attendanceByEvent(env, limit = 20) {
  const rows = await safeAll(env, `SELECT rc.event_uid, rc.campaign, rc.line_user_id, rc.points, rc.event_title, rc.location_name, rc.created_at, p.display_name AS profile_name, cm.name AS crm_name FROM reward_claims rc LEFT JOIN profiles p ON p.user_id = rc.line_user_id LEFT JOIN crm_members cm ON json_extract(cm.source_json, '$.LINE_user_id') = rc.line_user_id OR json_extract(cm.source_json, '$.user_login') = rc.line_user_id WHERE rc.status = 'success' AND (rc.campaign LIKE 'calendar_%' OR rc.event_uid LIKE 'cal_%') ORDER BY rc.created_at DESC LIMIT 600`);
  const groups = new Map();
  for (const row of rows) {
    const key = text(row.event_uid || row.campaign || row.event_title || 'calendar');
    if (!groups.has(key)) groups.set(key, { eventUid: text(row.event_uid), campaign: text(row.campaign), eventTitle: text(row.event_title) || text(row.campaign) || '課程活動', location: text(row.location_name), latestAt: text(row.created_at), attendeeCount: 0, attendees: [], seen: new Set() });
    const group = groups.get(key); const userId = text(row.line_user_id);
    if (!userId || group.seen.has(userId)) continue;
    group.seen.add(userId);
    group.attendees.push({ userId, name: text(row.crm_name || row.profile_name) || userId.slice(-6), points: number(row.points), checkedAt: text(row.created_at) });
    group.attendeeCount = group.attendees.length;
  }
  return [...groups.values()].slice(0, limit).map(({ seen, ...group }) => group);
}

export async function buildConsoleSummaryCandidate(env, { now = Date.now } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const generatedAt = now();
  const todayStart = taipeiStartOfDay(generatedAt);
  const names = { main: '產品客服', admin: '行政客服', smart: '康立智能' };
  const floors = [];
  for (const floor of [FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART]) {
    const [stats, messages, replies, alerts, latest] = await Promise.all([
      safeFirst(env, `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN risk = 'high' THEN 1 ELSE 0 END) AS high_risk FROM threads WHERE floor_id = ?`, [STATUS_PENDING, STATUS_IMPORTANT, STATUS_DONE, floor]),
      safeFirst(env, 'SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?', [floor, USER_ROLE, todayStart]),
      safeFirst(env, 'SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?', [floor, ADMIN_ROLE, todayStart]),
      safeFirst(env, 'SELECT COUNT(*) AS count FROM ai_logs WHERE floor_id = ? AND created_at >= ?', [floor, todayStart]),
      safeFirst(env, 'SELECT display_name, user_id, summary, last_message_at FROM threads WHERE floor_id = ? ORDER BY last_message_at DESC LIMIT 1', [floor]),
    ]);
    floors.push({ id: floor, name: names[floor], threads: number(stats?.total), pending: number(stats?.pending), done: number(stats?.done), highRisk: number(stats?.high_risk), todayMessages: number(messages?.count), todayReplies: number(replies?.count), aiAlerts: number(alerts?.count), latestThread: latest ? { name: text(latest.display_name) || text(latest.user_id), summary: text(latest.summary), at: number(latest.last_message_at) } : null });
  }
  const calendarUpcomingList = await upcomingCalendar(env, todayStart, 24);
  const [calendarToday, upcomingEvents, registrations, checkins, recent, attendance, members, accounts, ledgerToday] = await Promise.all([
    countTable(env, 'calendar_events', 'starts_at >= ? AND starts_at < ?', [todayStart, todayStart + 86400000]),
    countTable(env, 'calendar_events', 'starts_at >= ?', [todayStart]),
    countTable(env, 'event_registrations', 'registered_at >= ?', [todayStart]),
    countTable(env, 'reward_claims', "status = 'success' AND created_at >= datetime(?, 'unixepoch')", [Math.floor(todayStart / 1000)]),
    recentCheckins(env, 12), attendanceByEvent(env, 20), countTable(env, 'crm_members'), countTable(env, 'point_accounts'),
    countTable(env, 'point_ledger', "created_at >= datetime(?, 'unixepoch')", [Math.floor(todayStart / 1000)]),
  ]);
  const totals = floors.reduce((acc, item) => { for (const key of Object.keys(acc)) acc[key] += item[key]; return acc; }, { threads: 0, pending: 0, done: 0, highRisk: 0, todayMessages: 0, todayReplies: 0, aiAlerts: 0 });
  return { generatedAt, todayStart, totals, floors, calendar: { today: calendarToday, upcoming: calendarUpcomingList }, events: { upcoming: upcomingEvents, registrationsToday: registrations, checkinsToday: checkins, recentCheckins: recent, upcomingCourses: calendarUpcomingList.slice(0, 8), attendanceByEvent: attendance }, pointCrm: { members, pointAccounts: accounts, ledgerToday } };
}

function jsonResponse(payload, request, env) {
  return Response.json(payload, { status: 200, headers: buildCorsHeaders(request, env) });
}

export function registerConsoleSummaryShadowRoute(router, { legacyFetch, summaryReader = buildConsoleSummaryCandidate, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/console/summary' && env.SHADOW_CONSOLE_SUMMARY_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: async () => jsonResponse({ status: 'success', data: await summaryReader(env) }, request, env),
      compareOptions: { ignoredBodyPaths: ['data.generatedAt'] },
      logger,
    });
    return result.response;
  }, { id: 'CONSOLE-SUMMARY-SHADOW-001', path: '/api/console/summary', risk: 'medium', write: false, mode: 'shadow-read', featureFlag: 'SHADOW_CONSOLE_SUMMARY_ENABLED' });
}
