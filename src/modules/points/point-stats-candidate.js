const core = require("./point-stats-core.js");

const POINT_STATS_SQL = {
  daily: (whereClause) => `
    SELECT
      date(datetime(pl.created_at, '+8 hours')) AS day,
      COUNT(*) AS transactions,
      COUNT(DISTINCT pl.line_user_id) AS unique_users,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points,
      SUM(CASE WHEN pl.point_delta > 0 THEN 1 ELSE 0 END) AS grant_count,
      SUM(CASE WHEN pl.point_delta < 0 THEN 1 ELSE 0 END) AS deduct_count
    FROM point_ledger pl
    WHERE ${whereClause}
    GROUP BY day
    ORDER BY day DESC
  `,
  breakdown: (whereClause) => `
    SELECT
      pl.action AS action,
      pl.source AS source,
      COUNT(*) AS transactions,
      COUNT(DISTINCT pl.line_user_id) AS unique_users,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points
    FROM point_ledger pl
    WHERE ${whereClause}
    GROUP BY pl.action, pl.source
    ORDER BY transactions DESC, action ASC, source ASC
    LIMIT 30
  `,
  recent: (whereClause, userNameSql) => `
    SELECT pl.id, pl.channel_key, pl.line_user_id, ${userNameSql} AS user_name, pl.action, pl.point_type, pl.point_delta, pl.balance_after, pl.source, pl.business_key, pl.operator_name, pl.note, pl.created_at
    FROM point_ledger pl
    WHERE ${whereClause}
    ORDER BY pl.id DESC
    LIMIT 80
  `,
  members: (whereClause, userNameSql) => `
    SELECT
      date(datetime(pl.created_at, '+8 hours')) AS day,
      pl.line_user_id,
      ${userNameSql} AS user_name,
      COUNT(*) AS transactions,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points
    FROM point_ledger pl
    WHERE ${whereClause}
    GROUP BY day, pl.line_user_id
    ORDER BY day DESC, transactions DESC, ABS(net_points) DESC
    LIMIT 1200
  `,
};

function pointStatsUserNameSql(alias = "pl") {
  return `COALESCE(
    NULLIF((
      SELECT cm.name
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.LINE_display_name')
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.display_name')
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT p.display_name
      FROM profiles p
      WHERE p.user_id = ${alias}.line_user_id
        AND p.display_name IS NOT NULL
        AND p.display_name <> ''
        AND p.display_name <> p.user_id
      ORDER BY p.updated_at DESC
      LIMIT 1
    ), '')
  )`;
}
function normalizeCandidateInput(input = {}, now = Date.now()) {
  const dateRange = core.resolvePointStatsDateRange({ days: input.days || 30, now });
  const scope = core.stringValue(input.scope || "ops") === "all" ? "all" : "ops";
  const channelKey = core.stringValue(input.channelKey || input.channel_key);
  const pointType = core.stringValue(input.pointType || input.point_type || "gift_money");
  return { ...dateRange, scope, channelKey, pointType };
}

async function executeAll(db, sql, bindings) {
  return db.prepare(sql).bind(...bindings).all();
}

async function runPointStatsCandidate({ db, requestInput = {}, now = Date.now(), featureFlag = false } = {}) {
  if (!featureFlag) return { enabled: false, data: null };
  if (!db || typeof db.prepare !== "function") throw new TypeError("point stats candidate requires a DB adapter");
  const input = normalizeCandidateInput(requestInput, now);
  const filter = core.buildPointStatsWhere(input.scope, input.sinceSql, input.channelKey, input.pointType, "pl");
  const userNameSql = pointStatsUserNameSql("pl");
  const dailyRows = await executeAll(db, POINT_STATS_SQL.daily(filter.where), filter.bindings);
  const breakdownRows = await executeAll(db, POINT_STATS_SQL.breakdown(filter.where), filter.bindings);
  const recentRows = await executeAll(db, POINT_STATS_SQL.recent(filter.where, userNameSql), filter.bindings);
  const memberRows = await executeAll(db, POINT_STATS_SQL.members(filter.where, userNameSql), filter.bindings);
  return {
    enabled: true,
    data: core.buildPointStatsPayload({
      days: input.days,
      scope: input.scope,
      since: input.sinceSql,
      channelKey: input.channelKey,
      pointType: input.pointType,
      dailyRows: dailyRows.results || [],
      breakdownRows: breakdownRows.results || [],
      recentRows: recentRows.results || [],
      memberRows: memberRows.results || [],
    }),
  };
}

module.exports = { POINT_STATS_SQL, runPointStatsCandidate };
