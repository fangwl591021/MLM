export function stringValue(value) {
  return value == null ? '' : String(value);
}

export function clampInteger(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(stringValue(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export function crmLineUserId(member) {
  const raw = parseJsonObject(member && member.source_json);
  return stringValue(raw.LINE_user_id || raw.user_login || raw.line_user_id || raw.lineUserId);
}

export function mapCrmMemberSearchCandidate(member) {
  const raw = parseJsonObject(member && member.source_json);
  return {
    member_ref: stringValue(member && member.member_ref),
    name: stringValue((member && member.name) || raw.display_name || raw.LINE_display_name),
    phone: stringValue((member && member.phone) || raw.phone),
    line_user_id: crmLineUserId(member),
    line_display_name: stringValue(raw.LINE_display_name || raw.display_name),
    shop_id: stringValue(raw.shop_id || (member && member.level)),
    source: stringValue(member && member.source),
    updated_at: stringValue(member && member.updated_at),
  };
}

export function buildCorsHeaders(request, env) {
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
