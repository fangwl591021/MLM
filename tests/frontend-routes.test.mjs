import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  registerFrontendRoutes,
  rewriteKnowledgeBaseLinks,
  serveKnowledgeBaseHtml,
  serveDocsAsset,
} from '../src/modules/frontend/frontend.routes.js';

function makeApp({ fetchImpl, legacyResponse = Response.json({ status: 'legacy' }) } = {}) {
  const router = createRouter();
  registerFrontendRoutes(router, { fetchImpl: fetchImpl || (async () => new Response('<html>ok</html>')), now: () => 1 });
  let legacyCalls = 0;
  const app = createApp({
    router,
    legacyFetch: async () => {
      legacyCalls += 1;
      return legacyResponse;
    },
    randomUUID: () => 'req-frontend-001',
    now: (() => { let value = 1000; return () => value += 5; })(),
    logger: { error() {} },
  });
  return { app, getLegacyCalls: () => legacyCalls };
}

test('knowledge base link rewriting preserves legacy routing behavior', () => {
  const source = '<a href="console.html">A</a><a href="index.html?floor=main">B</a><a href="index.html?floor=admin">C</a><a href="index.html">D</a><a href="knowledge-base.html">E</a>';
  const rewritten = rewriteKnowledgeBaseLinks(source);
  assert.match(rewritten, /href="\/console"/);
  assert.match(rewritten, /href="\/dashboard\?floor=main"/);
  assert.match(rewritten, /href="\/dashboard\?floor=admin"/);
  assert.match(rewritten, /href="\/dashboard"/);
  assert.match(rewritten, /href="\/knowledge-base"/);
});

test('knowledge base route stays on legacy when feature flag is disabled', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/knowledge-base'), {
    MODULAR_KNOWLEDGE_BASE_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(getLegacyCalls(), 1);
});

test('knowledge base route uses modular handler when feature flag is true', async () => {
  const { app, getLegacyCalls } = makeApp({
    fetchImpl: async () => new Response('<a href="console.html">主控台</a>', { status: 200 }),
  });
  const response = await app.fetch(new Request('https://example.test/knowledge-base'), {
    MODULAR_KNOWLEDGE_BASE_ENABLED: 'true',
    ALLOWED_ORIGIN: 'https://console.example.test',
  }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, max-age=0');
  assert.equal(getLegacyCalls(), 0);
  assert.match(await response.text(), /href="\/console"/);
});

test('knowledge base html alias uses the same modular handler', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/knowledge-base.html'), {
    MODULAR_KNOWLEDGE_BASE_ENABLED: 'true',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(getLegacyCalls(), 0);
});

test('knowledge base source failure preserves legacy 502 contract', async () => {
  const response = await serveKnowledgeBaseHtml(
    new Request('https://example.test/knowledge-base', { headers: { Origin: 'https://console.example.test' } }),
    { ALLOWED_ORIGIN: 'https://console.example.test' },
    { fetchImpl: async () => new Response('missing', { status: 404 }), now: () => 1 },
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://console.example.test');
  assert.equal(await response.text(), 'Frontend source unavailable: knowledge-base.html');
});

test('docs route stays on legacy when feature flag is disabled', async () => {
  const { app, getLegacyCalls } = makeApp();
  const response = await app.fetch(new Request('https://example.test/docs/readme.md'), {
    MODULAR_DOCS_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(getLegacyCalls(), 1);
});

test('docs markdown route preserves content type, cache and source path', async () => {
  let requestedUrl = '';
  const { app, getLegacyCalls } = makeApp({
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response('# Guide', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
    },
  });
  const response = await app.fetch(new Request('https://example.test/docs/guide.md'), {
    MODULAR_DOCS_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-mlm-router'), 'modular');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(await response.text(), '# Guide');
  assert.match(requestedUrl, /\/docs\/guide\.md$/);
  assert.equal(getLegacyCalls(), 0);
});

test('docs route preserves upstream content type for non-markdown assets', async () => {
  const response = await serveDocsAsset(
    new Request('https://example.test/docs/diagram.svg'),
    {},
    '/docs/diagram.svg',
    { fetchImpl: async () => new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/svg+xml');
});

test('docs source failure and invalid path preserve legacy contracts', async () => {
  const missing = await serveDocsAsset(
    new Request('https://example.test/docs/missing.md'),
    {},
    '/docs/missing.md',
    { fetchImpl: async () => new Response('missing', { status: 404 }) },
  );
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Asset not found');

  const invalid = await serveDocsAsset(
    new Request('https://example.test/docs/file.md'),
    {},
    'docs/../secret.txt',
    { fetchImpl: async () => new Response('should not run') },
  );
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Invalid asset path');
});

test('frontend route metadata declares read-only canary behavior', () => {
  const router = createRouter();
  registerFrontendRoutes(router, { fetchImpl: async () => new Response('ok') });
  assert.deepEqual(router.list(), [
    {
      method: 'GET',
      id: 'FRONTEND-KNOWLEDGE-BASE-CANARY-001',
      path: '/knowledge-base|/knowledge-base.html',
      risk: 'low',
      write: false,
      featureFlag: 'MODULAR_KNOWLEDGE_BASE_ENABLED',
      externalSource: 'github-raw-main',
    },
    {
      method: 'GET',
      id: 'FRONTEND-DOCS-ASSET-CANARY-001',
      path: '/docs/*',
      risk: 'low',
      write: false,
      featureFlag: 'MODULAR_DOCS_ENABLED',
      externalSource: 'github-raw-main',
      cacheSeconds: 300,
    },
  ]);
});
