const FRONTEND_RAW_BASE = 'https://raw.githubusercontent.com/fangwl591021/MLM/main';
const FRONTEND_BUILD_ID = 'modular-knowledge-base-20260711-1';

export function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedOrigin = env.ALLOWED_ORIGIN || '';
  const origin = allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Id-Token, X-Operator-Id, X-Operator-Name, X-User-Id, X-Admin-User, X-Admin-Name',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function rewriteKnowledgeBaseLinks(html) {
  return String(html || '')
    .replaceAll('href="console.html"', 'href="/console"')
    .replaceAll("href='console.html'", "href='/console'")
    .replaceAll('href="index.html?floor=main"', 'href="/dashboard?floor=main"')
    .replaceAll("href='index.html?floor=main'", "href='/dashboard?floor=main'")
    .replaceAll('href="index.html?floor=admin"', 'href="/dashboard?floor=admin"')
    .replaceAll("href='index.html?floor=admin'", "href='/dashboard?floor=admin'")
    .replaceAll('href="index.html"', 'href="/dashboard"')
    .replaceAll("href='index.html'", "href='/dashboard'")
    .replaceAll('href="knowledge-base.html"', 'href="/knowledge-base"')
    .replaceAll("href='knowledge-base.html'", "href='/knowledge-base'");
}

export async function serveKnowledgeBaseHtml(request, env, { fetchImpl = fetch, now = Date.now } = {}) {
  const corsHeaders = buildCorsHeaders(request, env);
  const sourceUrl = `${FRONTEND_RAW_BASE}/knowledge-base.html?v=${FRONTEND_BUILD_ID}-${now()}`;
  const sourceResponse = await fetchImpl(sourceUrl, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    cf: { cacheEverything: false, cacheTtl: 0 },
  });

  if (!sourceResponse.ok) {
    return new Response('Frontend source unavailable: knowledge-base.html', {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const html = rewriteKnowledgeBaseLinks(await sourceResponse.text());
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

export async function serveDocsAsset(request, env, pathname, { fetchImpl = fetch } = {}) {
  const corsHeaders = buildCorsHeaders(request, env);
  const safePath = String(pathname || '').replace(/^\/+/, '');

  if (!safePath || safePath.includes('..')) {
    return new Response('Invalid asset path', {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const sourceResponse = await fetchImpl(`${FRONTEND_RAW_BASE}/${safePath}`, {
    cf: { cacheEverything: true, cacheTtl: 300 },
  });

  if (!sourceResponse.ok) {
    return new Response('Asset not found', {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const contentType = safePath.endsWith('.md')
    ? 'text/plain; charset=utf-8'
    : (sourceResponse.headers.get('Content-Type') || 'application/octet-stream');

  return new Response(sourceResponse.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export function registerFrontendRoutes(router, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || Date.now;

  router.get((url, _request, env) => {
    if (url.pathname !== '/knowledge-base' && url.pathname !== '/knowledge-base.html') return false;
    return env.MODULAR_KNOWLEDGE_BASE_ENABLED === 'true';
  }, (request, env) => serveKnowledgeBaseHtml(request, env, { fetchImpl, now }), {
    id: 'FRONTEND-KNOWLEDGE-BASE-CANARY-001',
    path: '/knowledge-base|/knowledge-base.html',
    risk: 'low',
    write: false,
    featureFlag: 'MODULAR_KNOWLEDGE_BASE_ENABLED',
    externalSource: 'github-raw-main',
  });

  router.get((url, _request, env) => {
    return url.pathname.startsWith('/docs/') && env.MODULAR_DOCS_ENABLED === 'true';
  }, (request, env, _ctx, { url }) => serveDocsAsset(request, env, url.pathname, { fetchImpl }), {
    id: 'FRONTEND-DOCS-ASSET-CANARY-001',
    path: '/docs/*',
    risk: 'low',
    write: false,
    featureFlag: 'MODULAR_DOCS_ENABLED',
    externalSource: 'github-raw-main',
    cacheSeconds: 300,
  });
}
