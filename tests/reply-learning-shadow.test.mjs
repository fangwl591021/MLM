import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  fetchReplyLearningCandidate,
  registerReplyLearningShadowRoute,
} from '../src/modules/reply-learning/reply-learning.routes.js';

function fakeDb({ count = 0, rows = [] } = {}) {
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
        async first() {
          return { count };
        },
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

test('reply learning candidate preserves floor, limit and response mapping', async () => {
  const DB = fakeDb({
    count: 1,
    rows: [{
      learning_key: 'key-1', floor_id: 'admin', user_name: '王小明', user_text: '問題', reply_text: '回覆',
      category: '客服', tags: '["重要"]', source: 'admin_reply', quality: 'accepted', use_count: 3,
      created_at: 10, updated_at: 20,
    }],
  });
  const request = new Request('https://example.test/api/reply-learning?limit=999', {
    headers: { 'X-Floor-Id': 'admin' },
  });
  const data = await fetchReplyLearningCandidate({ DB }, request);
  assert.equal(DB.calls.length, 2);
  assert.deepEqual(DB.calls[0].bindings, ['admin']);
  assert.deepEqual(DB.calls[1].bindings, ['admin', 200]);
  assert.match(DB.calls[1].sql, /ORDER BY updated_at DESC/);
  for (const call of DB.calls) assert.doesNotMatch(call.sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(data, {
    count: 1,
    items: [{
      learning_key: 'key-1', floor_id: 'admin', user_name: '王小明', user_text: '問題', reply_text: '回覆',
      category: '客服', tags: '["重要"]', source: 'admin_reply', quality: 'accepted', use_count: 3,
      created_at: 10, updated_at: 20,
    }],
  });
});

test('reply learning route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ status: 'success', count: 0, items: [] }); };
  registerReplyLearningShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/reply-learning'), {
    SHADOW_REPLY_LEARNING_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('reply learning candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb();
  let calls = 0;
  registerReplyLearningShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json({ status: 'success', count: 0, items: [] }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reply-learning'), {
    SHADOW_REPLY_LEARNING_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(DB.calls.length, 2);
  assert.deepEqual(await response.json(), { status: 'success', count: 0, items: [] });
});

test('reply learning candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb();
  registerReplyLearningShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reply-learning'), {
    SHADOW_REPLY_LEARNING_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('reply learning shadow route metadata is read-only', () => {
  const router = createRouter();
  registerReplyLearningShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'REPLY-LEARNING-SHADOW-001', path: '/api/reply-learning',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_REPLY_LEARNING_ENABLED',
  }]);
});
