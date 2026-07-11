import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  getAiWearPublicCandidate,
  normalizePublicAiWearSettings,
  registerAiWearPublicShadowRoute,
} from '../src/modules/ai-wear/ai-wear-public.routes.js';

function fakeDb({ settings = null, references = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async first() { return sql.includes('app_meta') ? settings : null; },
        async all() { return { results: sql.includes('ai_wear_references') ? references : [] }; },
      };
    },
  };
}

test('public AI wear settings strip secrets and cost controls', () => {
  const settings = normalizePublicAiWearSettings({
    title: '測試眼鏡', publicPath: '/try', liffId: '2007221311-ABC123', prompt: 'prompt', imageModel: 'gpt-image-2',
    imageApiUrl: 'https://api.example.test/image', aiweAjaxUrl: 'https://api.example.test/ajax', aiweNonce: 'nonce', aiwePostId: '99',
    image2ApiKey: 'sk-secret', pointDeductionEnabled: true, pointCost: 8, pointChannelKey: 'oa2', pointType: 'system_point',
    costPerGeneration: 10, costCurrency: 'USD', usdToTwdRate: 33, costControlEnabled: true, dailyCostLimitTwd: 100,
  });
  assert.equal(settings.image2ApiKey, '');
  assert.equal(settings.hasImage2ApiKey, true);
  assert.equal(settings.title, '測試眼鏡');
  assert.equal(settings.pointCost, 8);
  assert.equal(settings.pointChannelKey, 'oa2');
  assert.equal(settings.pointType, 'system_point');
  assert.equal('costPerGeneration' in settings, false);
  assert.equal('costControlEnabled' in settings, false);
});

test('AI wear public candidate only performs two SELECT reads and maps gallery URLs', async () => {
  const DB = fakeDb({
    settings: { value: JSON.stringify({ title: '康立測試', image2ApiKey: 'configured' }) },
    references: [{ id: 'frame 1.jpg', title: '一號鏡框', series: 'A', file_name: 'a.jpg', mime_type: 'image/jpeg', size: 123, active: 1, created_at: 10, updated_at: 20 }],
  });
  const data = await getAiWearPublicCandidate({ DB, PUBLIC_BASE_URL: 'https://staging.example.test/' });
  assert.equal(DB.calls.length, 2);
  assert.ok(DB.calls.every((call) => /^SELECT\b/i.test(call.sql.trim())));
  assert.deepEqual(DB.calls[0].bindings, ['ai_wear_settings']);
  assert.match(DB.calls[1].sql, /WHERE active = 1 ORDER BY updated_at DESC LIMIT 200/);
  assert.equal(data.settings.title, '康立測試');
  assert.equal(data.settings.hasImage2ApiKey, true);
  assert.equal(data.gallery[0].url, 'https://staging.example.test/assets/ai-wear/reference/frame%201.jpg?v=20');
});

test('AI wear public route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let legacyCalls = 0;
  registerAiWearPublicShadowRoute(router, { legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'legacy' }); } });
  const app = createApp({ router, legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'legacy' }); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-public'), { SHADOW_AI_WEAR_PUBLIC_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(legacyCalls, 1);
});

test('AI wear public candidate runs only after successful legacy response', async () => {
  const router = createRouter();
  const DB = fakeDb({ settings: null, references: [] });
  let legacyCalls = 0;
  registerAiWearPublicShadowRoute(router, {
    legacyFetch: async () => { legacyCalls += 1; return Response.json({ success: true, status: 'success', data: { settings: {}, gallery: [] } }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-public'), { SHADOW_AI_WEAR_PUBLIC_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(legacyCalls, 1);
  assert.equal(DB.calls.length, 2);
});

test('AI wear public candidate does not query D1 when legacy fails', async () => {
  const router = createRouter();
  const DB = fakeDb();
  registerAiWearPublicShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 500 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-public'), { SHADOW_AI_WEAR_PUBLIC_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 500);
  assert.equal(DB.calls.length, 0);
});

test('AI wear public route metadata is read-only shadow mode', () => {
  const router = createRouter();
  registerAiWearPublicShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AI-WEAR-PUBLIC-SHADOW-001', path: '/api/ai-wear-public', risk: 'medium', write: false,
    mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_PUBLIC_ENABLED',
  }]);
});
