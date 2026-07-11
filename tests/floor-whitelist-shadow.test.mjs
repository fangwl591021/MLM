import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  fetchFloorWhitelistCandidate,
  registerFloorWhitelistShadowRoute,
} from '../src/modules/access/floor-whitelist.routes.js';

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return { async all() { return { results: rows }; } };
    },
  };
}

test('floor whitelist candidate preserves grouping and fallback floor mapping', async () => {
  const DB = fakeDb([
    { floor_id: 'admin', operator_id: 'A1', operator_name: '行政', active: 1, updated_at: 10 },
    { floor_id: 'admin_all', operator_id: 'ROOT', operator_name: '總管', active: 1, updated_at: 20 },
    { floor_id: 'unknown', operator_id: 'M1', operator_name: '產品', active: 0, updated_at: 30 },
  ]);
  const data = await fetchFloorWhitelistCandidate({ DB });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0], /FROM floor_access_whitelist/);
  assert.match(DB.calls[0], /ORDER BY floor_id ASC, operator_id ASC/);
  assert.doesNotMatch(DB.calls[0], /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(data, { floors: {
    main: [{ floorId: 'main', operatorId: 'M1', operatorName: '產品', active: false, updatedAt: 30 }],
    admin: [{ floorId: 'admin', operatorId: 'A1', operatorName: '行政', active: true, updatedAt: 10 }],
    smart: [],
    adminAll: [{ floorId: 'admin_all', operatorId: 'ROOT', operatorName: '總管', active: true, updatedAt: 20 }],
  } });
});

test('floor whitelist route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ status: 'success', data: { floors: {} } }); };
  registerFloorWhitelistShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/floor-whitelist'), {
    SHADOW_FLOOR_WHITELIST_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('floor whitelist candidate runs only after successful access-manager authorization', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerFloorWhitelistShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'success', data: { floors: { main: [], admin: [], smart: [], adminAll: [] } } }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/floor-whitelist'), {
    SHADOW_FLOOR_WHITELIST_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 1);
});

test('floor whitelist candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerFloorWhitelistShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/floor-whitelist'), {
    SHADOW_FLOOR_WHITELIST_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('floor whitelist route metadata is read-only', () => {
  const router = createRouter();
  registerFloorWhitelistShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'FLOOR-WHITELIST-SHADOW-001', path: '/api/floor-whitelist',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_FLOOR_WHITELIST_ENABLED',
  }]);
});
