import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import {
  verifyConsoleSessionCandidate,
  registerAuthSessionShadowRoute,
} from '../src/modules/system/auth-session.routes.js';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

async function sign(secret, encodedPayload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  return Buffer.from(digest).toString('base64url');
}

async function sessionCookie(payload, secret = 'admin-secret') {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `kl_console_session=${encoded}.${await sign(secret, encoded)}`;
}

test('auth session validates signature, expiry, profile and allowed floors', async () => {
  const nowMs = 1_800_000_000_000;
  const cookie = await sessionCookie({
    uid: 'U123', name: 'Tony', picture: 'https://example.test/a.jpg', admin: true,
    floors: ['main', 'admin_all', 'invalid'], exp: Math.floor(nowMs / 1000) + 60,
  });
  const result = await verifyConsoleSessionCandidate(new Request('https://example.test/api/auth/session', {
    headers: { Cookie: cookie },
  }), { ADMIN_TOKEN: 'admin-secret' }, { now: () => nowMs });
  assert.deepEqual(result, {
    ok: true,
    profile: {
      userId: 'U123', displayName: 'Tony', pictureUrl: 'https://example.test/a.jpg',
      admin: true, floors: ['main', 'admin_all'],
    },
  });
});

test('auth session rejects missing, malformed, invalid and expired cookies', async () => {
  const request = new Request('https://example.test/api/auth/session');
  assert.equal((await verifyConsoleSessionCandidate(request, {})).message, 'Console session is required');

  const malformed = new Request(request, { headers: { Cookie: 'kl_console_session=a.b.c' } });
  assert.equal((await verifyConsoleSessionCandidate(malformed, {})).message, 'Console session format is invalid');

  const invalid = new Request(request, { headers: { Cookie: 'kl_console_session=abc.bad' } });
  assert.equal((await verifyConsoleSessionCandidate(invalid, {})).message, 'Console session signature is invalid');

  const nowMs = 1_800_000_000_000;
  const expiredCookie = await sessionCookie({ uid: 'U1', exp: Math.floor(nowMs / 1000) }, 'dash-secret');
  const expired = new Request(request, { headers: { Cookie: expiredCookie } });
  assert.equal((await verifyConsoleSessionCandidate(expired, { DASHBOARD_API_TOKEN: 'dash-secret' }, { now: () => nowMs })).message, 'Console session expired');
});

test('auth session flag disabled stays on legacy', async () => {
  const router = createRouter();
  let calls = 0;
  const legacyFetch = async () => { calls += 1; return Response.json({ status: 'success', marker: 'legacy' }); };
  registerAuthSessionShadowRoute(router, { legacyFetch });
  const app = createApp({ router, legacyFetch });
  const response = await app.fetch(new Request('https://example.test/api/auth/session'), {
    SHADOW_AUTH_SESSION_ENABLED: 'false',
  }, {});
  assert.equal(response.headers.get('x-mlm-router'), 'legacy');
  assert.equal(calls, 1);
});

test('auth session candidate runs after legacy 200 and external response remains legacy', async () => {
  const nowMs = 1_800_000_000_000;
  const cookie = await sessionCookie({ uid: 'U1', name: 'Tony', admin: false, floors: ['smart'], exp: Math.floor(nowMs / 1000) + 60 });
  const router = createRouter();
  const legacyBody = { status: 'success', profile: { userId: 'legacy' }, access: { allowed: true } };
  registerAuthSessionShadowRoute(router, {
    legacyFetch: async () => Response.json(legacyBody),
    logger: { info() {}, error() {} },
    now: () => nowMs,
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/auth/session', { headers: { Cookie: cookie } }), {
    SHADOW_AUTH_SESSION_ENABLED: 'true', ADMIN_TOKEN: 'admin-secret',
  }, {});
  assert.deepEqual(await response.json(), legacyBody);
});

test('auth session candidate is skipped when legacy returns 401', async () => {
  const router = createRouter();
  let signed = false;
  registerAuthSessionShadowRoute(router, {
    legacyFetch: async () => Response.json({ status: 'error' }, { status: 401 }),
    logger: { info() {}, error() {} },
    now: () => { signed = true; return Date.now(); },
  });
  const app = createApp({ router, legacyFetch: async () => { throw new Error('unexpected fallback'); } });
  const response = await app.fetch(new Request('https://example.test/api/auth/session'), {
    SHADOW_AUTH_SESSION_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 401);
  assert.equal(signed, false);
});

test('auth session route metadata is high-risk read-only', () => {
  const router = createRouter();
  registerAuthSessionShadowRoute(router, { legacyFetch: async () => Response.json({}) });
  assert.deepEqual(router.list(), [{
    method: 'GET', id: 'AUTH-SESSION-SHADOW-001', path: '/api/auth/session',
    risk: 'high', write: false, mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_AUTH_SESSION_ENABLED',
  }]);
});
