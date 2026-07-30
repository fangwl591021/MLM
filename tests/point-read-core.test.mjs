import test from 'node:test';
import assert from 'node:assert/strict';
import { pointCorsHeaders, pointLimit, pointString } from '../src/modules/points/point-read-core.js';

test('point read core normalizes strings and limits', () => {
  assert.equal(pointString(null), '');
  assert.equal(pointString(123), '123');
  assert.equal(pointLimit('12.9'), 12);
  assert.equal(pointLimit('bad'), 50);
  assert.equal(pointLimit(0), 1);
  assert.equal(pointLimit(999), 200);
  assert.equal(pointLimit('bad', { fallback: 20, min: 1, max: 100 }), 20);
});

test('point read core preserves standard and admin-token CORS contracts', () => {
  const request = new Request('https://example.test', { headers: { Origin: 'https://console.example' } });
  const env = { ALLOWED_ORIGIN: 'https://console.example' };
  const standard = pointCorsHeaders(request, env);
  assert.equal(standard['Access-Control-Allow-Origin'], 'https://console.example');
  assert.match(standard['Access-Control-Allow-Headers'], /X-Line-Id-Token/);
  assert.doesNotMatch(standard['Access-Control-Allow-Headers'], /X-Admin-Token/);

  const admin = pointCorsHeaders(request, env, { adminTokenHeaders: true });
  assert.match(admin['Access-Control-Allow-Headers'], /X-Admin-Token/);
  assert.match(admin['Access-Control-Allow-Headers'], /X-Dashboard-Token/);
});
