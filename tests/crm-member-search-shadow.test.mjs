import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  searchCrmMemberCandidatesCandidate,
  registerCrmMemberSearchShadowRoute,
} from '../src/modules/crm/crm-member-search.routes.js';

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

test('CRM member search uses ranked pure SELECT with expected bindings', async () => {
  const DB = fakeDb([{ member_ref: 'M001', name: 'Tony', phone: '0912', email: '', level: '1086', source: 'wetw', source_json: JSON.stringify({ LINE_user_id: 'U1', LINE_display_name: 'Tony LINE', shop_id: 1086 }), updated_at: '2026-07-11' }]);
  const result = await searchCrmMemberCandidatesCandidate({ DB }, new URL('https://example.test/admin/crm/member-search?q=Tony&limit=999'));
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /^\s*SELECT\b/i);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i);
  assert.deepEqual(DB.calls[0].bindings, ['%tony%', '%tony%', '%tony%', '%tony%', '%tony%', 'tony', 'tony', 'tony', '%tony%', 100]);
  assert.deepEqual(result, [{ member_ref: 'M001', name: 'Tony', phone: '0912', line_user_id: 'U1', line_display_name: 'Tony LINE', shop_id: '1086', source: 'wetw', updated_at: '2026-07-11' }]);
});

test('CRM member search returns empty without q and does not query D1', async () => {
  const DB = fakeDb();
  const result = await searchCrmMemberCandidatesCandidate({ DB }, new URL('https://example.test/admin/crm/member-search'));
  assert.deepEqual(result, []);
  assert.equal(DB.calls.length, 0);
});

test('CRM member search flag disabled stays on legacy', async () => {
  const router = createRouter();
  const DB = fakeDb();
  const legacyFetch = async () => Response.json({ marker: 'legacy' });
  registerCrmMemberSearchShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/admin/crm/member-search?q=Tony'), { DB, SHADOW_CRM_MEMBER_SEARCH_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(DB.calls.length, 0);
});

test('CRM member search candidate runs only after authorized legacy 200', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  const legacyBody = { success: true, status: 'success', candidates: [{ member_ref: 'legacy' }] };
  registerCrmMemberSearchShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/crm/member-search?q=Tony'), { DB, SHADOW_CRM_MEMBER_SEARCH_ENABLED: 'true' }, {});
  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('CRM member search skips D1 after legacy 401', async () => {
  const router = createRouter();
  const DB = fakeDb();
  registerCrmMemberSearchShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/crm/member-search?q=Tony'), { DB, SHADOW_CRM_MEMBER_SEARCH_ENABLED: 'true' }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('CRM member search route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerCrmMemberSearchShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'CRM-MEMBER-SEARCH-SHADOW-001', path: '/admin/crm/member-search', risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_CRM_MEMBER_SEARCH_ENABLED' }]);
});
