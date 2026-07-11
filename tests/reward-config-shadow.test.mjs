import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  normalizeRewardCampaign,
  rewardConfigCandidate,
  registerRewardConfigShadowRoute,
} from '../src/modules/reward/reward-config.routes.js';

test('reward campaign normalization matches legacy replacement and length rules', () => {
  assert.equal(normalizeRewardCampaign(' smart_202605_5 '), 'smart_202605_5');
  assert.equal(normalizeRewardCampaign('../calendar auto<script>'), '___calendar_auto_script_');
  assert.equal(normalizeRewardCampaign(''), 'smart_202605');
  assert.equal(normalizeRewardCampaign('x'.repeat(80)).length, 60);
});

test('reward config maps fixed and calendar campaigns without D1', () => {
  const fixed = rewardConfigCandidate(new URL('https://example.test/api/reward/config?campaign=smart_202605_5'), {});
  assert.deepEqual(fixed, {
    success: true,
    status: 'success',
    liffId: '2007221311-WjM9sZPz',
    campaign: 'smart_202605_5',
    points: 10,
    source: '康立智能',
    calendarMode: false,
  });

  const calendar = rewardConfigCandidate(new URL('https://example.test/api/reward/config?campaign=calendar_auto'), {
    REWARD_LIFF_ID: 'custom-liff',
    REWARD_CALENDAR_DEFAULT_POINTS: '12',
  });
  assert.equal(calendar.liffId, 'custom-liff');
  assert.equal(calendar.points, 12);
  assert.equal(calendar.calendarMode, true);

  const nfc = rewardConfigCandidate(new URL('https://example.test/api/reward/config?campaign=nfc_test_abc123'), {});
  assert.equal(nfc.points, 10);
  assert.equal(nfc.calendarMode, true);
});

test('legacy calendar default environment name is authoritative', () => {
  const config = rewardConfigCandidate(new URL('https://example.test/api/reward/config?campaign=calendar_auto'), {
    REWARD_CALENDAR_POINTS: '99',
    REWARD_CALENDAR_DEFAULT_POINTS: '15',
  });
  assert.equal(config.points, 15);
});

test('reward config flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, marker: 'legacy' }); };
  registerRewardConfigShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/reward/config'), {
    SHADOW_REWARD_CONFIG_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('reward config candidate runs after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyBody = { success: true, status: 'success', campaign: 'legacy-value' };
  registerRewardConfigShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json(legacyBody); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reward/config?campaign=calendar_auto'), {
    SHADOW_REWARD_CONFIG_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('reward config candidate is skipped when legacy is not successful', async () => {
  const router = createRouter();
  registerRewardConfigShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 500 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/reward/config'), {
    SHADOW_REWARD_CONFIG_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 500);
});

test('reward config route metadata is read-only', () => {
  const router = createRouter();
  registerRewardConfigShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'REWARD-CONFIG-SHADOW-001', path: '/api/reward/config',
    risk: 'low', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_REWARD_CONFIG_ENABLED',
  }]);
});
