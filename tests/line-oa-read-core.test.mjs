import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkItems,
  isMonitorHiddenMessage,
  lineOaThreadFromD1,
  normalizeStoredLinePayload,
  normalizeStatusForDisplay,
  resolveLineOaFloor,
  threadIdFor,
} from '../src/modules/line-oa/line-oa-read-core.js';

test('shared floor and thread id rules preserve legacy behavior', () => {
  assert.equal(resolveLineOaFloor(new Request('https://example.test/api?floor=admin')), 'admin');
  assert.equal(resolveLineOaFloor(new Request('https://example.test/api', { headers: { 'X-Floor-Id': 'smart' } })), 'smart');
  assert.equal(resolveLineOaFloor(new Request('https://example.test/api?floor=unknown')), 'main');
  assert.equal(threadIdFor('main', 'U1'), 'user:U1');
  assert.equal(threadIdFor('admin', 'U1'), 'admin:user:U1');
});

test('shared mapper preserves names, status, tags and LINE payload', () => {
  const thread = lineOaThreadFromD1({
    id: 'user:U123456789', floor_id: 'main', user_id: 'U123456789',
    display_name: 'U123456789', profile_display_name: '王小明', picture_url: '',
    profile_picture_url: 'https://img.test/a.jpg', summary: '摘要', status: 'important',
    risk: 'high', profile_status: 200, profile_error: '', last_profile_sync: 12,
    tags: '["會員","待追蹤"]', note: '備註', last_message_at: 99,
  }, [{
    id: 'm1', floor_id: 'main', user_id: 'U123456789', sender_role: 'user',
    message_type: 'flex', text: '內容', category: '詢問', suggestions: '["建議"]',
    important: 1, sentiment: 'neutral', raw_json: '{"direction":"incoming","message":{"type":"text","text":"內容"}}', created_at: 88,
  }]);
  assert.equal(thread.name, '王小明');
  assert.equal(thread.status, '待處理');
  assert.deepEqual(thread.tags, ['會員', '待追蹤']);
  assert.equal(thread.messages[0].senderName, '名稱待同步');
  assert.deepEqual(thread.messages[0].linePayload, {
    direction: 'incoming', messages: [{ type: 'text', text: '內容' }],
  });
});

test('shared helpers preserve status, hidden monitor and chunk rules', () => {
  assert.equal(normalizeStatusForDisplay('pending'), '待回覆');
  assert.equal(normalizeStatusForDisplay('done'), '處理完畢');
  assert.equal(isMonitorHiddenMessage({ floor_id: 'main', text: ' 簽到 贈K點 ' }), true);
  assert.equal(isMonitorHiddenMessage({ floor_id: 'admin', text: '簽到贈K點' }), false);
  assert.deepEqual(normalizeStoredLinePayload({}, 'image'), {
    direction: 'unknown', messages: [{ type: 'image' }],
  });
  assert.deepEqual(chunkItems(Array.from({ length: 101 }, (_, index) => index)).map((batch) => batch.length), [50, 50, 1]);
});
