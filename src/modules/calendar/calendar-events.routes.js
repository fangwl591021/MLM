import { runShadowRead } from '../../shadow/shadow-compare.js';

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

function mapEvent(row) {
  return {
    id: stringValue(row && row.id),
    title: stringValue(row && row.title),
    description: stringValue(row && row.description),
    startsAt: numberOrZero(row && row.starts_at),
    endsAt: numberOrZero(row && row.ends_at),
    checkinStartsAt: numberOrZero(row && row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row && row.checkin_ends_at),
    location: stringValue(row && row.location),
    visibility: stringValue((row && row.visibility) || 'internal'),
    updatedAt: numberOrZero(row && row.updated_at),
  };
}

export async function listCalendarEventsCandidate(env, url, { now = Date.now } = {}) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const from = Number(url.searchParams.get('from')) || taipeiStartOfDay(now()) - 30 * 86400000;
  const to = Number(url.searchParams.get('to')) || 0;
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
  const where = to > from ? 'starts_at >= ? AND starts_at < ?' : 'starts_at >= ?';
  const statement = env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, visibility, updated_at
    FROM calendar_events
    WHERE ${where}
    ORDER BY starts_at ASC
    LIMIT ?
  `);
  const rows = to > from
    ? await statement.bind(from, to, limit).all()
    : await statement.bind(from, limit).all();
  return (rows.results || []).map(mapEvent);
}

export async function calendarEventsCandidateResponse(request, env, options = {}) {
  const events = await listCalendarEventsCandidate(env, new URL(request.url), options);
  return new Response(JSON.stringify({ status: 'success', events }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerCalendarEventsShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/calendar/events' && env.SHADOW_CALENDAR_EVENTS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowRead({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => calendarEventsCandidateResponse(request, env, { now }),
      logger,
      runCandidateWhen: (legacyResponse) => legacyResponse.status >= 200 && legacyResponse.status < 300,
    });
    return result.response;
  }, {
    id: 'CALENDAR-EVENTS-SHADOW-001',
    path: '/api/calendar/events',
    risk: 'medium',
    write: false,
    mode: 'shadow-read',
    featureFlag: 'SHADOW_CALENDAR_EVENTS_ENABLED',
  });
}
