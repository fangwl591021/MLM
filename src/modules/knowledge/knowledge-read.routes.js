import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const FLOOR_IDS = new Set(['main', 'admin', 'smart']);

function stringValue(value) {
  return value == null ? '' : String(value);
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

function resolveFloor(request) {
  const url = new URL(request.url);
  const raw = stringValue(url.searchParams.get('floor') || request.headers.get('x-floor-id') || 'main').toLowerCase();
  return FLOOR_IDS.has(raw) ? raw : 'main';
}

function safeKnowledgeSlug(path) {
  return stringValue(path)
    .toLowerCase()
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'knowledge-file';
}

function knowledgeTitleFromPath(path) {
  const base = stringValue(path).split('/').filter(Boolean).pop() || '知識庫檔案';
  return base.replace(/\.json$/i, '').replace(/[-_]+/g, ' ').trim() || '知識庫檔案';
}

function knowledgeFolderFromPath(path, category) {
  const parts = stringValue(path).split('/').filter(Boolean);
  if (parts[0] === 'knowledge' && parts[1]) return parts[1];
  return stringValue(category || 'legacy').replace(/\s+/g, '_') || 'legacy';
}

function knowledgeFileEntry(path, normalized, count, updatedAt) {
  const safePath = stringValue(path || 'dashboard-upload.json') || 'dashboard-upload.json';
  return {
    id: safeKnowledgeSlug(safePath),
    folder: knowledgeFolderFromPath(safePath, normalized.category),
    title: normalized.title || knowledgeTitleFromPath(safePath),
    path: safePath,
    category: normalized.category || '一般',
    status: 'published',
    source: safePath,
    count: Number(count || 0),
    updated_at: updatedAt ? new Date(Number(updatedAt)).toISOString() : '',
  };
}

function tokenize(value) {
  return Array.from(new Set(stringValue(value)
    .toLowerCase()
    .split(/[\s,，。！？!?、/\\\-_:：;；()[\]{}「」『』【】《》〈〉.．]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)))
    .slice(0, 8);
}

export async function getKnowledgeManifestCandidate(env, floor) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const rows = await env.DB.prepare(`
    SELECT source, category, COUNT(*) AS count, MAX(created_at) AS updated_at
    FROM knowledge_items
    WHERE floor_id = ?
    GROUP BY source, category
    ORDER BY MAX(created_at) DESC, source ASC
  `).bind(floor).all();

  const bySource = new Map();
  for (const row of rows.results || []) {
    const source = stringValue(row.source || 'dashboard-upload.json') || 'dashboard-upload.json';
    if (!bySource.has(source)) bySource.set(source, { source, categories: [], count: 0, updatedAt: 0 });
    const current = bySource.get(source);
    current.categories.push(stringValue(row.category || '一般'));
    current.count += Number(row.count || 0);
    current.updatedAt = Math.max(current.updatedAt, Number(row.updated_at || 0));
  }

  const files = Array.from(bySource.values()).map((item) => knowledgeFileEntry(
    item.source,
    { title: knowledgeTitleFromPath(item.source), category: item.categories[0], version: '' },
    item.count,
    item.updatedAt,
  ));
  const total = files.reduce((sum, file) => sum + Number(file.count || 0), 0);
  return {
    id: 'klink-knowledge',
    title: 'KLINK 知識庫',
    version: new Date().toISOString().slice(0, 10),
    floor,
    count: total,
    files,
  };
}

export async function getKnowledgeFileCandidate(env, floor, path) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const rows = await env.DB.prepare(`
    SELECT id, category, question, answer, source, created_at
    FROM knowledge_items
    WHERE floor_id = ? AND source = ?
    ORDER BY id ASC
  `).bind(floor, path).all();
  const items = rows.results || [];
  if (!items.length) return null;
  const first = items[0];
  return {
    id: safeKnowledgeSlug(path),
    title: knowledgeTitleFromPath(path),
    source: path,
    version: first.created_at ? new Date(Number(first.created_at)).toISOString().slice(0, 10) : '',
    status: 'published',
    category: first.category || '一般',
    usage: '供 KLINK 客服監看與 AI 建議回覆比對使用。',
    entries: items.map((row) => ({
      id: `item_${row.id}`,
      title: row.question,
      keywords: tokenize(row.question),
      answer: row.answer,
      reply_template: row.answer,
      tags: [row.category || '一般'],
    })),
  };
}

async function manifestCandidateResponse(request, env) {
  const data = await getKnowledgeManifestCandidate(env, resolveFloor(request));
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

async function fileCandidateResponse(request, env) {
  const url = new URL(request.url);
  const path = stringValue(url.searchParams.get('path'));
  if (!path) {
    return new Response(JSON.stringify({ success: false, status: 'error', message: 'path is required' }), {
      status: 400,
      headers: buildCorsHeaders(request, env),
    });
  }
  const data = await getKnowledgeFileCandidate(env, resolveFloor(request), path);
  if (!data) {
    return new Response(JSON.stringify({ success: false, status: 'error', message: 'KNOWLEDGE_FILE_NOT_FOUND' }), {
      status: 404,
      headers: buildCorsHeaders(request, env),
    });
  }
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerKnowledgeReadShadowRoutes(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/knowledge/manifest' && env.SHADOW_KNOWLEDGE_READ_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => manifestCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
      compareOptions: { ignoredBodyPaths: ['data.version'] },
    });
    return result.response;
  }, {
    id: 'KNOWLEDGE-MANIFEST-SHADOW-001',
    path: '/api/knowledge/manifest',
    risk: 'medium',
    write: false,
    mode: 'shadow-read',
    featureFlag: 'SHADOW_KNOWLEDGE_READ_ENABLED',
  });

  router.get((url, _request, env) => url.pathname === '/api/knowledge/file' && env.SHADOW_KNOWLEDGE_READ_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => fileCandidateResponse(request, env),
      logger,
      allowedStatuses: [200, 400, 404],
    });
    return result.response;
  }, {
    id: 'KNOWLEDGE-FILE-SHADOW-001',
    path: '/api/knowledge/file',
    risk: 'medium',
    write: false,
    mode: 'shadow-read',
    featureFlag: 'SHADOW_KNOWLEDGE_READ_ENABLED',
  });
}
