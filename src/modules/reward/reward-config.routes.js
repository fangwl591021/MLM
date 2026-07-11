import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const DEFAULT_REWARD_LIFF_ID = '2007221311-WjM9sZPz';
const DEFAULT_REWARD_POINTS = 1;
const DEFAULT_CALENDAR_POINTS = 10;
const CALENDAR_AUTO = 'calendar_auto';
const NFC_TEST_PREFIX = 'nfc_test_';
const CAMPAIGN_POINTS = {
  smart_202605: 1,
  smart_202605_5: 10,
};

function stringValue(value) {
  return value == null ? '' : String(value);
}

export function normalizeRewardCampaign(value) {
  const text = stringValue(value || 'smart_202605').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return text || 'smart_202605';
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

export function rewardConfigCandidate(url, env = {}) {
  const campaign = normalizeRewardCampaign(url.searchParams.get('campaign') || 'smart_202605');
  const calendarMode = campaign === CALENDAR_AUTO || campaign.startsWith(NFC_TEST_PREFIX);
  const points = calendarMode
    ? positiveInteger(env.REWARD_CALENDAR_POINTS, DEFAULT_CALENDAR_POINTS)
    : positiveInteger(CAMPAIGN_POINTS[campaign], DEFAULT_REWARD_POINTS);
  return {
    success: true,
    status: 'success',
    liffId: stringValue(env.REWARD_LIFF_ID) || DEFAULT_REWARD_LIFF_ID,
    campaign,
    points,
    source: '康立智能',
    calendarMode,
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

export function rewardConfigCandidateResponse(request, env) {
  const data = rewardConfigCandidate(new URL(request.url), env);
  return new Response(JSON.stringify(data), { status: 200, headers: buildCorsHeaders(request, env) });
}

export function registerRewardConfigShadowRoute(router, { legacyFetch, logger = console } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/reward/config' && env.SHADOW_REWARD_CONFIG_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => rewardConfigCandidateResponse(request, env),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'REWARD-CONFIG-SHADOW-001',
    path: '/api/reward/config',
    risk: 'low',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_REWARD_CONFIG_ENABLED',
  });
}
