import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listCrmMembersCandidate,
  registerCrmMembersShadowRoute,
} from '../src/modules/crm/crm-members.routes.js';

function fakeDb(resultSets = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return this;
        },
        async all() {
          return { results: resultSets.shift() || [] };
        },
      };
    },
  };
}

test('CRM members query clamps limit and applies search bindings', async () => {
  const DB = fakeDb([[]]);
  await listCrmMembersCandidate({ DB }, new URL('https://example.test/admin/crm/members?q=Tony&limit=999'));
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /FROM crm_members/);
  assert.match(DB.calls[0].sql, /ORDER BY updated_at DESC LIMIT \?/);
  assert.deepEqual(DB.calls[0].bindings, ['%tony%', '%tony%', '%tony%', '%tony%', '%tony%', 500]);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
});

test('CRM members attaches channel-specific line links with pure SELECTs', async () => {
  const members = [{ member_ref: 'M1', name: 'Tony' }, { member_ref: 'M2', name: 'Amy' }];
  const links = [{ master_member_ref: 'M1', channel_key: 'oa1', line_user_id: 'U1', linked_at: '2026-07-11' }];
  const DB = fakeDb([members, links]);
  const result = await listCrmMembersCandidate({ DB }, new URL('https://example.test/admin/crm/members?channel_key=oa1&limit=20'));
  assert.equal(DB.calls.length, 2);
  assert.deepEqual(DB.calls[0].bindings, [20]);
  assert.deepEqual(DB.calls[1].bindings, ['oa1']);
  assert.equal(result[0].line_link.line_user_id, 'U1');
  assert.equal(result[1].line_link, null);
  for (const call of DB.calls) assert.doesNotMatch(call.sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
});

test('CRM members flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerCrmMembersShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/admin/crm/members'), {
    SHADOW_CRM_MEMBERS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('CRM members candidate runs only after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  const DB = fakeDb([[]]);
  const legacyBody = { success: true, status: 'success', data: [{ member_ref: 'legacy' }] };
  registerCrmMembersShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/crm/members'), {
    SHADOW_CRM_MEMBERS_ENABLED: 'true', DB,
  }, {});
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('CRM members candidate is skipped on unauthorized legacy response', async () => {
  const router = createRouter();
  const DB = fakeDb([[]]);
  registerCrmMembersShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/crm/members'), {
    SHADOW_CRM_MEMBERS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('CRM members route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerCrmMembersShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'CRM-MEMBERS-SHADOW-001', path: '/admin/crm/members',
    risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_CRM_MEMBERS_ENABLED',
  }]);
});
