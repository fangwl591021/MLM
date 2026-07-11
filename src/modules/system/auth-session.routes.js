import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const ACCESS_LIST_IDS = new Set(['main', 'admin', 'smart', 'admin_all']);

function stringValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function readCookie(request, name) {
  const cookie = stringValue(request.headers.get('Cookie'));
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return '';
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signConsoleSession(env, encodedPayload) {
  const secret = stringValue(env.ADMIN_TOKEN || env.DASHBOARD_API_TOKEN || env.OPENAI_API_KEY || 'klink-console-session');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  const a = stringValue(left);
  const b = stringValue(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export async function verifyConsoleSessionCandidate(request, env, { now = Date.now } = {}) {
  const value = readCookie(request, 'kl_console_session');
  if (!value || !value.includes('.')) return { ok: false, message: 'Console session is required' };
  const parts = value.split('.');
  if (parts.length !== 2) return { ok: false, message: 'Console session format is invalid' };
  const expected = await signConsoleSession(env, parts[0]);
  if (!constantTimeEqual(expected, parts[1])) return { ok: false, message: 'Console session signature is invalid' };
  let payload = null;
  try { payload = JSON.parse(base64UrlDecode(parts[0])); } catch (_error) { payload = null; }
  if (!payload || !payload.uid) return { ok: false, message: 'Console session payload is invalid' };
  if (Number(payload.exp || 0) <= Math.floor(now() / 1000)) return { ok: false, message: 'Console session expired' };
  return {
    ok: true,
    profile: {
      userId: stringValue(payload.uid),
      displayName: stringValue(payload.name),
      pictureUrl: stringValue(payload.picture),
      admin: Boolean(payload.admin),
      floors: Array.isArray(payload.floors) ? payload.floors.filter((floor) => ACCESS_LIST_IDS.has(floor)) : [],
    },
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

export async function authSessionCandidateResponse(request, env, options = {}) {
  const session = await verifyConsoleSessionCandidate(request, env, options);
  if (!session.ok) {
    return new Response(JSON.stringify({ status: 'error', message: session.message || '尚未登入' }), {
      status: 401,
      headers: buildCorsHeaders(request, env),
    });
  }
  const access = {
    allowed: true,
    admin: Boolean(session.profile.admin),
    floors: Array.isArray(session.profile.floors) ? session.profile.floors : [],
  };
  return new Response(JSON.stringify({ status: 'success', profile: session.profile, access }), {
    status: 200,
    headers: buildCorsHeaders(request, env),
  });
}

export function registerAuthSessionShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/api/auth/session' && env.SHADOW_AUTH_SESSION_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => authSessionCandidateResponse(request, env, { now }),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'AUTH-SESSION-SHADOW-001',
    path: '/api/auth/session',
    risk: 'high',
    write: false,
    mode: 'shadow-read-after-legacy',
    featureFlag: 'SHADOW_AUTH_SESSION_ENABLED',
  });
}
