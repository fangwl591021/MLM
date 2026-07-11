import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const SETTINGS_KEY = 'ai_wear_settings';
const REFERENCE_PREFIX = '/assets/ai-wear/reference/';
const DEFAULT_PUBLIC_BASE_URL = 'https://mlm.fangwl591021.workers.dev';
const DEFAULT_LIFF_ID = '2007221311-ISFxRBY3';
const DEFAULT_PROMPT = `請以人物照片為主圖，完整保留人物本人臉部特徵、臉型、五官、膚色、表情、眼神、髮型、衣服、拍攝角度、背景與光線。

請以眼鏡參考圖作為眼鏡款式來源，只參考眼鏡本身，不參考圖片中的人物、背景或其他元素。

請將眼鏡參考圖中的眼鏡自然套用到人物照片的人物臉上，包含鏡框形狀、顏色、材質、粗細、鏡片大小、鏡片形狀、鼻墊、鏡腳、鏡片透明度與反光效果。

若人物照片原本已配戴眼鏡，請先自然移除原本眼鏡，再換上新的參考眼鏡。新眼鏡必須符合人物臉部角度、鼻樑位置、眼睛位置、耳朵方向與頭部透視，並加入自然陰影、反光與接觸感。

最終結果必須像人物本人實際戴上這副眼鏡的真實照片。除了眼鏡之外，不得修改人物長相、髮型、衣服、背景、姿勢、光線與照片風格。`;

const DEFAULT_SETTINGS = {
  title: '康立負離子眼鏡系列',
  publicPath: '/ai-wear',
  liffId: DEFAULT_LIFF_ID,
  prompt: DEFAULT_PROMPT,
  imageModel: 'image2',
  imageApiUrl: '',
  aiweAjaxUrl: '',
  aiweNonce: '',
  aiwePostId: '',
  pointDeductionEnabled: false,
  pointCost: 0,
  pointChannelKey: 'oa1',
  pointType: 'gift_money',
};

function stringValue(value) {
  return value == null ? '' : String(value);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePublicPath(value) {
  const text = stringValue(value).trim() || '/ai-wear';
  if (/^https?:\/\//i.test(text)) return '/ai-wear';
  const path = (text.startsWith('/') ? text : `/${text}`).replace(/\/+/g, '/').slice(0, 120) || '/ai-wear';
  if (/^\/(api|admin|console|dashboard|assets|internal|line-webhook|webhook)(\/|$)/i.test(path)) return '/ai-wear';
  return path;
}

function normalizeLiffId(value) {
  const text = stringValue(value).trim();
  return /^\d+-[A-Za-z0-9_-]+$/.test(text) ? text.slice(0, 80) : DEFAULT_LIFF_ID;
}

function normalizeHttpsUrl(value) {
  const text = stringValue(value).trim();
  return /^https:\/\//i.test(text) ? text.slice(0, 500) : '';
}

function normalizePointType(value) {
  return stringValue(value) === 'system_point' ? 'system_point' : 'gift_money';
}

export function normalizePublicAiWearSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const pointChannelKey = ['oa1', 'oa2'].includes(stringValue(source.pointChannelKey || source.channel_key))
    ? stringValue(source.pointChannelKey || source.channel_key)
    : DEFAULT_SETTINGS.pointChannelKey;
  return {
    title: stringValue(source.title || DEFAULT_SETTINGS.title).slice(0, 80),
    publicPath: normalizePublicPath(source.publicPath || source.public_path || DEFAULT_SETTINGS.publicPath),
    liffId: normalizeLiffId(source.liffId || source.liff_id || DEFAULT_SETTINGS.liffId),
    prompt: stringValue(source.prompt || DEFAULT_SETTINGS.prompt).slice(0, 4000),
    imageModel: stringValue(source.imageModel || source.model || DEFAULT_SETTINGS.imageModel).slice(0, 60),
    imageApiUrl: normalizeHttpsUrl(source.imageApiUrl || source.image_api_url || source.apiUrl || source.api_url),
    aiweAjaxUrl: normalizeHttpsUrl(source.aiweAjaxUrl || source.aiwe_ajax_url || source.ajaxUrl || source.ajax_url || source.imageApiUrl || source.image_api_url),
    aiweNonce: stringValue(source.aiweNonce || source.aiwe_nonce || source.nonce).slice(0, 120),
    aiwePostId: stringValue(source.aiwePostId || source.aiwe_post_id || source.postId || source.post_id).slice(0, 40),
    image2ApiKey: '',
    pointDeductionEnabled: source.pointDeductionEnabled === true || source.point_deduction_enabled === true || source.deductPoints === true,
    pointCost: Math.max(0, Math.floor(Number(source.pointCost ?? source.point_cost ?? DEFAULT_SETTINGS.pointCost) || 0)),
    pointChannelKey,
    pointType: normalizePointType(source.pointType || source.point_type || DEFAULT_SETTINGS.pointType),
    hasImage2ApiKey: Boolean(stringValue(source.image2ApiKey || source.apiKey || source.api_key).trim()),
  };
}

function publicBaseUrl(env) {
  return stringValue(env.PUBLIC_BASE_URL || env.WORKER_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
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

function referenceToClient(row, env) {
  const id = stringValue(row.id);
  const version = numberOrZero(row.updated_at) || numberOrZero(row.created_at);
  return {
    id,
    title: stringValue(row.title),
    series: stringValue(row.series),
    fileName: stringValue(row.file_name),
    mimeType: stringValue(row.mime_type),
    size: numberOrZero(row.size),
    url: `${publicBaseUrl(env)}${REFERENCE_PREFIX}${encodeURIComponent(id)}?v=${version}`,
    createdAt: numberOrZero(row.created_at),
    updatedAt: numberOrZero(row.updated_at),
  };
}

export async function getAiWearPublicCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const [settingsRow, references] = await Promise.all([
    env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(SETTINGS_KEY).first(),
    env.DB.prepare('SELECT id, title, series, file_name, mime_type, size, active, created_at, updated_at FROM ai_wear_references WHERE active = 1 ORDER BY updated_at DESC LIMIT 200').all(),
  ]);
  let stored = {};
  if (settingsRow && settingsRow.value) {
    try { stored = JSON.parse(settingsRow.value) || {}; } catch (_) { stored = {}; }
  }
  return {
    settings: normalizePublicAiWearSettings(stored),
    gallery: (references.results || []).map((row) => referenceToClient(row, env)),
  };
}

export async function aiWearPublicCandidateResponse(request, env) {
  const data = await getAiWearPublicCandidate(env);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAiWearPublicShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-public' && env.SHADOW_AI_WEAR_PUBLIC_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => aiWearPublicCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AI-WEAR-PUBLIC-SHADOW-001',
    path: '/api/ai-wear-public',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AI_WEAR_PUBLIC_ENABLED',
  });
}
