import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorsHeaders,
  clampInteger,
  crmLineUserId,
  mapCrmMemberSearchCandidate,
  parseJsonObject,
  stringValue,
} from '../src/modules/crm/crm-read-core.js';

test('crm read core normalizes strings and integer limits', () => {
  assert.equal(stringValue(null), '');
  assert.equal(stringValue(123), '123');
  assert.equal(clampInteger('20', 1, 100, 10), 20);
  assert.equal(clampInteger('999', 1, 100, 10), 100);
  assert.equal(clampInteger('-2', 1, 100, 10), 1);
  assert.equal(clampInteger('bad', 1, 100, 10), 10);
});

test('crm read core parses source json safely', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('[]'), {});
  assert.deepEqual(parseJsonObject('{bad'), {});
  assert.deepEqual(parseJsonObject(null), {});
});

test('crm line user id keeps legacy field priority', () => {
  assert.equal(crmLineUserId({ source_json: JSON.stringify({ LINE_user_id: 'A', user_login: 'B', line_user_id: 'C', lineUserId: 'D' }) }), 'A');
  assert.equal(crmLineUserId({ source_json: JSON.stringify({ user_login: 'B', line_user_id: 'C', lineUserId: 'D' }) }), 'B');
  assert.equal(crmLineUserId({ source_json: JSON.stringify({ line_user_id: 'C', lineUserId: 'D' }) }), 'C');
  assert.equal(crmLineUserId({ source_json: JSON.stringify({ lineUserId: 'D' }) }), 'D');
  assert.equal(crmLineUserId({ source_json: '{bad' }), '');
});

test('crm search mapper preserves legacy fallbacks', () => {
  assert.deepEqual(mapCrmMemberSearchCandidate({
    member_ref: 'M001',
    name: '',
    phone: '',
    level: 'VIP',
    source: 'wetw',
    updated_at: '2026-07-11 10:00:00',
    source_json: JSON.stringify({
      display_name: '王小明',
      LINE_display_name: 'LINE 王小明',
      phone: '0912345678',
      LINE_user_id: 'U001',
      shop_id: 1086,
    }),
  }), {
    member_ref: 'M001',
    name: '王小明',
    phone: '0912345678',
    line_user_id: 'U001',
    line_display_name: 'LINE 王小明',
    shop_id: '1086',
    source: 'wetw',
    updated_at: '2026-07-11 10:00:00',
  });
});

test('crm read core builds stable cors headers', () => {
  const request = new Request('https://example.test/admin/crm/members', { headers: { Origin: 'https://console.example' } });
  const headers = buildCorsHeaders(request, { ALLOWED_ORIGIN: 'https://console.example' });
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://console.example');
  assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
});
