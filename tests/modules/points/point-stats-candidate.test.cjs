const test = require("node:test");
const assert = require("node:assert/strict");
const { runPointStatsCandidate } = require("../../../src/modules/points/point-stats-candidate.js");

function createDb() {
  const calls = [];
  const rows = {
    daily: [{ day: "2026-07-12", transactions: 1, unique_users: 1, grant_points: 5, deduct_points: 0, net_points: 5, grant_count: 1, deduct_count: 0 }],
    breakdown: [{ action: "grant", source: "calendar", transactions: 1, unique_users: 1, grant_points: 5, deduct_points: 0, net_points: 5 }],
    recent: [{ id: 1, channel_key: "oa1", line_user_id: "U1", user_name: "Tony", action: "grant", point_type: "gift_money", point_delta: 5, balance_after: 5, source: "calendar", business_key: "k", operator_name: "", note: "", created_at: "2026-07-11 16:00:00" }],
    members: [{ day: "2026-07-12", line_user_id: "U1", user_name: "Tony", transactions: 1, grant_points: 5, deduct_points: 0, net_points: 5 }],
  };
  return {
    calls,
    prepare(sql) {
      const kind = sql.includes("COUNT(DISTINCT") && sql.includes("GROUP BY day") ? "daily" : sql.includes("LIMIT 30") ? "breakdown" : sql.includes("LIMIT 80") ? "recent" : "members";
      return { bind(...bindings) { calls.push({ kind, sql, bindings }); return { all: async () => ({ results: rows[kind] }) }; } };
    },
  };
}

test("feature flag is false by default and candidate is not called", async () => {
  const result = await runPointStatsCandidate({ db: { prepare() { throw new Error("must not query"); } } });
  assert.deepEqual(result, { enabled: false, data: null });
});

test("candidate executes four read queries in legacy order", async () => {
  const db = createDb();
  const result = await runPointStatsCandidate({ db, featureFlag: true, requestInput: { days: 1, channel_key: "oa1" }, now: Date.parse("2026-07-12T00:00:00Z") });
  assert.deepEqual(db.calls.map((call) => call.kind), ["daily", "breakdown", "recent", "members"]);
  assert.equal(result.data.daily[0].grant_points, 5);
  assert.equal(result.data.recent[0].user_name, "Tony");
  assert.equal(db.calls.every((call) => call.bindings.length === 3), true);
});

test("candidate errors propagate without write behavior", async () => {
  let writes = 0;
  await assert.rejects(() => runPointStatsCandidate({ featureFlag: true, db: { prepare() { throw new Error("SQL failure"); }, exec() { writes += 1; } } }), /SQL failure/);
  assert.equal(writes, 0);
});
