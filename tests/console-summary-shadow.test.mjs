import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import { registerConsoleSummaryShadowRoute } from '../src/modules/console/console-summary.routes.js';

function makeApp({ legacyStatus = 200, legacyBody = { status: 'success', data: { generatedAt: 1, totals: { threads: 2 } } }, candidateBody = { generatedAt: 9, totals: { threads: 2 } } } = {}) {
  let legacyCalls = 0;
  let candidateCalls = 0;
  const logs = [];
  const legacyFetch = async () => {
    legacyCalls += 1;
    return Response.json(legacyBody, { status: legacyStatus });
  };
  const router = createRouter();
  registerConsoleSummaryShadowRoute(router, {
    legacyFetch,
    summaryReader: async () => { candidateCalls += 1; return candidateBody; },
    logger: { info: (value) => logs.push(value), error: (value) => logs.push(value) },
  });
  const app = createApp({ router, legacyFetch, randomUUID: () => 'req-summary-001', now: () => 1, logger: { error() {} } });
  return { app, calls: () => ({ legacyCalls, candidateCalls }), logs };
}

test('summary shadow flag disabled leaves request on normal legacy fallback', async () => {
  const { app, calls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/api/console/summary'), { SHADOW_CONSOLE_SUMMARY_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.deepEqual(calls(), { legacyCalls: 1, candidateCalls: 0 });
});

test('authorized legacy response runs candidate but still returns legacy payload', async () => {
  const { app, calls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/api/console/summary'), { SHADOW_CONSOLE_SUMMARY_ENABLED: 'true' }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.deepEqual(await response.json(), { status: 'success', data: { generatedAt: 1, totals: { threads: 2 } } });
  assert.deepEqual(calls(), { legacyCalls: 1, candidateCalls: 1 });
});

test('unauthorized legacy response skips candidate D1 read', async () => {
  const { app, calls, logs } = makeApp({ legacyStatus: 401, legacyBody: { status: 'error', message: 'Unauthorized' } });
  const response = await app.fetch(new Request('https://example.test/api/console/summary'), { SHADOW_CONSOLE_SUMMARY_ENABLED: 'true' }, {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Unauthorized' });
  assert.deepEqual(calls(), { legacyCalls: 1, candidateCalls: 0 });
  assert.ok(logs.some((entry) => entry.includes('shadow-read-skipped')));
});

test('route metadata identifies medium-risk shadow read', () => {
  const router = createRouter();
  registerConsoleSummaryShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'CONSOLE-SUMMARY-SHADOW-001', path: '/api/console/summary', risk: 'medium', write: false, mode: 'shadow-read', featureFlag: 'SHADOW_CONSOLE_SUMMARY_ENABLED' }]);
});
