import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  loginConfigCandidate,
  registerLoginConfigShadowRoute,
} from '../src/modules/system/login-config.routes.js';

test('login config maps dashboard liff and request origin without D1', () => {
  const request = new Request('https://staging.example.test/api/login-config?x=1');
  assert.deepEqual(loginConfigCandidate(request, { DASHBOARD_LIFF_ID: ' 2000000000-abc ' }), {
    status: 'success',
    data: {
      liffId: '2000000000-abc',
      lineLoginEnabled: true,
      apiBase: 'https://staging.example.test',
    },
  });
  assert.deepEqual(loginConfigCandidate(request, {}), {
    status: 'success',
    data: { liffId: '', lineLoginEnabled: false, apiBase: 'https://staging.example.test' },
  });
});

test('login config flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ marker: 'legacy' }); };
  registerLoginConfigShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/login-config'), {
    SHADOW_LOGIN_CONFIG_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('login config candidate runs after legacy 200 and response remains legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyBody = { status: 'success', data: { liffId: 'legacy' } };
  registerLoginConfigShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json(legacyBody); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/login-config'), {
    SHADOW_LOGIN_CONFIG_ENABLED: 'true',
    DASHBOARD_LIFF_ID: 'candidate',
  }, {});
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), legacyBody);
});

test('login config candidate is skipped when legacy is not successful', async () => {
  const router = createRouter();
  registerLoginConfigShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 500 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/login-config'), {
    SHADOW_LOGIN_CONFIG_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 500);
});

test('login config route metadata is read-only', () => {
  const router = createRouter();
  registerLoginConfigShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'LOGIN-CONFIG-SHADOW-001', path: '/api/login-config',
    risk: 'low', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_LOGIN_CONFIG_ENABLED',
  }]);
});
