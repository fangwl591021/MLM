const test = require("node:test");
const assert = require("node:assert/strict");
const { REWARD_READ_SHADOW_ENABLED, runRewardReadCandidate } = require("../../../src/modules/reward/reward-read-candidate.js");

function createDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { bind(...bindings) { calls.push({ sql, bindings }); return { all: async () => ({ results: [
        { id: "event-2", title: "第二場 5 K點", description: "", starts_at: 3000, ends_at: 4000, checkin_starts_at: 0, checkin_ends_at: 0, location: "台北" },
        { id: "event-1", title: "第一場", description: "", starts_at: 1000, ends_at: 2000, checkin_starts_at: 900, checkin_ends_at: 1800, location: "台中" },
      ] }) }; } };
    },
  };
}

test("reward read feature flag is false by default", async () => {
  assert.equal(REWARD_READ_SHADOW_ENABLED, false);
  assert.deepEqual(await runRewardReadCandidate({ db: { prepare() { throw new Error("must not query"); } } }), { enabled: false, config: null, calendar: { events: [] } });
});

test("candidate reads calendar once and maps config/events", async () => {
  const db = createDb();
  const result = await runRewardReadCandidate({ db, featureFlag: true, requestInput: { campaign: "calendar_auto" }, now: 1000000000000 });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].bindings.length, 1);
  assert.equal(result.config.calendarMode, true);
  assert.deepEqual(result.calendar.events.map((event) => event.uid), ["event-1", "event-2"]);
  assert.equal(result.calendar.events[1].points, 5);
});

test("candidate SQL failure propagates without write adapter", async () => {
  let writes = 0;
  await assert.rejects(() => runRewardReadCandidate({ featureFlag: true, db: { prepare() { throw new Error("SQL failure"); }, exec() { writes += 1; } } }), /SQL failure/);
  assert.equal(writes, 0);
});
