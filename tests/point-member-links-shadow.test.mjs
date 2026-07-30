import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listPointMemberLinksCandidate,
  registerPointMemberLinksShadowRoute,
} from '../src/modules/points/point-member-links.routes.js';

function createDb(rows = []) {
  const calls = [];
  const bindings = [];
  return {
    calls,
    bindings,
    prepare(sql) {
      calls.push(sql);
      return {
        bind(...args) {
          bindings.push(args);
          return { all: async () => ({ results: rows }) };
        },
        all: async () => ({ results: rows }),
      };
    },
  };
}

test('point member links filters by master member ref without limit', async () => {
  const DB = createDb([{ master_member_ref: 'member-1', line_user_id: 'U1' }]);
  const rows = await listPointMemberLinksCandidate({ DB }, new URL('https://example.test/admin/points/member-links?master_member_ref=member-1&limit=999'));
  assert.equal(rows.length, 1);
  assert.match(DB.calls[0], /WHERE master_member_ref = \?/);
  assert.doesNotMatch(DB.calls[0], /LIMIT \?/);
  assert.deepEqual(DB.bindings[0], ['member-1']);
});

test('point member links clamps unfiltered limit to 200', async () => {
  const DB = createDb([]);
  await listPointMemberLinksCandidate({ DB }, new URL('https://example.test/admin/points/member-links?limit=999'));
  assert.match(DB.calls[0], /ORDER BY linked_at DESC/);
  assert.match(DB.calls[0], /LIMIT \?/);
  assert.deepEqual(DB.bindings[0], [200]);
  assert.doesNotMatch(DB.calls[0], /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
});

test('point member links flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, marker: 'legacy' }); };
  registerPointMemberLinksShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/admin/points/member-links'), {
    SHADOW_POINT_MEMBER_LINKS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('point member links candidate runs only after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  const DB = createDb([]);
  const legacyBody = { success: true, status: 'success', links: [{ marker: 'legacy' }] };
  registerPointMemberLinksShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/points/member-links'), {
    SHADOW_POINT_MEMBER_LINKS_ENABLED: 'true', DB,
  }, {});
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('point member links does not query D1 when legacy denies access', async () => {
  const router = createRouter();
  const DB = createDb([]);
  registerPointMemberLinksShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/admin/points/member-links'), {
    SHADOW_POINT_MEMBER_LINKS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('point member links route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerPointMemberLinksShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'POINT-MEMBER-LINKS-SHADOW-001', path: '/admin/points/member-links',
    risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_POINT_MEMBER_LINKS_ENABLED',
  }]);
});
