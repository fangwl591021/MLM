import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { registerSystemRoutes } from '../src/modules/system/system.routes.js';
import { createApp } from '../src/app.js';

function makeApp({ legacyResponse = new Response('legacy', { status: 200 }), legacyError = null } = {}) {
  const router = createRouter();
  registerSystemRoutes(router);
  let legacyCalls = 0;
  const logs = [];
  const app = createApp({
    router,
    legacyFetch: async () => {
      legacyCalls += 1;
      if (legacyError) throw legacyError;
      return legacyResponse;
    },
    randomUUID: () => 'req-test-001',
    now: (() => { let value = 1000; return () => value += 5; })(),
    logger: { error: (message) => logs.push(message) },
  });
  return { app, getLegacyCalls: () => legacyCalls, logs };
}

test('GET /health-modular uses modular router and does not invoke legacy worker', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/health-modular'), {
    DB: {},
    AI_WEAR_BUCKET: {},
    GAS_URL: 'https://gas.example.test',
    LINE_CHANNEL_SECRET: 'configured',
    LINE_CHANNEL_ACCESS_TOKEN: 'configured',
    OPENAI_API_KEY: 'configured',
  }, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(response.headers.get('x-mlm-request-id'), 'req-test-001');
  assert.match(response.headers.get('server-timing'), /^app;dur=\d+$/);
  assert.equal(getLegacyCalls(), 0);

  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'mlm-modular-staging');
  assert.equal(body.mode, 'staging-only');
  assert.deepEqual(body.checks, {
    DB: true,
    AI_WEAR_BUCKET: true,
    GAS_URL: true,
    LINE_CHANNEL_SECRET: true,
    LINE_CHANNEL_ACCESS_TOKEN: true,
    OPENAI_API_KEY: true,
  });
});

test('GET /calendar-modular returns the expected redirect', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/calendar-modular'), {}, {});

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.test/console/calendar');
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(getLegacyCalls(), 0);
});

test('unknown route falls back to legacy worker without changing response body or status', async () => {
  const legacyResponse = new Response(JSON.stringify({ status: 'legacy-ok' }), {
    status: 207,
    headers: { 'content-type': 'application/json', 'x-legacy-header': 'preserved' },
  });
  const { app, getLegacyCalls } = makeApp({ legacyResponse });
  const response = await app.fetch(new Request('https://example.test/api/existing-route'), {}, {});

  assert.equal(response.status, 207);
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(response.headers.get('x-legacy-header'), 'preserved');
  assert.equal(getLegacyCalls(), 1);
  assert.deepEqual(await response.json(), { status: 'legacy-ok' });
});

test('POST to a modular GET-only path falls back to legacy worker', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/health-modular', { method: 'POST' }), {}, {});

  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(getLegacyCalls(), 1);
});

test('legacy error is converted into a stable 500 response and logged', async () => {
  const { app, logs } = makeApp({ legacyError: new Error('legacy failed') });
  const response = await app.fetch(new Request('https://example.test/api/failure'), {}, {});

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('x-mlm-request-id'), 'req-test-001');
  const body = await response.json();
  assert.deepEqual(body, {
    status: 'error',
    message: '系統暫時無法處理此請求',
    requestId: 'req-test-001',
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /legacy failed/);
  assert.match(logs[0], /\/api\/failure/);
});

test('router list exposes route metadata for documentation and auditing', () => {
  const router = createRouter();
  registerSystemRoutes(router);
  assert.deepEqual(router.list(), [
    {
      method: 'GET',
      id: 'SYSTEM-HEALTH-MODULAR-001',
      path: '/health-modular',
      risk: 'low',
      write: false,
    },
    {
      method: 'GET',
      id: 'SYSTEM-CALENDAR-REDIRECT-001',
      path: '/calendar-modular',
      risk: 'low',
      write: false,
    },
  ]);
});
