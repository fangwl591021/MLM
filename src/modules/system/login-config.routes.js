import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

function stringValue(value) {
  return value == null ? '' : String(value).trim();
}

function buildCorsHeaders(request, env) {
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

export function loginConfigCandidate(request, env = {}) {
  const liffId = stringValue(env.DASHBOARD_LIFF_ID);
  return {
    status: 'success',
    data: {
      liffId,
      lineLoginEnabled: Boolean(liffId),
      apiBase: new URL(request.url).origin,
    },
  };
}

export function loginConfigCandidateResponse(request, env) {
  return new Response(JSON.stringify(loginConfigCandidate(request, env)), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerLoginConfigShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/login-config' && env.SHADOW_LOGIN_CONFIG_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => loginConfigCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'LOGIN-CONFIG-SHADOW-001',
    path: '/api/login-config',
    risk: 'low',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_LOGIN_CONFIG_ENABLED',
  });
}
