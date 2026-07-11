const FLOOR_MAIN = 'main';
const FLOOR_IDS = new Set(['main', 'admin', 'smart']);
const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';
const STATUS_PENDING = '待回覆';
const STATUS_IMPORTANT = '待處理';
const STATUS_DONE = '處理完畢';
const PENDING_DISPLAY_NAME = '名稱待同步';

export function stringValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

export function resolveLineOaFloor(request) {
  const url = new URL(request.url);
  const raw = stringValue(url.searchParams.get('floor') || request.headers.get('x-floor-id') || FLOOR_MAIN).toLowerCase();
  return FLOOR_IDS.has(raw) ? raw : FLOOR_MAIN;
}

export function threadIdFor(floor, userId) {
  return floor === FLOOR_MAIN ? `user:${userId}` : `${floor}:user:${userId}`;
}

export function normalizeStatusForDisplay(status) {
  const value = stringValue(status);
  if (!value || value === 'pending') return STATUS_PENDING;
  if (value === 'important') return STATUS_IMPORTANT;
  if (value === 'done') return STATUS_DONE;
  return value;
}

export function isPlaceholderName(value, userId) {
  const text = stringValue(value);
  return !text
    || text === stringValue(userId)
    || /^U[a-z0-9]{8,}$/i.test(text)
    || /^user\s*[a-z0-9]{4,}$/i.test(text)
    || /^用戶\s*[a-z0-9]{4,}$/i.test(text);
}

export function chooseStableName(userId, incomingName, currentName) {
  const incoming = stringValue(incomingName);
  const current = stringValue(currentName);
  if (incoming && !isPlaceholderName(incoming, userId)) return incoming;
  if (current && !isPlaceholderName(current, userId)) return current;
  return '';
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(stringValue).filter(Boolean) : [];
  } catch {
    return stringValue(value).split(/[,，]/).map(stringValue).filter(Boolean);
  }
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeStoredLinePayload(rawJson, fallbackType = 'text') {
  const raw = rawJson && typeof rawJson === 'object' ? rawJson : {};
  if (Array.isArray(raw.lineMessages)) return { direction: raw.direction || 'outgoing', messages: raw.lineMessages };
  if (Array.isArray(raw.messages)) return { direction: raw.direction || 'outgoing', messages: raw.messages };
  if (raw.lineMessage && typeof raw.lineMessage === 'object') return { direction: raw.direction || 'outgoing', messages: [raw.lineMessage] };
  if (raw.message && typeof raw.message === 'object') return { direction: raw.direction || 'incoming', messages: [raw.message] };
  if (raw.type && raw.type !== 'message') return { direction: raw.direction || 'outgoing', messages: [raw] };
  if (fallbackType && fallbackType !== 'text') return { direction: raw.direction || 'unknown', messages: [{ type: fallbackType }] };
  return null;
}

export function isMonitorHiddenMessage(message) {
  const normalized = stringValue(message && message.text).replace(/\s+/g, '').toLowerCase();
  return stringValue(message && message.floor_id) === FLOOR_MAIN && normalized === '簽到贈k點'.toLowerCase();
}

export function lineOaMessageFromD1(thread, message) {
  const suggestions = parseJsonArray(message.suggestions);
  const rawJson = parseJsonObject(message.raw_json);
  const linePayload = normalizeStoredLinePayload(rawJson, message.message_type);
  return {
    id: message.id,
    type: message.message_type || 'text',
    senderRole: message.sender_role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
    senderId: message.user_id,
    senderName: message.sender_role === ADMIN_ROLE ? '管理員' : (chooseStableName(thread.user_id, thread.display_name, '') || PENDING_DISPLAY_NAME),
    text: message.text,
    createdAt: message.created_at,
    category: message.category,
    suggestions,
    important: Boolean(message.important),
    rawJson,
    linePayload,
    raw: {
      時間: message.created_at,
      身份: message.sender_role === ADMIN_ROLE ? 'admin' : 'user',
      用戶ID: message.user_id,
      floor: thread.floor_id || FLOOR_MAIN,
      內容: message.text,
      類別: message.category,
      AI建議: JSON.stringify(suggestions),
      重要: message.important ? '是' : '否',
      情緒: message.sentiment || 'neutral',
      狀態: normalizeStatusForDisplay(thread.status),
      用戶名稱: thread.display_name || '',
      頭像URL: thread.picture_url || '',
      LINEPayload: linePayload,
    },
  };
}

export function lineOaThreadFromD1(row, messages) {
  const name = chooseStableName(row.user_id, row.display_name, row.profile_display_name)
    || chooseStableName(row.user_id, row.linked_display_name, '')
    || PENDING_DISPLAY_NAME;
  return {
    id: row.id,
    floor: row.floor_id || FLOOR_MAIN,
    userId: row.user_id,
    name,
    displayName: name,
    pictureUrl: stringValue(row.picture_url || row.profile_picture_url || row.linked_picture_url),
    summary: stringValue(row.summary),
    status: normalizeStatusForDisplay(row.status),
    risk: row.risk || 'low',
    profileStatus: row.profile_status || null,
    profileError: stringValue(row.profile_error),
    lastProfileSync: Number(row.last_profile_sync || 0),
    tags: parseJsonArray(row.tags),
    note: stringValue(row.note),
    lastMessageAt: Number(row.last_message_at || 0),
    hasRealName: !isPlaceholderName(name, row.user_id),
    messages: messages.map((message) => lineOaMessageFromD1(row, message)),
  };
}

export function chunkItems(items, size = 50) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}
