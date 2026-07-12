const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../../src/modules/points/point-stats-core.js");

test("Taipei date is injected and stable across UTC boundary", () => {
  const now = Date.parse("2026-07-11T16:30:00.000Z");
  assert.equal(core.getTaipeiDate(now), "2026-07-12");
  assert.equal(core.resolvePointStatsDateRange({ days: 2, now }).sinceSql, "2026-07-10 00:00:00");
});

test("date range keeps legacy days clamp and invalid-date behavior", () => {
  const now = Date.parse("2026-07-12T00:00:00.000Z");
  assert.equal(core.resolvePointStatsDateRange({ days: 0, now }).days, 1);
  assert.equal(core.resolvePointStatsDateRange({ days: 999, now }).days, 366);
  assert.equal(core.getTaipeiDate("invalid"), "");
});

test("where clause preserves legacy filters and binding order", () => {
  assert.deepEqual(core.buildPointStatsWhere("ops", "2026-07-10 00:00:00", "oa1", "gift_money", "pl"), {
    where: "pl.created_at >= ? AND pl.source NOT IN ('sync', 'import') AND pl.action NOT IN ('sync', 'import') AND pl.business_key NOT LIKE 'sync:%' AND pl.channel_key = ? AND pl.point_type = ?",
    bindings: ["2026-07-10 00:00:00", "oa1", "gift_money"],
  });
});

test("number and name mapping preserves legacy defaults", () => {
  assert.equal(core.normalizePointStatsNumber(null), 0);
  assert.equal(core.normalizePointStatsNumber("0"), 0);
  assert.equal(core.normalizePointStatsNumber("2.5"), 2.5);
  assert.equal(core.resolvePointStatsMemberName({ user_name: " Tony ", line_user_id: "U1234567890" }), "Tony");
  assert.equal(core.resolvePointStatsMemberName({ user_name: "", line_user_id: "U1234567890abcdef" }), "U123456789...abcdef");
  assert.equal(core.resolvePointStatsMemberName({}), "未命名會員");
});

test("payload maps daily, members, breakdown, recent and totals", () => {
  const payload = core.buildPointStatsPayload({
    days: 1,
    scope: "ops",
    since: "2026-07-11 00:00:00",
    channelKey: "oa1",
    pointType: "gift_money",
    dailyRows: [{ day: "2026-07-12", transactions: "2", unique_users: "1", grant_points: "5", deduct_points: "2", net_points: "3", grant_count: "1", deduct_count: "1" }],
    memberRows: [{ day: "2026-07-12", line_user_id: "U123", user_name: "Tony", transactions: "2", grant_points: "5", deduct_points: "2", net_points: "3" }],
    breakdownRows: [{ action: "grant", source: "calendar", transactions: "1", unique_users: "1", grant_points: "5", deduct_points: "0", net_points: "5" }],
    recentRows: [{ id: "7", channel_key: "oa1", line_user_id: "U123", user_name: "Tony", action: "grant", point_type: "gift_money", point_delta: "5", balance_after: "10", source: "calendar", business_key: "x", operator_name: "admin", note: "ok", created_at: "2026-07-11 16:00:00" }],
  });
  assert.deepEqual(payload.totals, { days: 1, transactions: 2, users: 1, grant_points: 5, deduct_points: 2, net_points: 3, grant_count: 1, deduct_count: 1 });
  assert.equal(payload.daily[0].members[0].name, "Tony");
  assert.equal(payload.breakdown[0].action, "grant");
  assert.equal(payload.recent[0].source_label, "康立智能");
});

test("empty payload has legacy-safe defaults", () => {
  const empty = core.createEmptyPointStatsData({ days: 30, scope: "ops", since: "x", channel_key: "", point_type: "gift_money" });
  assert.deepEqual(empty.daily, []);
  assert.deepEqual(empty.totals, { days: 0, transactions: 0, users: 0, grant_points: 0, deduct_points: 0, net_points: 0, grant_count: 0, deduct_count: 0 });
});
