import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  getKnowledgeManifestCandidate,
  getKnowledgeFileCandidate,
  registerKnowledgeReadShadowRoutes,
} from '../src/modules/knowledge/knowledge-read.routes.js';

function fakeDb(resultsByCall = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async all() { return { results: resultsByCall[calls.length - 1] || [] }; },
      };
    },
  };
}

test('manifest candidate groups sources and preserves legacy shape', async () => {
  const DB = fakeDb([[
    { source: 'knowledge/qa/product.json', category: '產品', count: 2, updated_at: 1700000000000 },
    { source: 'knowledge/qa/product.json', category: '制度', count: 1, updated_at: 1700000001000 },
  ]]);
  const data = await getKnowledgeManifestCandidate({ DB }, 'main');
  assert.equal(data.id, 'klink-knowledge');
  assert.equal(data.floor, 'main');
  assert.equal(data.count, 3);
  assert.equal(data.files.length, 1);
  assert.equal(data.files[0].path, 'knowledge/qa/product.json');
  assert.equal(data.files[0].folder, 'qa');
  assert.equal(data.files[0].count, 3);
  assert.deepEqual(DB.calls[0].bindings, ['main']);
});

test('file candidate preserves entries contract and returns null when missing', async () => {
  const DB = fakeDb([[
    { id: 7, category: '產品', question: '產品特色 功效', answer: '答案', source: 'knowledge/qa/a.json', created_at: 1700000000000 },
  ], []]);
  const data = await getKnowledgeFileCandidate({ DB }, 'admin', 'knowledge/qa/a.json');
  assert.equal(data.source, 'knowledge/qa/a.json');
  assert.equal(data.entries[0].id, 'item_7');
  assert.deepEqual(data.entries[0].tags, ['產品']);
  assert.deepEqual(DB.calls[0].bindings, ['admin', 'knowledge/qa/a.json']);
  assert.equal(await getKnowledgeFileCandidate({ DB }, 'admin', 'missing.json'), null);
});

function buildApp({ legacyResponse, DB, flag = 'true' }) {
  const router = createRouter();
  let legacyCalls = 0;
  registerKnowledgeReadShadowRoutes(router, {
    legacyFetch: async () => { legacyCalls += 1; return legacyResponse; },
    logger: { info() {}, error() {} },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  return { app, env: { SHADOW_KNOWLEDGE_READ_ENABLED: flag, DB }, legacyCalls: () => legacyCalls };
}

test('manifest shadow runs only after legacy success and returns legacy response', async () => {
  const DB = fakeDb([[]]);
  const legacyResponse = Response.json({ success: true, status: 'success', data: { legacy: true } });
  const fixture = buildApp({ legacyResponse, DB });
  const response = await fixture.app.fetch(new Request('https://example.test/api/knowledge/manifest?floor=smart'), fixture.env, {});
  assert.equal(response.status, 200);
  assert.equal(fixture.legacyCalls(), 1);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(DB.calls[0].bindings, ['smart']);
  assert.deepEqual(await response.json(), { success: true, status: 'success', data: { legacy: true } });
});

test('knowledge candidate is skipped when legacy authorization fails', async () => {
  const DB = fakeDb([[]]);
  const fixture = buildApp({ legacyResponse: Response.json({ status: 'error' }, { status: 401 }), DB });
  const response = await fixture.app.fetch(new Request('https://example.test/api/knowledge/manifest'), fixture.env, {});
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test('file shadow compares legacy 400 and 404 without querying when legacy rejects authorization', async () => {
  const DB = fakeDb([[]]);
  const fixture = buildApp({ legacyResponse: Response.json({ success: false, status: 'error', message: 'path is required' }, { status: 400 }), DB });
  const response = await fixture.app.fetch(new Request('https://example.test/api/knowledge/file'), fixture.env, {});
  assert.equal(response.status, 400);
  assert.equal(DB.calls.length, 0);
});

test('knowledge routes stay on legacy when flag is disabled', async () => {
  const router = createRouter();
  let legacyCalls = 0;
  registerKnowledgeReadShadowRoutes(router, { legacyFetch: async () => Response.json({}) });
  const app = createApp({ router, legacyFetch: async () => { legacyCalls += 1; return Response.json({ status: 'legacy' }); } });
  const response = await app.fetch(new Request('https://example.test/api/knowledge/manifest'), { SHADOW_KNOWLEDGE_READ_ENABLED: 'false' }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(legacyCalls, 1);
});

test('knowledge shadow metadata declares two read-only routes', () => {
  const router = createRouter();
  registerKnowledgeReadShadowRoutes(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list().map(({ id, path, write, mode, featureFlag }) => ({ id, path, write, mode, featureFlag })), [
    { id: 'KNOWLEDGE-MANIFEST-SHADOW-001', path: '/api/knowledge/manifest', write: false, mode: 'shadow-read', featureFlag: 'SHADOW_KNOWLEDGE_READ_ENABLED' },
    { id: 'KNOWLEDGE-FILE-SHADOW-001', path: '/api/knowledge/file', write: false, mode: 'shadow-read', featureFlag: 'SHADOW_KNOWLEDGE_READ_ENABLED' },
  ]);
});
