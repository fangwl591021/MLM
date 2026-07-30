import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listRewardCalendarEventsCandidate,
  publicRewardCalendarEvent,
  registerRewardCalendarEventsShadowRoute,
} from '../src/modules/reward/reward-calendar-events.routes.js';

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return this;
        },
        async all() { return { results: rows }; },
      };
    },
  };
}

test('reward calendar candidate is pure select and uses Taipei previous-day boundary', async () => {
  const now = Date.parse('2026-07-11T10:30:00+08:00');
  const DB = fakeDb([{
    id: 'event-1', title: '活動一', description: '贈點：12 K點', location: '台北',
    starts_at: now + 3600000, ends_at: 0, checkin_starts_at: 0, checkin_ends_at: 0,
  }]);
  const events = await listRewardCalendarEventsCandidate({ DB }, { now: () => now });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /^\s*SELECT\b/i);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.match(DB.calls[0].sql, /WHERE starts_at >= \?/);
  assert.match(DB.calls[0].sql, /ORDER BY starts_at ASC/);
  assert.match(DB.calls[0].sql, /LIMIT 300/);
  assert.deepEqual(DB.calls[0].bindings, [Date.parse('2026-07-09T16:00:00Z')]);
  assert.equal(events[0].endsAt, now + 3600000 + 90 * 60 * 1000);
  assert.equal(events[0].points, 12);
});

test('public reward event preserves configured checkin window and active state', () => {
  const now = 10_000;
  const data = publicRewardCalendarEvent({
    uid: 'event-2', summary: '課程', description: '', location: '台中',
    startsAt: 12_000, endsAt: 20_000, checkinStartsAt: 9_000, checkinEndsAt: 18_000,
  }, {}, now);
  assert.deepEqual(data, {
    uid: 'event-2', title: '課程', location: '台中', startsAt: 12_000, endsAt: 20_000,
    checkinStartsAt: 9_000, checkinEndsAt: 18_000, active: true, points: 10, distanceMeters: null,
  });
});

test('public reward event falls back to early minutes and configured default points', () => {
  const startsAt = 1_000_000;
  const data = publicRewardCalendarEvent({
    uid: 'event-3', summary: '一般活動', description: '', location: '',
    startsAt, endsAt: startsAt + 3_600_000, checkinStartsAt: startsAt + 1_000, checkinEndsAt: 0,
  }, { REWARD_CHECKIN_EARLY_MINUTES: '30', REWARD_CALENDAR_DEFAULT_POINTS: '15' }, startsAt - 15 * 60 * 1000);
  assert.equal(data.checkinStartsAt, startsAt - 30 * 60 * 1000);
  assert.equal(data.checkinEndsAt, startsAt + 3_600_000);
  assert.equal(data.active, true);
  assert.equal(data.points, 15);
});

test('reward calendar point parsing and checkin fallback match legacy rules', () => {
  const startsAt = 2_000_000;
  const base = { uid: 'event-4', summary: '', location: '', startsAt, endsAt: startsAt + 60_000, checkinStartsAt: 0, checkinEndsAt: 0 };
  assert.equal(publicRewardCalendarEvent({ ...base, description: '本場 points: 7.5' }, {}, startsAt).points, 7.5);
  assert.equal(publicRewardCalendarEvent({ ...base, description: '完成可獲 6 K點' }, {}, startsAt).points, 6);
  assert.equal(publicRewardCalendarEvent({ ...base, description: '贈點：0' }, { REWARD_CALENDAR_DEFAULT_POINTS: '11' }, startsAt).points, 11);
  const laterConfiguredStart = publicRewardCalendarEvent({ ...base, description: '', checkinStartsAt: startsAt + 1 }, { REWARD_CHECKIN_EARLY_MINUTES: '45' }, startsAt);
  assert.equal(laterConfiguredStart.checkinStartsAt, startsAt - 45 * 60 * 1000);
});

test('reward calendar filters invalid rows and sorts by startsAt', async () => {
  const now = Date.parse('2026-07-11T10:30:00+08:00');
  const DB = fakeDb([
    { id: 'late', title: '晚場', description: '', location: '', starts_at: now + 20_000, ends_at: now + 30_000, checkin_starts_at: 0, checkin_ends_at: 0 },
    { id: 'invalid', title: '無效', description: '', location: '', starts_at: 0, ends_at: 0, checkin_starts_at: 0, checkin_ends_at: 0 },
    { id: 'early', title: '早場', description: '', location: '', starts_at: now + 10_000, ends_at: now + 15_000, checkin_starts_at: 0, checkin_ends_at: 0 },
  ]);
  const events = await listRewardCalendarEventsCandidate({ DB }, { now: () => now });
  assert.deepEqual(events.map((event) => event.uid), ['early', 'late']);
});

test('reward calendar flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, events: [] }); };
  registerRewardCalendarEventsShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/reward/calendar-events'), {
    SHADOW_REWARD_CALENDAR_EVENTS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('reward calendar candidate runs after legacy 200 and external response remains legacy', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  const legacyBody = { success: true, status: 'success', events: [{ uid: 'legacy' }] };
  registerRewardCalendarEventsShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
    now: () => Date.parse('2026-07-11T10:30:00+08:00'),
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reward/calendar-events'), {
    SHADOW_REWARD_CALENDAR_EVENTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('reward calendar candidate does not query D1 when legacy fails', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerRewardCalendarEventsShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 500 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reward/calendar-events'), {
    SHADOW_REWARD_CALENDAR_EVENTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 500);
  assert.equal(DB.calls.length, 0);
});

test('reward calendar route metadata is read-only', () => {
  const router = createRouter();
  registerRewardCalendarEventsShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'REWARD-CALENDAR-EVENTS-SHADOW-001', path: '/api/reward/calendar-events',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_REWARD_CALENDAR_EVENTS_ENABLED',
  }]);
});
