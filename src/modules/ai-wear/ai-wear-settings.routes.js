import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const SETTINGS_KEY = 'ai_wear_settings';
const DEFAULT_LIFF_ID = '2007221311-ISFxRBY3';
const DEFAULT_PROMPT = '請以人物照片為主圖，完整保留人物本人臉部特徵、臉型、五官、膚色、表情、眼神、髮型、衣服、拍攝角度、背景與光線。';

function stringValue(value) { return value == null ? '' : String(value); }
function numberValue(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function normalizePublicPath(value) {
  const text = stringValue(value).trim() || '/ai-wear';
  if (/^https?:\/\//i.test(text)) return '/ai-wear';
  const path = (text.startsWith('/') ? text : `/${text}`).replace(/\/+/g, '/').slice(0, 120) || '/ai-wear';
  return /^\/(api|admin|console|dashboard|assets|internal|line-webhook|webhook)(\/|$)/i.test(path) ? '/ai-wear' : path;
}
function normalizeLiffId(value) {
  const text = stringValue(value).trim();
  return /^\d+-[A-Za-z0-9_-]+$/.test(text) ? text.slice(0, 80) : DEFAULT_LIFF_ID;
}
function normalizeHttpsUrl(value) {
  const text = stringValue(value).trim();
  return /^https:\/\//i.test(text) ? text.slice(0, 500) : '';
}
function normalizeCurrency(value) { return stringValue(value).trim().toUpperCase() === 'USD' ? 'USD' : 'TWD'; }
function normalizePointType(value) { return stringValue(value) === 'system_point' ? 'system_point' : 'gift_money'; }

export function normalizeAiWearSettingsForClient(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const apiKey = stringValue(source.image2ApiKey || source.apiKey || source.api_key).trim();
  const pointChannelKey = ['oa1', 'oa2'].includes(stringValue(source.pointChannelKey || source.channel_key))
    ? stringValue(source.pointChannelKey || source.channel_key)
    : 'oa1';
  return {
    title: stringValue(source.title || '康立負離子眼鏡系列').slice(0, 80),
    publicPath: normalizePublicPath(source.publicPath || source.public_path),
    liffId: normalizeLiffId(source.liffId || source.liff_id),
    prompt: stringValue(source.prompt || DEFAULT_PROMPT).slice(0, 4000),
    imageModel: stringValue(source.imageModel || source.model || 'image2').slice(0, 60),
    imageApiUrl: normalizeHttpsUrl(source.imageApiUrl || source.image_api_url || source.apiUrl || source.api_url),
    aiweAjaxUrl: normalizeHttpsUrl(source.aiweAjaxUrl || source.aiwe_ajax_url || source.ajaxUrl || source.ajax_url || source.imageApiUrl || source.image_api_url),
    aiweNonce: stringValue(source.aiweNonce || source.aiwe_nonce || source.nonce).slice(0, 120),
    aiwePostId: stringValue(source.aiwePostId || source.aiwe_post_id || source.postId || source.post_id).slice(0, 40),
    image2ApiKey: '',
    pointDeductionEnabled: source.pointDeductionEnabled === true || source.point_deduction_enabled === true || source.deductPoints === true,
    pointCost: Math.max(0, Math.floor(numberValue(source.pointCost ?? source.point_cost, 0))),
    pointChannelKey,
    pointType: normalizePointType(source.pointType || source.point_type),
    costPerGeneration: Math.max(0, numberValue(source.costPerGeneration ?? source.cost_per_generation, 0)),
    costCurrency: normalizeCurrency(source.costCurrency || source.cost_currency),
    usdToTwdRate: Math.max(0, numberValue(source.usdToTwdRate ?? source.usd_to_twd_rate, 32)) || 32,
    costControlEnabled: source.costControlEnabled === true || source.cost_control_enabled === true,
    dailyCostLimitTwd: Math.max(0, Math.floor(numberValue(source.dailyCostLimitTwd ?? source.daily_cost_limit_twd, 0))),
    monthlyCostLimitTwd: Math.max(0, Math.floor(numberValue(source.monthlyCostLimitTwd ?? source.monthly_cost_limit_twd, 0))),
    perUserDailyLimit: Math.max(0, Math.floor(numberValue(source.perUserDailyLimit ?? source.per_user_daily_limit, 0))),
    hasImage2ApiKey: Boolean(apiKey),
  };
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

export async function getAiWearSettingsCandidate(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(SETTINGS_KEY).first();
  let stored = {};
  if (row && row.value) {
    try { stored = JSON.parse(row.value) || {}; } catch (_) { stored = {}; }
  }
  return normalizeAiWearSettingsForClient(stored);
}

export async function aiWearSettingsCandidateResponse(request, env) {
  const data = await getAiWearSettingsCandidate(env);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAiWearSettingsShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/ai-wear-settings' && env.SHADOW_AI_WEAR_SETTINGS_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => aiWearSettingsCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AI-WEAR-SETTINGS-SHADOW-001',
    path: '/api/ai-wear-settings',
    risk: 'medium',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AI_WEAR_SETTINGS_ENABLED',
  });
}
