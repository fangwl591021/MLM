import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';
import { aiWearReferenceToClient } from './ai-wear-public.routes.js';

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

export async function listAiWearGalleryCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const rows = await env.DB.prepare(
    'SELECT id, title, series, file_name, mime_type, size, active, created_at, updated_at FROM ai_wear_references WHERE active = 1 ORDER BY updated_at DESC LIMIT 200',
  ).all();
  return { items: (rows.results || []).map((row) => aiWearReferenceToClient(row, env)) };
}

export async function aiWearGalleryCandidateResponse(request, env) {
  const data = await listAiWearGalleryCandidate(env);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAiWearGalleryShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-gallery' && env.SHADOW_AI_WEAR_GALLERY_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => aiWearGalleryCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AI-WEAR-GALLERY-SHADOW-001',
    path: '/api/ai-wear-gallery',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AI_WEAR_GALLERY_ENABLED',
  });
}
