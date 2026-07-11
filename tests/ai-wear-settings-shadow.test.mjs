import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  getAiWearSettingsCandidate,
  normalizeAiWearSettingsForClient,
  registerAiWearSettingsShadowRoute,
} from '../src/modules/ai-wear/ai-wear-settings.routes.js';

function fakeDb(value = '') {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async first() { return value ? { value } : null; },
      };
    },
  };
}

test('settings candidate hides API key but preserves management cost settings', async () => {
  const DB = fakeDb(JSON.stringify({
    title: 'AI 眼鏡', image2ApiKey: 'sk-secret', pointCost: 10,
    costPerGeneration: 1.25, costCurrency: 'usd', usdToTwdRate: 31.5,
    costControlEnabled: true, dailyCostLimitTwd: 300, monthlyCostLimitTwd: 5000,
    perUserDailyLimit: 3,
  }));
  const data = await getAiWearSettingsCandidate({ DB });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /^SELECT /);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(DB.calls[0].bindings, ['ai_wear_settings']);
  assert.equal(data.image2ApiKey, '');
  assert.equal(data.hasImage2ApiKey, true);
  assert.equal(data.costPerGeneration, 1.25);
  assert.equal(data.costCurrency, 'USD');
  assert.equal(data.usdToTwdRate, 31.5);
  assert.equal(data.costControlEnabled, true);
  assert.equal(data.dailyCostLimitTwd, 300);
  assert.equal(data.monthlyCostLimitTwd, 5000);
  assert.equal(data.perUserDailyLimit, 3);
});

test('settings normalizer applies safe defaults and rejects unsafe URLs', () => {
  const data = normalizeAiWearSettingsForClient({
    publicPath: 'https://evil.test/path', liffId: 'bad', imageApiUrl: 'http://unsafe.test',
    pointChannelKey: 'bad', pointType: 'bad', pointCost: -5,
  });
  assert.equal(data.publicPath, '/ai-wear');
  assert.equal(data.liffId, '2007221311-ISFxRBY3');
  assert.equal(data.imageApiUrl, '');
  assert.equal(data.pointChannelKey, 'oa1');
  assert.equal(data.pointType, 'gift_money');
  assert.equal(data.pointCost, 0);
  assert.equal(data.hasImage2ApiKey, false);
});

test('settings route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: {} }); };
  registerAiWearSettingsShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-settings'), {
    SHADOW_AI_WEAR_SETTINGS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('settings candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb('{}');
  let calls = 0;
  registerAiWearSettingsShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json({ success: true, status: 'success', data: normalizeAiWearSettingsForClient({}) }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-settings'), {
    SHADOW_AI_WEAR_SETTINGS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(DB.calls.length, 1);
});

test('settings candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb('{}');
  registerAiWearSettingsShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-settings'), {
    SHADOW_AI_WEAR_SETTINGS_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('settings shadow route metadata is read-only', () => {
  const router = createRouter();
  registerAiWearSettingsShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AI-WEAR-SETTINGS-SHADOW-001', path: '/api/ai-wear-settings',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_SETTINGS_ENABLED',
  }]);
});
