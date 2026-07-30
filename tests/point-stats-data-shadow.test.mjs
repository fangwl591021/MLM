import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listPointStatsDataCandidate,
  pointStatsDateFromDays,
  pointStatsWhere,
  registerPointStatsDataShadowRoute,
} from '../src/modules/points/point-stats-data.routes.js';

function fakeDb(resultSets = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.bindings = values;
          return this;
        },
        async all() {
          return { results: resultSets[calls.indexOf(call)] || [] };
        },
      };
    },
  };
}

test('point stats date uses UTC midnight across requested day count', () => {
  assert.equal(pointStatsDateFromDays(1, Date.parse('2026-07-11T12:00:00Z')), '2026-07-11 00:00:00');
  assert.equal(pointStatsDateFromDays(3, Date.parse('2026-07-11T12:00:00Z')), '2026-07-09 00:00:00');
});

test('point stats ops filter excludes sync and supports channel/type bindings', () => {
  const filter = pointStatsWhere('ops', '2026-07-01 00:00:00', 'oa1', 'gift_money', 'pl');
  assert.match(filter.where, /pl\.source NOT IN \('sync', 'import'\)/);
  assert.match(filter.where, /pl\.action NOT IN \('sync', 'import'\)/);
  assert.match(filter.where, /pl\.business_key NOT LIKE 'sync:%'/);
  assert.match(filter.where, /pl\.channel_key = \?/);
  assert.match(filter.where, /pl\.point_type = \?/);
  assert.deepEqual(filter.bindings, ['2026-07-01 00:00:00', 'oa1', 'gift_money']);
});

test('point stats candidate executes four pure SELECT queries and maps totals', async () => {
  const db = fakeDb([
    [{ day: '2026-07-11', transactions: 2, unique_users: 1, grant_points: 10, deduct_points: 2, net_points: 8, grant_count: 1, deduct_count: 1 }],
    [{ action: 'grant', source: 'admin', transactions: 1, unique_users: 1, grant_points: 10, deduct_points: 0, net_points: 10 }],
    [{ id: 5, channel_key: 'oa1', line_user_id: 'U1234567890123456', user_name: '', action: 'grant', point_type: 'gift_money', point_delta: 10, balance_after: 20, source: 'admin', business_key: 'x', operator_name: 'Tony', note: '增加10元', created_at: '2026-07-11T08:00:00Z' }],
    [{ day: '2026-07-11', line_user_id: 'U1234567890123456', user_name: '王小明', transactions: 2, grant_points: 10, deduct_points: 2, net_points: 8 }],
  ]);
  const data = await listPointStatsDataCandidate({ DB: db }, new URL('https://example.test/admin/points/stats-data?days=30&scope=ops&channel_key=oa1&point_type=gift_money'), { now: () => Date.parse('2026-07-11T12:00:00Z') });
  assert.equal(db.calls.length, 4);
  for (const call of db.calls) {
    assert.match(call.sql.trim(), /^SELECT/i);
    assert.doesNotMatch(call.sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
    assert.deepEqual(call.bindings, ['2026-06-12 00:00:00', 'oa1', 'gift_money']);
  }
  assert.deepEqual(data.totals, { days: 1, transactions: 2, users: 1, grant_points: 10, deduct_points: 2, net_points: 8, grant_count: 1, deduct_count: 1 });
  assert.equal(data.daily[0].members[0].name, '王小明');
  assert.equal(data.recent[0].source_label, '康立智能');
  assert.equal(data.recent[0].note, '增加10點');
  assert.match(data.recent[0].user_name, /^U123456789\.\.\./);
});

test('point stats clamps days and normalizes unsupported channel', async () => {
  const db = fakeDb([[], [], [], []]);
  const data = await listPointStatsDataCandidate({ DB: db }, new URL('https://example.test/admin/points/stats-data?days=999&scope=all&channel_key=bad'), { now: () => Date.parse('2026-07-11T12:00:00Z') });
  assert.equal(data.days, 366);
  assert.equal(data.scope, 'all');
  assert.equal(data.channel_key, '');
  assert.ok(db.calls.every((call) => !call.sql.includes("source NOT IN ('sync', 'import')")));
  assert.ok(db.calls.every((call) => call.bindings.length === 2));
});

test('point stats flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerPointStatsDataShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/admin/points/stats-data'), { SHADOW_POINT_STATS_DATA_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('point stats candidate runs after legacy 200 and external response remains legacy', async () => {
  const router = createRouter();
  const db = fakeDb([[], [], [], []]);
  const legacyBody = { success: true, status: 'success', data: { marker: 'legacy' } };
  registerPointStatsDataShadowRoute(router, { legacyFetch: async () => Response.json(legacyBody), logger: { info() {}, error() {} }, now: () => Date.parse('2026-07-11T12:00:00Z') });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected'); } });
  const response = await app.fetch(new Request('https://example.test/admin/points/stats-data'), { SHADOW_POINT_STATS_DATA_ENABLED: 'true', DB: db }, {});
  assert.equal(db.calls.length, 4);
  assert.deepEqual(await response.json(), legacyBody);
});

test('point stats candidate is skipped on unauthorized legacy response', async () => {
  const router = createRouter();
  const db = fakeDb();
  registerPointStatsDataShadowRoute(router, { legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected'); } });
  const response = await app.fetch(new Request('https://example.test/admin/points/stats-data'), { SHADOW_POINT_STATS_DATA_ENABLED: 'true', DB: db }, {});
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test('point stats route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerPointStatsDataShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'POINT-STATS-DATA-SHADOW-001', path: '/admin/points/stats-data', risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_POINT_STATS_DATA_ENABLED' }]);
});
