import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  fetchLineOaThreadCandidate,
  lineOaThreadCandidateResponse,
  registerLineOaThreadShadowRoute,
} from '../src/modules/line-oa/line-oa-thread.routes.js';

function fakeDb({ row = null, messages = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const entry = { sql: String(sql), bindings: [] };
      calls.push(entry);
      return {
        bind(...bindings) {
          entry.bindings = bindings;
          return {
            first: async () => row,
            all: async () => ({ results: messages }),
          };
        },
      };
    },
  };
}

test('line oa thread uses exact two pure SELECT queries and thread lookup bindings', async () => {
  const DB = fakeDb({
    row: {
      id: 'admin:user:U123', floor_id: 'admin', user_id: 'U123', display_name: 'Tony', picture_url: '',
      summary: '摘要', status: 'pending', risk: 'low', tags: '["VIP"]', note: '', last_message_at: 123,
      profile_display_name: '', profile_picture_url: '', linked_display_name: '', linked_picture_url: '',
      profile_status: null, profile_error: '', last_profile_sync: 0,
    },
    messages: [],
  });
  const data = await fetchLineOaThreadCandidate({ DB }, 'admin', 'U123');
  assert.equal(DB.calls.length, 2);
  assert.match(DB.calls[0].sql, /^\s*SELECT\b/i);
  assert.match(DB.calls[1].sql, /^SELECT\b/i);
  assert.doesNotMatch(DB.calls.map((x) => x.sql).join('\n'), /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.deepEqual(DB.calls[0].bindings, ['admin', 'admin:user:U123', 'U123']);
  assert.deepEqual(DB.calls[1].bindings, ['admin:user:U123']);
  assert.equal(data.name, 'Tony');
  assert.equal(data.status, '待回覆');
  assert.deepEqual(data.tags, ['VIP']);
});

test('line oa thread maps messages and hides main floor checkin monitor message', async () => {
  const DB = fakeDb({
    row: {
      id: 'user:U999', floor_id: 'main', user_id: 'U999', display_name: 'U999', picture_url: '',
      summary: '', status: 'important', risk: '', tags: 'vip,重要', note: 'note', last_message_at: 9,
      profile_display_name: '王小明', profile_picture_url: 'https://img', linked_display_name: '', linked_picture_url: '',
      profile_status: 'ok', profile_error: '', last_profile_sync: 8,
    },
    messages: [
      { id: 'm0', floor_id: 'main', sender_role: 'user', user_id: 'U999', message_type: 'text', text: '簽到贈K點', category: '', suggestions: '[]', important: 0, sentiment: 'neutral', raw_json: '{}', created_at: 1 },
      { id: 'm1', floor_id: 'main', sender_role: 'admin', user_id: 'U999', message_type: 'image', text: '[圖片]', category: '人工回覆', suggestions: '["A"]', important: 1, sentiment: 'positive', raw_json: '{"direction":"outgoing","lineMessages":[{"type":"image","originalContentUrl":"x"}]}', created_at: 2 },
    ],
  });
  const data = await fetchLineOaThreadCandidate({ DB }, 'main', 'user:U999');
  assert.equal(data.name, '王小明');
  assert.equal(data.pictureUrl, 'https://img');
  assert.equal(data.status, '待處理');
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].senderName, '管理員');
  assert.deepEqual(data.messages[0].suggestions, ['A']);
  assert.equal(data.messages[0].linePayload.direction, 'outgoing');
});

test('line oa thread response resolves X-Floor-Id and invalid floors fall back to main', async () => {
  const DB = fakeDb({ row: null });
  await lineOaThreadCandidateResponse(new Request('https://example.test/api/line-oa/thread?id=U1', {
    headers: { 'X-Floor-Id': 'SMART' },
  }), { DB });
  assert.equal(DB.calls[0].bindings[0], 'smart');

  const DB2 = fakeDb({ row: null });
  await lineOaThreadCandidateResponse(new Request('https://example.test/api/line-oa/thread?id=U1&floor=bad'), { DB: DB2 });
  assert.equal(DB2.calls[0].bindings[0], 'main');
});

test('line oa thread flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerLineOaThreadShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/line-oa/thread?id=U1'), {
    SHADOW_LINE_OA_THREAD_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('line oa thread candidate runs only after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  const DB = fakeDb({ row: null });
  const legacyBody = { success: true, status: 'success', data: { marker: 'legacy' } };
  registerLineOaThreadShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/line-oa/thread?id=U1'), {
    SHADOW_LINE_OA_THREAD_ENABLED: 'true', DB,
  }, {});
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('line oa thread skips candidate on legacy 400, 401 and 404', async () => {
  for (const status of [400, 401, 404]) {
    const router = createRouter();
    const DB = fakeDb();
    registerLineOaThreadShadowRoute(router, {
      legacyFetch: async () => Response.json({ status: 'error' }, { status }),
      logger: { info() {}, error() {} },
    });
    const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
    const response = await app.fetch(new Request('https://example.test/api/line-oa/thread'), {
      SHADOW_LINE_OA_THREAD_ENABLED: 'true', DB,
    }, {});
    assert.equal(response.status, status);
    assert.equal(DB.calls.length, 0);
  }
});

test('line oa thread route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerLineOaThreadShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'LINE-OA-THREAD-SHADOW-001', path: '/api/line-oa/thread',
    risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_LINE_OA_THREAD_ENABLED',
  }]);
});
