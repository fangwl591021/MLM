import { runShadowReadAfterLegacy } from '../../shadow/shadow-compare.js';

const POINT_CHANNELS = new Set(['oa1', 'oa2']);
const POINT_SOURCE_LABELS = { oa1: '康立智能', oa2: '康立全球' };

function stringValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function pointStatsDateFromDays(days, now = Date.now()) {
  const start = new Date(now - (days - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace('T', ' ');
}

function pointStatsWhere(scope, sinceSql, channelKey, pointType, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const where = [`${prefix}created_at >= ?`];
  const bindings = [sinceSql];
  if (scope !== 'all') {
    where.push(`${prefix}source NOT IN ('sync', 'import')`);
    where.push(`${prefix}action NOT IN ('sync', 'import')`);
    where.push(`${prefix}business_key NOT LIKE 'sync:%'`);
  }
  if (channelKey && POINT_CHANNELS.has(channelKey)) {
    where.push(`${prefix}channel_key = ?`);
    bindings.push(channelKey);
  }
  if (pointType) {
    where.push(`${prefix}point_type = ?`);
    bindings.push(pointType);
  }
  return { where: where.join(' AND '), bindings };
}

function pointStatsUserNameSql(alias = 'pl') {
  return `COALESCE(
    NULLIF((SELECT cm.name FROM crm_members cm WHERE cm.member_ref = ${alias}.master_member_ref OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id ORDER BY cm.updated_at DESC LIMIT 1), ''),
    NULLIF((SELECT json_extract(cm.source_json, '$.LINE_display_name') FROM crm_members cm WHERE cm.member_ref = ${alias}.master_member_ref OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id ORDER BY cm.updated_at DESC LIMIT 1), ''),
    NULLIF((SELECT json_extract(cm.source_json, '$.display_name') FROM crm_members cm WHERE cm.member_ref = ${alias}.master_member_ref OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id ORDER BY cm.updated_at DESC LIMIT 1), ''),
    NULLIF((SELECT p.display_name FROM profiles p WHERE p.user_id = ${alias}.line_user_id AND p.display_name IS NOT NULL AND p.display_name <> '' AND p.display_name <> p.user_id ORDER BY p.updated_at DESC LIMIT 1), '')
  )`;
}

function pointStatsMemberName(row) {
  const name = stringValue(row && row.user_name);
  if (name) return name;
  const uid = stringValue(row && row.line_user_id);
  return uid ? `${uid.slice(0, 10)}...${uid.slice(-6)}` : '未命名會員';
}

function pointStatsTotals(rows) {
  return rows.reduce((totals, row) => {
    totals.days += 1;
    totals.transactions += Number(row.transactions || 0);
    totals.users += Number(row.unique_users || 0);
    totals.grant_points += Number(row.grant_points || 0);
    totals.deduct_points += Number(row.deduct_points || 0);
    totals.net_points += Number(row.net_points || 0);
    totals.grant_count += Number(row.grant_count || 0);
    totals.deduct_count += Number(row.deduct_count || 0);
    return totals;
  }, { days: 0, transactions: 0, users: 0, grant_points: 0, deduct_points: 0, net_points: 0, grant_count: 0, deduct_count: 0 });
}

function kPointDisplayText(value) {
  return stringValue(value)
    .replace(/購物金/g, 'K點')
    .replace(/增加([0-9]+(?:\.[0-9]+)?)元/g, '增加$1點')
    .replace(/扣除([0-9]+(?:\.[0-9]+)?)元/g, '扣除$1點')
    .replace(/([+-]?[0-9]+(?:\.[0-9]+)?)元/g, '$1點');
}

function formatTaipeiDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return stringValue(value);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

export async function listPointStatsDataCandidate(env, url, { now = Date.now } = {}) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB is not configured');
  const days = clampNumber(url.searchParams.get('days') || 30, 1, 366);
  const scope = stringValue(url.searchParams.get('scope') || 'ops') === 'all' ? 'all' : 'ops';
  const channelKey = stringValue(url.searchParams.get('channel_key') || url.searchParams.get('channelKey'));
  const pointType = stringValue(url.searchParams.get('point_type') || url.searchParams.get('pointType') || 'gift_money');
  const sinceSql = pointStatsDateFromDays(days, now());
  const filter = pointStatsWhere(scope, sinceSql, channelKey, pointType, 'pl');
  const userNameSql = pointStatsUserNameSql('pl');

  const [dailyRows, breakdownRows, recentRows, memberRows] = await Promise.all([
    env.DB.prepare(`SELECT date(datetime(pl.created_at, '+8 hours')) AS day, COUNT(*) AS transactions, COUNT(DISTINCT pl.line_user_id) AS unique_users, SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points, SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points, SUM(pl.point_delta) AS net_points, SUM(CASE WHEN pl.point_delta > 0 THEN 1 ELSE 0 END) AS grant_count, SUM(CASE WHEN pl.point_delta < 0 THEN 1 ELSE 0 END) AS deduct_count FROM point_ledger pl WHERE ${filter.where} GROUP BY day ORDER BY day DESC`).bind(...filter.bindings).all(),
    env.DB.prepare(`SELECT pl.action AS action, pl.source AS source, COUNT(*) AS transactions, COUNT(DISTINCT pl.line_user_id) AS unique_users, SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points, SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points, SUM(pl.point_delta) AS net_points FROM point_ledger pl WHERE ${filter.where} GROUP BY pl.action, pl.source ORDER BY transactions DESC, action ASC, source ASC LIMIT 30`).bind(...filter.bindings).all(),
    env.DB.prepare(`SELECT pl.id, pl.channel_key, pl.line_user_id, ${userNameSql} AS user_name, pl.action, pl.point_type, pl.point_delta, pl.balance_after, pl.source, pl.business_key, pl.operator_name, pl.note, pl.created_at FROM point_ledger pl WHERE ${filter.where} ORDER BY pl.id DESC LIMIT 80`).bind(...filter.bindings).all(),
    env.DB.prepare(`SELECT date(datetime(pl.created_at, '+8 hours')) AS day, pl.line_user_id, ${userNameSql} AS user_name, COUNT(*) AS transactions, SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points, SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points, SUM(pl.point_delta) AS net_points FROM point_ledger pl WHERE ${filter.where} GROUP BY day, pl.line_user_id ORDER BY day DESC, transactions DESC, ABS(net_points) DESC LIMIT 1200`).bind(...filter.bindings).all(),
  ]);

  const dailyMembers = new Map();
  for (const row of memberRows.results || []) {
    const day = stringValue(row.day);
    if (!day) continue;
    const list = dailyMembers.get(day) || [];
    if (list.length < 12) list.push({
      line_user_id: stringValue(row.line_user_id), name: pointStatsMemberName(row),
      transactions: Number(row.transactions || 0), grant_points: Number(row.grant_points || 0),
      deduct_points: Number(row.deduct_points || 0), net_points: Number(row.net_points || 0),
    });
    dailyMembers.set(day, list);
  }

  const daily = (dailyRows.results || []).map((row) => ({
    day: stringValue(row.day), transactions: Number(row.transactions || 0), unique_users: Number(row.unique_users || 0),
    grant_points: Number(row.grant_points || 0), deduct_points: Number(row.deduct_points || 0), net_points: Number(row.net_points || 0),
    grant_count: Number(row.grant_count || 0), deduct_count: Number(row.deduct_count || 0), members: dailyMembers.get(stringValue(row.day)) || [],
  }));
  const breakdown = (breakdownRows.results || []).map((row) => ({
    action: stringValue(row.action), source: stringValue(row.source), transactions: Number(row.transactions || 0),
    unique_users: Number(row.unique_users || 0), grant_points: Number(row.grant_points || 0),
    deduct_points: Number(row.deduct_points || 0), net_points: Number(row.net_points || 0),
  }));
  const recent = (recentRows.results || []).map((row) => ({
    id: Number(row.id || 0), channel_key: stringValue(row.channel_key), source_label: POINT_SOURCE_LABELS[row.channel_key] || stringValue(row.channel_key),
    line_user_id: stringValue(row.line_user_id), user_name: pointStatsMemberName(row), action: stringValue(row.action), point_type: stringValue(row.point_type),
    point_delta: Number(row.point_delta || 0), balance_after: Number(row.balance_after || 0), source: stringValue(row.source),
    business_key: stringValue(row.business_key), operator_name: stringValue(row.operator_name), note: kPointDisplayText(row.note),
    created_at: stringValue(row.created_at), created_at_text: formatTaipeiDateTime(row.created_at),
  }));

  return { days, scope, since: sinceSql, channel_key: POINT_CHANNELS.has(channelKey) ? channelKey : '', point_type: pointType, totals: pointStatsTotals(daily), daily, breakdown, recent };
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

export async function pointStatsDataCandidateResponse(request, env, options = {}) {
  const data = await listPointStatsDataCandidate(env, new URL(request.url), options);
  return new Response(JSON.stringify({ success: true, status: 'success', data }), { status: 200, headers: buildCorsHeaders(request, env) });
}

export function registerPointStatsDataShadowRoute(router, { legacyFetch, logger = console, now = Date.now } = {}) {
  router.get((url, _request, env) => url.pathname === '/admin/points/stats-data' && env.SHADOW_POINT_STATS_DATA_ENABLED === 'true', async (request, env, ctx) => {
    const result = await runShadowReadAfterLegacy({
      legacy: () => legacyFetch(request, env, ctx),
      candidate: () => pointStatsDataCandidateResponse(request, env, { now }),
      logger,
      allowedStatuses: [200],
    });
    return result.response;
  }, {
    id: 'POINT-STATS-DATA-SHADOW-001', path: '/admin/points/stats-data', risk: 'high', write: false,
    mode: 'shadow-read-after-legacy', featureFlag: 'SHADOW_POINT_STATS_DATA_ENABLED',
  });
}

export { pointStatsDateFromDays, pointStatsWhere, pointStatsUserNameSql };
