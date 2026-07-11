import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import { listSmartMonitorDataCandidate, registerSmartMonitorDataShadowRoute } from '../src/modules/monitor/smart-monitor-data.routes.js';

function mockDb() {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      const record = { sql: normalized, bindings: [] };
      queries.push(record);
      return {
        bind(...bindings) {
          record.bindings = bindings;
          return this;
        },
        async all() {
          if (normalized.includes('GROUP BY day') && normalized.includes('COUNT(DISTINCT pl.line_user_id)')) return { results: [{ day: '2026-07-11', transactions: 2, unique_users: 1, grant_points: 10, deduct_points: 0, net_points: 10, grant_count: 2, deduct_count: 0 }] };
          if (normalized.includes('GROUP BY pl.action, pl.source')) return { results: [{ action: 'grant', source: 'keyword', transactions: 2, unique_users: 1, grant_points: 10, deduct_points: 0, net_points: 10 }] };
          if (normalized.includes('ORDER BY pl.id DESC LIMIT 80')) return { results: [{ id: 9, channel_key: 'oa1', line_user_id: 'U1234567890123456', user_name: '王小明', action: 'grant', point_type: 'gift_money', point_delta: 5, balance_after: 20, source: 'keyword', business_key: 'keyword:會員打卡', operator_name: '系統', note: '增加5元', created_at: '2026-07-11T01:00:00Z' }] };
          if (normalized.includes('GROUP BY day, pl.line_user_id')) return { results: [{ day: '2026-07-11', line_user_id: 'U1234567890123456', user_name: '王小明', transactions: 2, grant_points: 10, deduct_points: 0, net_points: 10 }] };
          if (normalized.startsWith('WITH checkins AS')) return { results: [{ line_user_id: 'U1234567890123456', user_name: '王小明', hits: 2, first_tw: '2026-07-11 09:00:00', last_tw: '2026-07-11 09:02:00', points: 10, balance_after: 20, updated_at: '2026-07-11 09:03:00', missing: 0 }, { line_user_id: 'U9999999999999999', user_name: '', hits: 1, first_tw: '2026-07-11 10:00:00', last_tw: '2026-07-11 10:00:00', points: 0, balance_after: 0, updated_at: '', missing: 1 }] };
          if (normalized.includes('FROM threads t WHERE t.floor_id = ? ORDER BY t.last_message_at DESC LIMIT 80')) return { results: [{ id: 'user:U1', user_id: 'U1', display_name: '測試會員', summary: '詢問產品', status: 'pending', risk: 'high', last_message_at: 1783731600000, latest_text: '請問價格', latest_sender: 'user', message_count: 3 }] };
          return { results: [] };
        },
        async first() {
          if (normalized.includes('FROM threads WHERE floor_id = ?')) return { total: 5, pending: 2, done: 3, high_risk: 1 };
          if (normalized.includes("sender_role = ? AND created_at >= ?")) return { count: record.bindings[1] === 'user' ? 4 : 2 };
          return null;
        },
      };
    },
  };
}

test('smart monitor candidate composes point stats, checkins and chat monitor with select-only queries', async () => {
  const DB = mockDb();
  const now = () => Date.parse('2026-07-11T04:00:00Z');
  const data = await listSmartMonitorDataCandidate({ DB }, new URL('https://example.test/admin/smart-monitor-data?days=7&date=2026-07-11'), { now });
  assert.equal(data.days, 7);
  assert.equal(data.source.label, '康立智能');
  assert.deepEqual(data.checkinSummary, { date: '2026-07-11', users: 2, messages: 3, rewarded: 1, missing: 1, points: 10 });
  assert.equal(data.checkins[1].user_name, 'U99999999...999999');
  assert.equal(data.chatMonitor.total, 5);
  assert.equal(data.chatMonitor.today_user_messages, 4);
  assert.equal(data.chatMonitor.today_admin_replies, 2);
  assert.equal(data.chatMonitor.threads[0].status, '待回覆');
  assert.equal(data.stats.recent[0].note, '增加5點');
  assert.equal(DB.queries.length, 9);
  for (const query of DB.queries) {
    assert.match(query.sql, /^(SELECT|WITH)/i);
    assert.doesNotMatch(query.sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|REPLACE|DROP)\b/i);
  }
});

test('smart monitor clamps days and binds fixed oa1 gift-money scope', async () => {
  const DB = mockDb();
  await listSmartMonitorDataCandidate({ DB }, new URL('https://example.test/admin/smart-monitor-data?days=999&date=2026-07-11'), { now: () => Date.parse('2026-07-11T04:00:00Z') });
  const pointQueries = DB.queries.slice(0, 4);
  assert.ok(pointQueries.every((query) => query.bindings.includes('oa1')));
  assert.ok(pointQueries.every((query) => query.bindings.includes('gift_money')));
  const checkin = DB.queries.find((query) => query.sql.startsWith('WITH checkins AS'));
  assert.deepEqual(checkin.bindings, ['oa1', '2026-07-11 00:00:00', '2026-07-12 00:00:00', '2026-07-11', 'oa1']);
});

test('smart monitor flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerSmartMonitorDataShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/admin/smart-monitor-data'), { SHADOW_SMART_MONITOR_DATA_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('smart monitor candidate runs only after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  const DB = mockDb();
  const legacyBody = { success: true, status: 'success', data: { marker: 'legacy' } };
  registerSmartMonitorDataShadowRoute(router, { legacyFetch: async () => Response.json(legacyBody), logger: { info() {}, error() {} }, now: () => Date.parse('2026-07-11T04:00:00Z') });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/smart-monitor-data?date=2026-07-11'), { SHADOW_SMART_MONITOR_DATA_ENABLED: 'true', DB }, {});
  assert.deepEqual(await response.json(), legacyBody);
  assert.equal(DB.queries.length, 9);
});

test('smart monitor skips candidate when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = mockDb();
  registerSmartMonitorDataShadowRoute(router, { legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/smart-monitor-data'), { SHADOW_SMART_MONITOR_DATA_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.queries.length, 0);
});

test('smart monitor route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerSmartMonitorDataShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'SMART-MONITOR-DATA-SHADOW-001', path: '/admin/smart-monitor-data', risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_SMART_MONITOR_DATA_ENABLED' }]);
});
