import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listCalendarEventsCandidate,
  registerCalendarEventsShadowRoute,
} from '../src/modules/calendar/calendar-events.routes.js';

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
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

test('calendar candidate preserves query defaults, ordering and response mapping', async () => {
  const DB = fakeDb([{
    id: 'cal_1', title: '課程', description: '說明', starts_at: 100, ends_at: 200,
    checkin_starts_at: 50, checkin_ends_at: 180, location: '台北', visibility: 'public', updated_at: 90,
  }]);
  const url = new URL('https://example.test/api/calendar/events?from=10&to=500&limit=999');
  const events = await listCalendarEventsCandidate({ DB }, url, { now: () => 1 });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /ORDER BY starts_at ASC/);
  assert.deepEqual(DB.calls[0].bindings, [10, 500, 500]);
  assert.deepEqual(events, [{
    id: 'cal_1', title: '課程', description: '說明', startsAt: 100, endsAt: 200,
    checkinStartsAt: 50, checkinEndsAt: 180, location: '台北', visibility: 'public', updatedAt: 90,
  }]);
});

test('calendar shadow route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let legacyCalls = 0;
  registerCalendarEventsShadowRoute(router, {
    legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'success', events: [] }); },
  });
  const app = createApp({ router, legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'success', events: [] }); } });
  const response = await app.fetch(new Request('https://example.test/api/calendar/events'), {
    SHADOW_CALENDAR_EVENTS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(legacyCalls, 1);
});

test('calendar shadow candidate runs only after successful legacy authorization', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  let legacyCalls = 0;
  registerCalendarEventsShadowRoute(router, {
    legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'success', events: [] }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/calendar/events'), {
    SHADOW_CALENDAR_EVENTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(legacyCalls, 1);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), { status: 'success', events: [] });
});

test('calendar candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerCalendarEventsShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error', message: 'unauthorized' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/calendar/events'), {
    SHADOW_CALENDAR_EVENTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('calendar shadow route metadata is read-only', () => {
  const router = createRouter();
  registerCalendarEventsShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'CALENDAR-EVENTS-SHADOW-001', path: '/api/calendar/events',
    risk: 'medium', write: false, mode: 'shadow-read', featureFlag: 'SHADOW_CALENDAR_EVENTS_ENABLED',
  }]);
});
