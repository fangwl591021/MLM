import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { registerSystemRoutes, buildLegacyCompatibleHealthPayload } from '../src/modules/system/system.routes.js';
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

const healthyEnv = {
  DB: {},
  AI_WEAR_BUCKET: {},
  GAS_URL: 'https://gas.example.test',
  GAS_SHARED_SECRET: 'configured',
  LINE_CHANNEL_SECRET: 'configured',
  LINE_CHANNEL_ACCESS_TOKEN: 'configured',
  LINE_ADMIN_CHANNEL_SECRET: 'configured',
  LINE_ADMIN_CHANNEL_ACCESS_TOKEN: 'configured',
  LINE_OA1_CHANNEL_ACCESS_TOKEN: 'configured',
  LINE_OA2_CHANNEL_ACCESS_TOKEN: 'configured',
  DASHBOARD_API_TOKEN: 'configured',
  ADMIN_TOKEN: 'configured',
  CHANNEL_CONFIG_JSON: '{}',
  POINT_API_KEY: 'configured',
  WETW_MEMBERS_URL: 'https://members.example.test',
  WETW_POINTS_URL: 'https://points.example.test',
  WETW_POINT_INSERT_URL: 'https://points.example.test/insert',
  WETW_SHOP_ID: '216',
  GATEWAY_FORWARD_TOKEN: 'configured',
  OPENAI_API_KEY: 'configured',
  DASHBOARD_LIFF_ID: 'configured',
  ALLOWED_ORIGIN: 'https://console.example.test',
};

const expectedLegacyChecks = {
  DB: true,
  GAS_URL: true,
  GAS_SHARED_SECRET: true,
  LINE_CHANNEL_SECRET: true,
  LINE_CHANNEL_ACCESS_TOKEN: true,
  LINE_ADMIN_CHANNEL_SECRET: true,
  LINE_ADMIN_CHANNEL_ACCESS_TOKEN: true,
  LINE_OA1_CHANNEL_ACCESS_TOKEN: true,
  LINE_OA2_CHANNEL_ACCESS_TOKEN: true,
  DASHBOARD_API_TOKEN: true,
  ADMIN_TOKEN: true,
  CHANNEL_CONFIG_JSON: true,
  POINT_API_KEY: true,
  WETW_MEMBERS_URL: true,
  WETW_POINTS_URL: true,
  WETW_POINT_INSERT_URL: true,
  WETW_SHOP_ID: true,
  GATEWAY_FORWARD_TOKEN: true,
  OPENAI_API_KEY: true,
  CALENDAR_EVENTS_DB: true,
  DASHBOARD_LIFF_ID: true,
  ALLOWED_ORIGIN: true,
};

test('legacy-compatible health payload preserves the production API contract', () => {
  assert.deepEqual(buildLegacyCompatibleHealthPayload(healthyEnv), {
    status: 'ok',
    service: 'line-oa-ai-suggestion-worker',
    checks: expectedLegacyChecks,
  });
});

test('GET /health-modular uses modular router and exposes legacy checks plus diagnostics', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/health-modular'), healthyEnv, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(response.headers.get('x-mlm-request-id'), 'req-test-001');
  assert.match(response.headers.get('server-timing'), /^app;dur=\d+$/);
  assert.equal(getLegacyCalls(), 0);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'line-oa-ai-suggestion-worker');
  assert.deepEqual(body.checks, expectedLegacyChecks);
  assert.equal(body.modular.service, 'mlm-modular-staging');
  assert.equal(body.modular.mode, 'staging-only');
  assert.match(body.modular.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET /health stays on legacy when modular feature flag is disabled', async () => {
  const legacyResponse = Response.json({ status: 'legacy-health' });
  const { app, getLegacyCalls } = makeApp({ legacyResponse });
  const response = await app.fetch(new Request('https://example.test/health'), {
    ...healthyEnv,
    MODULAR_HEALTH_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(getLegacyCalls(), 1);
  assert.deepEqual(await response.json(), { status: 'legacy-health' });
});

test('GET /health is legacy-contract compatible when feature flag is true', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/health'), {
    ...healthyEnv,
    MODULAR_HEALTH_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(getLegacyCalls(), 0);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'line-oa-ai-suggestion-worker',
    checks: expectedLegacyChecks,
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

test('GET /calendar stays on legacy when modular calendar flag is disabled', async () => {
  const legacyResponse = Response.redirect('https://example.test/console/calendar', 302);
  const { app, getLegacyCalls } = makeApp({ legacyResponse });
  const response = await app.fetch(new Request('https://example.test/calendar'), {
    MODULAR_CALENDAR_ENABLED: 'false',
  }, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.test/console/calendar');
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(getLegacyCalls(), 1);
});

test('GET /calendar preserves the legacy redirect contract when flag is true', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/calendar?source=test'), {
    MODULAR_CALENDAR_ENABLED: 'true',
  }, {});
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
    { method: 'GET', id: 'SYSTEM-HEALTH-MODULAR-001', path: '/health-modular', risk: 'low', write: false },
    { method: 'GET', id: 'SYSTEM-HEALTH-CANARY-001', path: '/health', risk: 'low', write: false, featureFlag: 'MODULAR_HEALTH_ENABLED' },
    { method: 'GET', id: 'SYSTEM-CALENDAR-MODULAR-001', path: '/calendar-modular', risk: 'low', write: false },
    { method: 'GET', id: 'SYSTEM-CALENDAR-CANARY-001', path: '/calendar', risk: 'low', write: false, featureFlag: 'MODULAR_CALENDAR_ENABLED' },
  ]);
});
