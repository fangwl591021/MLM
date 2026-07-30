import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listAiWearResultsCandidate,
  registerAiWearResultsShadowRoute,
} from '../src/modules/ai-wear/ai-wear-results.routes.js';

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async all() { return { results: rows }; },
      };
    },
  };
}

test('results candidate caps limit, avoids base64 payload and maps blob URL', async () => {
  const DB = fakeDb([{
    id: 'result 1', line_user_id: 'U1', display_name: 'Tony', model_id: 'M1', model_title: '款式一',
    person_image_url: 'https://person', result_image_url: 'https://remote', result_mime_type: 'image/jpeg',
    has_result_blob: 1, point_cost: 5, point_channel_key: 'oa1', point_type: 'gift_money', status: 'completed', created_at: 123,
  }]);
  const data = await listAiWearResultsCandidate({ DB, PUBLIC_BASE_URL: 'https://staging.example.test/' }, new URLSearchParams('limit=999'));
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(DB.calls[0].bindings, [200]);
  assert.match(DB.calls[0].sql, /ORDER BY created_at DESC/);
  assert.match(DB.calls[0].sql, /CASE WHEN result_base64 != '' THEN 1 ELSE 0 END AS has_result_blob/);
  assert.doesNotMatch(DB.calls[0].sql, /SELECT[^]*result_base64\s*(,|FROM)/i);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(data, { items: [{
    id: 'result 1', lineUserId: 'U1', displayName: 'Tony', modelId: 'M1', modelTitle: '款式一',
    personImageUrl: 'https://person', resultImageUrl: 'https://staging.example.test/assets/ai-wear/result/result%201',
    pointCost: 5, pointChannelKey: 'oa1', pointType: 'gift_money', status: 'completed', createdAt: 123,
  }] });
});

test('results route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: { items: [] } }); };
  registerAiWearResultsShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-results'), {
    SHADOW_AI_WEAR_RESULTS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('results candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  let calls = 0;
  registerAiWearResultsShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json({ success: true, status: 'success', data: { items: [] } }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-results?limit=25'), {
    SHADOW_AI_WEAR_RESULTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(DB.calls[0].bindings, [25]);
  assert.deepEqual(await response.json(), { success: true, status: 'success', data: { items: [] } });
});

test('results candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerAiWearResultsShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-results'), {
    SHADOW_AI_WEAR_RESULTS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('results shadow route metadata is read-only', () => {
  const router = createRouter();
  registerAiWearResultsShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AI-WEAR-RESULTS-SHADOW-001', path: '/api/ai-wear-results',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_RESULTS_ENABLED',
  }]);
});
