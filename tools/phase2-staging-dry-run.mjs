import assert from "node:assert/strict";
import { runPointStatsCandidate } from "../src/modules/points/point-stats-candidate.js";
import { compareShadowResults } from "../src/modules/system/shadow-compare.js";

function mockDb() {
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
      return { bind(...bindings) { calls.push({ kind, bindings }); return { all: async () => ({ results: rows[kind] }) }; } };
    },
  };
}

const disabled = await runPointStatsCandidate({ db: mockDb() });
assert.equal(disabled.enabled, false);
const db = mockDb();
const candidate = await runPointStatsCandidate({ db, featureFlag: true, requestInput: { days: 1, channel_key: "oa1" }, now: Date.parse("2026-07-12T00:00:00Z") });
const legacy = { status: 200, data: candidate.data };
assert.equal(compareShadowResults(legacy, { status: 200, data: candidate.data }).equal, true);
assert.equal(compareShadowResults(legacy, { status: 200, data: { ...candidate.data, totals: { ...candidate.data.totals, users: 2 } } }).equal, false);
assert.deepEqual(db.calls.map((call) => call.kind), ["daily", "breakdown", "recent", "members"]);
let isolated = false;
try { await runPointStatsCandidate({ db: { prepare() { throw new Error("fixture SQL failure"); } }, featureFlag: true }); } catch (_error) { isolated = true; }
assert.equal(isolated, true);
console.log("Phase 2 Staging Dry Run: PASS");
console.log("- Local Shadow Harness");
console.log("- Not Production Wiring");
console.log("- feature flag false path, candidate order, compare mismatch and exception isolation verified");
