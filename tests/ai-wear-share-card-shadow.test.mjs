import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  getAiWearShareCardCandidate,
  registerAiWearShareCardShadowRoute,
} from '../src/modules/ai-wear/ai-wear-share-card.routes.js';

function fakeDb(row = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async first() { return row; },
      };
    },
  };
}

test('share card candidate is pure select and maps legacy contract', async () => {
  const DB = fakeDb({
    id: 'share 1', sharer_name: 'Tony', caption: '', image_url: 'https://cdn.example.test/share-1',
    purchase_line_url: 'https://lin.ee/abc', share_format: 'format2',
  });
  const data = await getAiWearShareCardCandidate({ DB, PUBLIC_BASE_URL: 'https://staging.example.test/' }, new URLSearchParams({ id: 'share 1' }));
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /^SELECT /);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(DB.calls[0].bindings, ['share 1']);
  assert.deepEqual(data, {
    id: 'share 1',
    title: 'Tony 的 AI 眼鏡試戴',
    caption: '看看我的 AI 眼鏡試戴對照圖。',
    shareUrl: 'https://staging.example.test/ai-wear/share/share%201',
    previewUrl: 'https://staging.example.test/ai-wear/share/share%201/preview',
    imageUrl: 'https://cdn.example.test/share-1.jpg',
    shareFormat: 'format2',
    flexAspectRatio: '3:4',
    purchaseLineUrl: 'https://lin.ee/abc',
  });
});

test('share card candidate rejects invalid id without querying D1', async () => {
  const DB = fakeDb({});
  assert.equal(await getAiWearShareCardCandidate({ DB }, new URLSearchParams({ id: '../bad' })), null);
  assert.equal(DB.calls.length, 0);
});

test('share card candidate filters invalid purchase URL and keeps existing image extension', async () => {
  const DB = fakeDb({ id: 's1', sharer_name: '', caption: '測試', image_url: 'https://cdn.example.test/a.webp?v=1', purchase_line_url: 'https://evil.example.test', share_format: 'bad' });
  const data = await getAiWearShareCardCandidate({ DB }, new URLSearchParams({ id: 's1' }));
  assert.equal(data.imageUrl, 'https://cdn.example.test/a.webp?v=1');
  assert.equal(data.purchaseLineUrl, '');
  assert.equal(data.shareFormat, 'format1');
  assert.equal(data.flexAspectRatio, '1.91:1');
});

test('share card route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: {} }); };
  registerAiWearShareCardShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-share-card?id=s1'), { SHADOW_AI_WEAR_SHARE_CARD_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('share card candidate runs only after legacy success', async () => {
  const router = createRouter();
  const DB = fakeDb({ id: 's1', sharer_name: '', caption: '', image_url: '', purchase_line_url: '', share_format: 'format1' });
  const legacyBody = { success: true, status: 'success', data: { id: 'legacy' } };
  registerAiWearShareCardShadowRoute(router, { legacyFetch: async () => Response.json(legacyBody), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-share-card?id=s1'), { SHADOW_AI_WEAR_SHARE_CARD_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('share card candidate does not query D1 when legacy returns 404', async () => {
  const router = createRouter();
  const DB = fakeDb({});
  registerAiWearShareCardShadowRoute(router, { legacyFetch: async () => Response.json({ status: 'error' }, { status: 404 }), logger: { info() {}, error() {} } });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-share-card?id=missing'), { SHADOW_AI_WEAR_SHARE_CARD_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 404);
  assert.equal(DB.calls.length, 0);
});

test('share card shadow route metadata is read-only', () => {
  const router = createRouter();
  registerAiWearShareCardShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AI-WEAR-SHARE-CARD-SHADOW-001', path: '/api/ai-wear-share-card',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_SHARE_CARD_ENABLED',
  }]);
});
