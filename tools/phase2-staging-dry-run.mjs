import assert from "node:assert/strict";
import { runPointStatsCandidate } from "../src/modules/points/point-stats-candidate.js";
import { compareShadowResults } from "../src/modules/system/shadow-compare.js";
import rewardModule from "../src/modules/reward/reward-read-candidate.js";
const { runRewardReadCandidate } = rewardModule;
import aiWearModule from "../src/modules/ai-wear/ai-wear-read-candidate.js";
const { runAiWearPublicCandidate, runAiWearResultsCandidate, runAiWearShareCardCandidate, runAiWearCostSummaryCandidate } = aiWearModule;

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
const rewardDisabled = await runRewardReadCandidate({ db: { prepare() { throw new Error("must not query"); } } });
assert.equal(rewardDisabled.enabled, false);
const rewardCalls = [];
const rewardDb = {
  prepare(sql) {
    return {
      bind(...bindings) {
        rewardCalls.push({ sql, bindings });
        return { all: async () => ({ results: [
          { id: "event-2", title: "event 5 points", description: "K-point:5", starts_at: 3000, ends_at: 4000, checkin_starts_at: 0, checkin_ends_at: 0, location: "Taipei" },
          { id: "event-1", title: "event 1", description: "", starts_at: 1000, ends_at: 2000, checkin_starts_at: 900, checkin_ends_at: 1800, location: "Taipei" },
        ] }) };
      },
    };
  },
};
const rewardCandidate = await runRewardReadCandidate({ db: rewardDb, featureFlag: true, requestInput: { campaign: "calendar_auto" }, now: 1000000000000 });
assert.equal(rewardCalls.length, 1);
assert.equal(rewardCandidate.config.calendarMode, true);
assert.deepEqual(rewardCandidate.calendar.events.map((event) => event.uid), ["event-1", "event-2"]);
assert.equal(rewardCandidate.calendar.events[1].points, 5);
const aiDisabled = await runAiWearPublicCandidate({ db: { prepare() { throw new Error("must not query"); } } });
assert.equal(aiDisabled.enabled, false);
const aiCalls = [];
const aiDb = {
  prepare(sql) {
    return {
      bind(...bindings) {
        aiCalls.push({ sql, bindings });
        return {
          first: async () => ({ value: JSON.stringify({ title: "Demo", image2ApiKey: "secret", costPerGeneration: 0.7078 }) }),
          all: async () => ({ results: sql.includes("ai_wear_references") ? [{ id: "m1", title: "Model", series: "3", file_name: "m.jpg", mime_type: "image/jpeg", size: 10, active: 1, created_at: 1, updated_at: 2 }] : [{ id: "r1", line_user_id: "U1", display_name: "Tony", model_id: "m1", model_title: "Model", person_image_url: "p", result_image_url: "r", result_mime_type: "image/jpeg", has_result_blob: 0, point_cost: 10, point_channel_key: "oa1", point_type: "gift_money", status: "completed", created_at: 2 }] }),
        };
      },
      all: async () => ({ results: [{ id: "m1", title: "Model", series: "3", file_name: "m.jpg", mime_type: "image/jpeg", size: 10, active: 1, created_at: 1, updated_at: 2 }] }),
    };
  },
};
const aiPublic = await runAiWearPublicCandidate({ db: aiDb, featureFlag: true, baseUrl: "https://example.test" });
assert.equal(aiPublic.data.settings.image2ApiKey, "");
assert.equal(aiPublic.data.settings.hasImage2ApiKey, true);
assert.equal(aiPublic.data.gallery.length, 1);
const aiResults = await runAiWearResultsCandidate({ db: aiDb, featureFlag: true, baseUrl: "https://example.test", limit: 1 });
assert.equal(aiResults.data.items[0].id, "r1");
const aiShare = await runAiWearShareCardCandidate({ db: { prepare() { return { bind() { return { first: async () => ({ id: "s1", sharer_name: "Tony", caption: "Try", image_url: "https://example.test/x", purchase_line_url: "https://lin.ee/demo", share_format: "format2" }) }; } }; } }, featureFlag: true, id: "s1", baseUrl: "https://example.test" });
assert.equal(aiShare.data.shareFormat, "format2");
assert.equal(aiShare.data.imageUrl, "https://example.test/x.jpg");
const aiCost = await runAiWearCostSummaryCandidate({ db: aiDb, featureFlag: true, now: Date.parse("2026-07-12T00:00:00+08:00") });
assert.equal(aiCost.data.settings.costPerGeneration, 0.7078);
assert.ok(aiCalls.length >= 2);
console.log("- AI Wear feature flag false path, public secret sanitization, result/share/cost mapping verified");