import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const DEFAULT_CALENDAR_POINTS = 10;
const DEFAULT_CHECKIN_EARLY_MINUTES = 90;

function stringValue(value) {
  return value == null ? '' : String(value);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function taipeiStartOfDay(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60 * 1000;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function calendarDefaultPoints(env) {
  return positiveNumber(env.REWARD_CALENDAR_DEFAULT_POINTS, DEFAULT_CALENDAR_POINTS);
}

function checkinEarlyMinutes(env) {
  const value = Number(env.REWARD_CHECKIN_EARLY_MINUTES);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : DEFAULT_CHECKIN_EARLY_MINUTES;
}

function rewardPointsFromEvent(env, event) {
  const text = `${event.summary || ''}\n${event.description || ''}`;
  const match = text.match(/(?:K點|點數|贈點|points?)\s*[:：]?\s*(\d+(?:\.\d+)?)/i)
    || text.match(/(\d+(?:\.\d+)?)\s*(?:K點|點)/i);
  const points = match ? Number(match[1]) : calendarDefaultPoints(env);
  return Number.isFinite(points) && points > 0 ? points : calendarDefaultPoints(env);
}

function checkinWindow(env, event) {
  const eventStartsAt = numberOrZero(event.startsAt);
  const configuredStartsAt = numberOrZero(event.checkinStartsAt);
  const fallbackStartsAt = eventStartsAt ? eventStartsAt - checkinEarlyMinutes(env) * 60 * 1000 : 0;
  const startsAt = configuredStartsAt && (!eventStartsAt || configuredStartsAt < eventStartsAt)
    ? configuredStartsAt
    : fallbackStartsAt;
  const endsAt = numberOrZero(event.checkinEndsAt) || numberOrZero(event.endsAt);
  return { startsAt, endsAt };
}

function rowToEvent(row) {
  const startsAt = numberOrZero(row && row.starts_at);
  const endsAt = numberOrZero(row && row.ends_at) || (startsAt ? startsAt + 90 * 60 * 1000 : 0);
  return {
    uid: stringValue(row && row.id),
    summary: stringValue(row && row.title),
    description: stringValue(row && row.description),
    location: stringValue(row && row.location),
    startsAt,
    endsAt,
    checkinStartsAt: numberOrZero(row && row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row && row.checkin_ends_at),
  };
}

export function publicRewardCalendarEvent(event, env = {}, now = Date.now()) {
  const window = checkinWindow(env, event);
  return {
    uid: event.uid,
    title: event.summary,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    checkinStartsAt: window.startsAt,
    checkinEndsAt: window.endsAt,
    active: window.startsAt <= now && window.endsAt >= now,
    points: rewardPointsFromEvent(env, event),
    distanceMeters: null,
  };
}

export async function listRewardCalendarEventsCandidate(env, { now = Date.now } = {}) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const current = now();
  const from = taipeiStartOfDay(current) - 86400000;
  const rows = await env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location
    FROM calendar_events
    WHERE starts_at >= ?
    ORDER BY starts_at ASC
    LIMIT 300
  `).bind(from).all();
  return (rows.results || [])
    .map(rowToEvent)
    .filter((event) => event.startsAt && event.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((event) => publicRewardCalendarEvent(event, env, current));
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

export async function rewardCalendarEventsCandidateResponse(request, env, options = {}) {
  const events = await listRewardCalendarEventsCandidate(env, options);
  return new Response(JSON.stringify({ success: true, status: 'success', events }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerRewardCalendarEventsShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/reward/calendar-events' && env.SHADOW_REWARD_CALENDAR_EVENTS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => rewardCalendarEventsCandidateResponse(request, env, { now }),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'REWARD-CALENDAR-EVENTS-SHADOW-001',
    path: '/api/reward/calendar-events',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_REWARD_CALENDAR_EVENTS_ENABLED',
  });
}
