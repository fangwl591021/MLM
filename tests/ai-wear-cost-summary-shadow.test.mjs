import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  getAiWearCostSummaryCandidate,
  registerAiWearCostSummaryShadowRoute,
  startOfTaipeiDay,
  startOfTaipeiMonth,
} from '../src/modules/ai-wear/ai-wear-cost-summary.routes.js';

function fakeDb({ firstRows = [], allRows = [] } = {}) {
  const calls = [];
  let firstIndex = 0;
  let allIndex = 0;
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async first() { return firstRows[firstIndex++] ?? null; },
        async all() { return { results: allRows[allIndex++] ?? [] }; },
      };
    },
  };
}

test('taipei day and month boundaries are stable', () => {
  const sample = Date.parse('2026-07-11T10:30:00+08:00');
  assert.equal(startOfTaipeiDay(sample), Date.parse('2026-07-11T00:00:00+08:00'));
  assert.equal(startOfTaipeiMonth(sample), Date.parse('2026-07-01T00:00:00+08:00'));
});

test('cost summary candidate preserves limits, bindings and response mapping', async () => {
  const nowValue = Date.parse('2026-07-11T10:30:00+08:00');
  const DB = fakeDb({
    firstRows: [
      { value: JSON.stringify({ costPerGeneration: 1.25, costCurrency: 'usd', usdToTwdRate: 31.5, costControlEnabled: true, dailyCostLimitTwd: 100, monthlyCostLimitTwd: 1000, perUserDailyLimit: 3 }) },
      { count: 2, success_count: 1, total_cost_twd: 2.34567, total_point_cost: 5 },
      { count: 9, success_count: 8, total_cost_twd: 20, total_point_cost: 30 },
    ],
    allRows: [
      [{ line_user_id: 'U1', display_name: 'Tony', count: 2, total_cost_twd: 3.2, total_point_cost: 4, last_at: 123 }],
      [{ model_id: 'M1', model_title: '款式一', ai_model: 'gpt-image-2', count: 2, total_cost_twd: 3.2, total_point_cost: 4 }],
      [{ result_id: 'R1', line_user_id: 'U1', display_name: 'Tony', model_title: '款式一', ai_model: 'gpt-image-2', provider: 'openai', point_cost: 2, estimated_cost_twd: 1.5, actual_cost_usd: 0.05, cost_source: 'openai_usage', status: 'completed', created_at: 456 }],
    ],
  });
  const data = await getAiWearCostSummaryCandidate({ DB }, new URLSearchParams('limit=999'), { now: () => nowValue });
  assert.equal(DB.calls.length, 6);
  assert.deepEqual(DB.calls[0].bindings, ['ai_wear_settings']);
  assert.deepEqual(DB.calls[1].bindings, [Date.parse('2026-07-11T00:00:00+08:00')]);
  assert.deepEqual(DB.calls[2].bindings, [Date.parse('2026-07-01T00:00:00+08:00')]);
  assert.deepEqual(DB.calls[3].bindings, [Date.parse('2026-07-01T00:00:00+08:00'), 100]);
  assert.deepEqual(DB.calls[4].bindings, [Date.parse('2026-07-01T00:00:00+08:00'), 100]);
  assert.deepEqual(DB.calls[5].bindings, [100]);
  assert.equal(DB.calls.some((call) => /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i.test(call.sql)), false);
  assert.deepEqual(data.settings, { costPerGeneration: 1.25, costCurrency: 'USD', usdToTwdRate: 31.5, costControlEnabled: true, dailyCostLimitTwd: 100, monthlyCostLimitTwd: 1000, perUserDailyLimit: 3 });
  assert.deepEqual(data.today, { count: 2, successCount: 1, totalCostTwd: 2.3457, totalPointCost: 5 });
  assert.equal(data.byMember[0].displayName, 'Tony');
  assert.equal(data.byModel[0].aiModel, 'gpt-image-2');
  assert.equal(data.recent[0].costSource, 'openai_usage');
});

test('cost summary route stays on legacy when disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: {} }); };
  registerAiWearCostSummaryShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-cost-summary'), { SHADOW_AI_WEAR_COST_SUMMARY_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('cost summary candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb({ firstRows: [{ value: '{}' }, {}, {}], allRows: [[], [], []] });
  registerAiWearCostSummaryShadowRoute(router, {
    legacyFetch: async () => Response.json({ success: true, status: 'success', data: { legacy: true } }),
    logger: { info() {}, error() {} },
    now: () => Date.parse('2026-07-11T10:30:00+08:00'),
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-cost-summary'), { SHADOW_AI_WEAR_COST_SUMMARY_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 6);
  assert.deepEqual(await response.json(), { success: true, status: 'success', data: { legacy: true } });
});

test('cost summary candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb();
  registerAiWearCostSummaryShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-cost-summary'), { SHADOW_AI_WEAR_COST_SUMMARY_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('cost summary route metadata is read-only', () => {
  const router = createRouter();
  registerAiWearCostSummaryShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{ method: 'GET', id: 'AI-WEAR-COST-SUMMARY-SHADOW-001', path: '/api/ai-wear-cost-summary', risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_COST_SUMMARY_ENABLED' }]);
});
