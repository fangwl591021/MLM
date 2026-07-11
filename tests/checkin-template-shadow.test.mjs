import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import { getCheckinTemplateCandidate, normalizeCheckinTemplate, registerCheckinTemplateShadowRoute } from '../src/modules/checkin/checkin-template.routes.js';

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

test('checkin template candidate performs one pure select and falls back to default template', async () => {
  const DB = fakeDb(null);
  const data = await getCheckinTemplateCandidate({ DB });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /^SELECT /);
  assert.doesNotMatch(DB.calls[0].sql, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(DB.calls[0].bindings, ['checkin_reward_template']);
  assert.equal(data.active, true);
  assert.equal(data.pages.length, 2);
  assert.equal(data.pages[0].buttons[0].text, '會員打卡');
});

test('checkin template normalization preserves legacy limits and defaults', () => {
  const data = normalizeCheckinTemplate({
    active: false,
    keywords: [' 簽到 ', '簽到', '活動'],
    alt_text: 'A'.repeat(450),
    pages: [{
      image_url: 'https://example.test/a.jpg', bubble_size: 'invalid', image_aspect_ratio: '400：600', image_aspect_mode: 'FIT',
      buttons: [{ label: '查詢', type: 'uri', uri: 'https://example.test', color: '#ff0000' }, { label: '', type: 'message' }],
    }],
  });
  assert.equal(data.active, false);
  assert.deepEqual(data.keywords, ['簽到', '活動']);
  assert.equal(data.altText.length, 400);
  assert.equal(data.pages[0].bubbleSize, 'nano');
  assert.equal(data.pages[0].imageAspectRatio, '400:600');
  assert.equal(data.pages[0].imageAspectMode, 'fit');
  assert.equal(data.pages[0].buttons[0].color, '#FF0000');
});

test('checkin route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: {} }); };
  registerCheckinTemplateShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/checkin-template'), { SHADOW_CHECKIN_TEMPLATE_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('checkin candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb({ value: JSON.stringify({ active: true, keywords: ['會員打卡'], pages: [] }) });
  let calls = 0;
  registerCheckinTemplateShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json({ success: true, status: 'success', data: { active: true } }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/checkin-template'), { SHADOW_CHECKIN_TEMPLATE_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), { success: true, status: 'success', data: { active: true } });
});

test('checkin candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb(null);
  registerCheckinTemplateShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/checkin-template'), { SHADOW_CHECKIN_TEMPLATE_ENABLED: 'true', DB }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('checkin shadow route metadata is read-only', () => {
  const router = createRouter();
  registerCheckinTemplateShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'CHECKIN-TEMPLATE-SHADOW-001', path: '/api/checkin-template', risk: 'medium', write: false,
    mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_CHECKIN_TEMPLATE_ENABLED',
  }]);
});
