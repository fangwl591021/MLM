const POINT_OA1 = "oa1";
const POINT_OA2 = "oa2";
const POINT_CHANNELS = new Set([POINT_OA1, POINT_OA2]);

function stringValue(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function normalizePointStatsNumber(value) {
  return Number(value || 0);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(number, max));
}

function getTaipeiDate(value) {
  const date = new Date(value === undefined ? Date.now() : value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function pointStatsDateFromDays(days, now = Date.now()) {
  const start = new Date(Number(now) - (days - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace("T", " ");
}

function resolvePointStatsDateRange({ days = 30, startDate, endDate, now = Date.now() } = {}) {
  const normalizedDays = clampNumber(days, 1, 366);
  return {
    days: normalizedDays,
    startDate: stringValue(startDate),
    endDate: stringValue(endDate),
    sinceSql: pointStatsDateFromDays(normalizedDays, now),
    taipeiDate: getTaipeiDate(now),
  };
}

function buildPointStatsWhere(scope, sinceSql, channelKey, pointType, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const where = [`${prefix}created_at >= ?`];
  const bindings = [sinceSql];
  if (scope !== "all") {
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
  return { where: where.join(" AND "), bindings };
}

function resolvePointStatsMemberName(row) {
  const name = stringValue(row && row.user_name).trim();
  if (name) return name;
  const uid = stringValue(row && row.line_user_id);
  return uid ? `${uid.slice(0, 10)}...${uid.slice(-6)}` : "未命名會員";
}

function formatTaipeiDateTime(value) {
  const raw = stringValue(value);
  const parsed = Date.parse(raw.includes("T") || /Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(parsed)) return raw || "-";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(parsed)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function createEmptyPointStatsData({ days = 30, scope = "ops", since = "", channel_key = "", point_type = "gift_money" } = {}) {
  return {
    days,
    scope,
    since,
    channel_key,
    point_type,
    totals: { days: 0, transactions: 0, users: 0, grant_points: 0, deduct_points: 0, net_points: 0, grant_count: 0, deduct_count: 0 },
    daily: [],
    breakdown: [],
    recent: [],
  };
}

function mapPointStatsTotals(rows = []) {
  return rows.reduce((totals, row) => {
    totals.days += 1;
    totals.transactions += normalizePointStatsNumber(row.transactions);
    totals.users += normalizePointStatsNumber(row.unique_users);
    totals.grant_points += normalizePointStatsNumber(row.grant_points);
    totals.deduct_points += normalizePointStatsNumber(row.deduct_points);
    totals.net_points += normalizePointStatsNumber(row.net_points);
    totals.grant_count += normalizePointStatsNumber(row.grant_count);
    totals.deduct_count += normalizePointStatsNumber(row.deduct_count);
    return totals;
  }, { days: 0, transactions: 0, users: 0, grant_points: 0, deduct_points: 0, net_points: 0, grant_count: 0, deduct_count: 0 });
}

function mapPointStatsMember(row) {
  return {
    line_user_id: stringValue(row.line_user_id),
    name: resolvePointStatsMemberName(row),
    transactions: normalizePointStatsNumber(row.transactions),
    grant_points: normalizePointStatsNumber(row.grant_points),
    deduct_points: normalizePointStatsNumber(row.deduct_points),
    net_points: normalizePointStatsNumber(row.net_points),
  };
}

function mapPointStatsDaily(rows = [], memberRows = []) {
  const dailyMembers = new Map();
  for (const row of memberRows) {
    const day = stringValue(row.day);
    if (!day) continue;
    const list = dailyMembers.get(day) || [];
    if (list.length < 12) list.push(mapPointStatsMember(row));
    dailyMembers.set(day, list);
  }
  return rows.map((row) => ({
    day: stringValue(row.day),
    transactions: normalizePointStatsNumber(row.transactions),
    unique_users: normalizePointStatsNumber(row.unique_users),
    grant_points: normalizePointStatsNumber(row.grant_points),
    deduct_points: normalizePointStatsNumber(row.deduct_points),
    net_points: normalizePointStatsNumber(row.net_points),
    grant_count: normalizePointStatsNumber(row.grant_count),
    deduct_count: normalizePointStatsNumber(row.deduct_count),
    members: dailyMembers.get(stringValue(row.day)) || [],
  }));
}

function mapPointStatsBreakdown(rows = []) {
  return rows.map((row) => ({
    action: stringValue(row.action),
    source: stringValue(row.source),
    transactions: normalizePointStatsNumber(row.transactions),
    unique_users: normalizePointStatsNumber(row.unique_users),
    grant_points: normalizePointStatsNumber(row.grant_points),
    deduct_points: normalizePointStatsNumber(row.deduct_points),
    net_points: normalizePointStatsNumber(row.net_points),
  }));
}

function mapPointStatsRecent(rows = []) {
  return rows.map((row) => ({
    id: normalizePointStatsNumber(row.id),
    channel_key: stringValue(row.channel_key),
    source_label: ({ oa1: "康立智能", oa2: "康立全球" })[stringValue(row.channel_key)] || stringValue(row.channel_key),
    line_user_id: stringValue(row.line_user_id),
    user_name: resolvePointStatsMemberName(row),
    action: stringValue(row.action),
    point_type: stringValue(row.point_type),
    point_delta: normalizePointStatsNumber(row.point_delta),
    balance_after: normalizePointStatsNumber(row.balance_after),
    source: stringValue(row.source),
    business_key: stringValue(row.business_key),
    operator_name: stringValue(row.operator_name),
    note: stringValue(row.note),
    created_at: stringValue(row.created_at),
    created_at_text: formatTaipeiDateTime(row.created_at),
  }));
}

function buildPointStatsPayload({ days, scope, since, channelKey, pointType, dailyRows = [], breakdownRows = [], recentRows = [], memberRows = [] } = {}) {
  const daily = mapPointStatsDaily(dailyRows, memberRows);
  return {
    days,
    scope,
    since,
    channel_key: POINT_CHANNELS.has(channelKey) ? channelKey : "",
    point_type: pointType,
    totals: mapPointStatsTotals(daily),
    daily,
    breakdown: mapPointStatsBreakdown(breakdownRows),
    recent: mapPointStatsRecent(recentRows),
  };
}

module.exports = {
  POINT_CHANNELS,
  buildPointStatsPayload,
  buildPointStatsWhere,
  createEmptyPointStatsData,
  getTaipeiDate,
  mapPointStatsBreakdown,
  mapPointStatsDaily,
  mapPointStatsMember,
  mapPointStatsRecent,
  mapPointStatsTotals,
  normalizePointStatsNumber,
  pointStatsDateFromDays,
  resolvePointStatsDateRange,
  resolvePointStatsMemberName,
  stringValue,
};
