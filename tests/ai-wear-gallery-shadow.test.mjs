import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  listAiWearGalleryCandidate,
  registerAiWearGalleryShadowRoute,
} from '../src/modules/ai-wear/ai-wear-gallery.routes.js';

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return { async all() { return { results: rows }; } };
    },
  };
}

test('gallery candidate is pure select and preserves ordering and mapping', async () => {
  const DB = fakeDb([{
    id: 'frame 1.jpg', title: '款式一', series: '第一系列', file_name: 'frame.jpg',
    mime_type: 'image/jpeg', size: 123, active: 1, created_at: 10, updated_at: 20,
  }]);
  const data = await listAiWearGalleryCandidate({ DB, PUBLIC_BASE_URL: 'https://staging.example.test/' });
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0], /^SELECT /);
  assert.match(DB.calls[0], /WHERE active = 1 ORDER BY updated_at DESC LIMIT 200/);
  assert.doesNotMatch(DB.calls[0], /\b(CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(data, { items: [{
    id: 'frame 1.jpg', title: '款式一', series: '第一系列', fileName: 'frame.jpg',
    mimeType: 'image/jpeg', size: 123,
    url: 'https://staging.example.test/assets/ai-wear/reference/frame%201.jpg?v=20',
    createdAt: 10, updatedAt: 20,
  }] });
});

test('gallery route stays on legacy when flag is disabled', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ success: true, status: 'success', data: { items: [] } }); };
  registerAiWearGalleryShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-gallery'), {
    SHADOW_AI_WEAR_GALLERY_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('gallery candidate runs only after successful dashboard authorization', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  let calls = 0;
  registerAiWearGalleryShadowRoute(router, {
    legacyFetch: async () => { calls += 1; return Response.json({ success: true, status: 'success', data: { items: [] } }); },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-gallery'), {
    SHADOW_AI_WEAR_GALLERY_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(await response.json(), { success: true, status: 'success', data: { items: [] } });
});

test('gallery candidate does not query D1 when legacy authorization fails', async () => {
  const router = createRouter();
  const DB = fakeDb([]);
  registerAiWearGalleryShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/ai-wear-gallery'), {
    SHADOW_AI_WEAR_GALLERY_ENABLED: 'true', DB,
  }, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('gallery shadow route metadata is read-only', () => {
  const router = createRouter();
  registerAiWearGalleryShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AI-WEAR-GALLERY-SHADOW-001', path: '/api/ai-wear-gallery',
    risk: 'medium', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AI_WEAR_GALLERY_ENABLED',
  }]);
});
