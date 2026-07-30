import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import { listPointObservationsCandidate, registerPointObservationsShadowRoute } from '../src/modules/points/point-observations.routes.js';

function db(rows, calls) {
  return { prepare(sql) {
    assert.match(sql, /^\s*SELECT\b/i);
    assert.doesNotMatch(sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
    return { bind(...values) { calls.push({ sql, values }); return { all: async () => ({ results: rows }) }; } };
  } };
}

test('point observations supports channel filter and clamps limit', async () => {
  const calls = [];
  const rows = [{ channel_key: 'oa1', line_user_id: 'U1', first_seen_at: 'a', last_seen_at: 'b', event_count: 3 }];
  const result = await listPointObservationsCandidate({ DB: db(rows, calls) }, new URL('https://x.test/admin/points/observations?channel_key=oa1&limit=999'));
  assert.deepEqual(result, rows);
  assert.match(calls[0].sql, /WHERE channel_key = \?/);
  assert.deepEqual(calls[0].values, ['oa1', 200]);
});

test('point observations without channel uses one pure select', async () => {
  const calls = [];
  await listPointObservationsCandidate({ DB: db([], calls) }, new URL('https://x.test/admin/points/observations?limit=0'));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /WHERE channel_key/);
  assert.deepEqual(calls[0].values, [1]);
});

test('point observations flag disabled stays on legacy', async () => {
  const router = createRouter(); let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerPointObservationsShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://x.test/admin/points/observations'), { SHADOW_POINT_OBSERVATIONS_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('point observations skips candidate when legacy auth fails', async () => {
  const router = createRouter(); let dbCalls = 0;
  registerPointObservationsShadowRoute(router, { legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected'); } });
  const response = await app.fetch(new Request('https://x.test/admin/points/observations'), { SHADOW_POINT_OBSERVATIONS_ENABLED: 'true', DB: { prepare() { dbCalls += 1; } } }, {});
  assert.equal(response.status, 401);
  assert.equal(dbCalls, 0);
});

test('point observations returns legacy response after candidate compare', async () => {
  const router = createRouter(); const calls = [];
  const body = { success: true, status: 'success', observations: [{ marker: 'legacy' }] };
  registerPointObservationsShadowRoute(router, { legacyFetch: async () => Response.json(body), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected'); } });
  const response = await app.fetch(new Request('https://x.test/admin/points/observations'), { SHADOW_POINT_OBSERVATIONS_ENABLED: 'true', DB: db([], calls) }, {});
  assert.deepEqual(await response.json(), body);
  assert.equal(calls.length, 1);
});

test('point observations metadata is read-only', () => {
  const router = createRouter();
  registerPointObservationsShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'POINT-OBSERVATIONS-SHADOW-001', path: '/admin/points/observations', risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_POINT_OBSERVATIONS_ENABLED' }]);
});
