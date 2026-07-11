import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const META_KEY = 'checkin_reward_template';
const DEFAULT_TEMPLATE = {
  active: true,
  keywords: ['簽到贈點活動'],
  altText: '簽到贈點活動',
  pages: [
    {
      imageUrl: 'https://k-link.cc/wp-content/uploads/2026/06/e9249f41c67958a396c3dddc07081d3d.jpg',
      imageLink: '', bubbleSize: 'nano', imageAspectRatio: '400:600', imageAspectMode: 'cover',
      buttons: [{ label: '簽到贈點', type: 'message', text: '會員打卡', uri: '', color: '' }],
    },
    {
      imageUrl: 'https://k-link.cc/wp-content/uploads/2026/06/94f5d7aa7084fc056863902be7adec78.jpg',
      imageLink: '', bubbleSize: 'nano', imageAspectRatio: '400:600', imageAspectMode: 'cover',
      buttons: [{ label: '點數查詢', type: 'uri', text: '', uri: 'https://liff.line.me/2007221311-c9SEkcRL', color: '#FF0000' }],
    },
  ],
};

const stringValue = (value) => value == null ? '' : String(value);

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = stringValue(item).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeBubbleSize(value) {
  const size = stringValue(value || 'nano').trim().toLowerCase();
  return ['nano', 'micro', 'deca', 'hecto', 'kilo', 'mega', 'giga'].includes(size) ? size : 'nano';
}
function normalizeAspectRatio(value) {
  const ratio = stringValue(value || '400:600').trim().replace(/[：]/g, ':');
  return /^\d{1,4}:\d{1,4}$/.test(ratio) ? ratio : '400:600';
}
function normalizeAspectMode(value) {
  const mode = stringValue(value || 'cover').trim().toLowerCase();
  return ['cover', 'fit'].includes(mode) ? mode : 'cover';
}
function normalizeColor(value) {
  const text = stringValue(value).trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : '';
}
function normalizeButton(button = {}) {
  const type = stringValue(button.type || button.actionType || 'message').toLowerCase() === 'uri' ? 'uri' : 'message';
  return {
    label: stringValue(button.label || '按鈕').slice(0, 40),
    type,
    text: stringValue(button.text || button.message || (type === 'message' ? '會員打卡' : '')).slice(0, 300),
    uri: stringValue(button.uri || button.url || '').trim(),
    color: normalizeColor(button.color),
  };
}
function normalizePage(page = {}) {
  const buttons = Array.isArray(page.buttons) ? page.buttons : [];
  return {
    imageUrl: stringValue(page.imageUrl || page.image_url || page.url).trim(),
    imageLink: stringValue(page.imageLink || page.image_link || page.link || page.actionUri).trim(),
    bubbleSize: normalizeBubbleSize(page.bubbleSize || page.bubble_size || page.imageSize || page.image_size || page.size),
    imageAspectRatio: normalizeAspectRatio(page.imageAspectRatio || page.image_aspect_ratio || page.aspectRatio || page.aspect_ratio),
    imageAspectMode: normalizeAspectMode(page.imageAspectMode || page.image_aspect_mode || page.aspectMode || page.aspect_mode),
    buttons: buttons.map(normalizeButton).filter((button) => button.label).slice(0, 4),
  };
}

export function normalizeCheckinTemplate(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const keywords = Array.isArray(source.keywords)
    ? source.keywords
    : stringValue(source.keyword || source.trigger || '簽到贈點活動').split(/[\n,，]/);
  const pages = (Array.isArray(source.pages) ? source.pages : []).map(normalizePage).filter((page) => page.imageUrl).slice(0, 12);
  return {
    active: source.active !== false,
    keywords: unique(keywords.map((item) => stringValue(item).trim())).slice(0, 12),
    altText: stringValue(source.altText || source.alt_text || '簽到贈點活動').slice(0, 400),
    pages: pages.length ? pages : DEFAULT_TEMPLATE.pages.map(normalizePage),
  };
}

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';
  return {
    'Access-Control-Allow-Origin': allowed && requestOrigin === allowed ? allowed : allowed || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Id-Token, X-Operator-Id, X-Operator-Name, X-User-Id, X-Admin-User, X-Admin-Name',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function getCheckinTemplateCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(META_KEY).first();
  if (!row || !row.value) return normalizeCheckinTemplate(DEFAULT_TEMPLATE);
  try { return normalizeCheckinTemplate(JSON.parse(row.value)); }
  catch (_) { return normalizeCheckinTemplate(DEFAULT_TEMPLATE); }
}

export async function checkinTemplateCandidateResponse(request, env) {
  const data = await getCheckinTemplateCandidate(env);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), { status: 200, headers: corsHeaders(request, env) });
}

export function registerCheckinTemplateShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/checkin-template' && env.SHADOW_CHECKIN_TEMPLATE_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => checkinTemplateCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'CHECKIN-TEMPLATE-SHADOW-001', path: '/api/checkin-template', risk: 'medium', write: false,
    mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_CHECKIN_TEMPLATE_ENABLED',
  });
}
