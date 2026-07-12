const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../../src/modules/reward/reward-read-core.js");

test("reward config defaults and campaign normalization preserve legacy values", () => {
  assert.equal(core.normalizeCampaign("smart 2026/05"), "smart_2026_05");
  assert.equal(core.normalizeCampaign(""), "smart_202605");
  assert.equal(core.rewardPointsForCampaign("smart_202605"), 1);
  assert.equal(core.rewardPointsForCampaign("smart_202605_5"), 10);
  assert.equal(core.calendarDefaultPoints({}), 10);
  assert.equal(core.rewardCheckinEarlyMinutes({}), 90);
  assert.equal(core.buildRewardConfigPayload({}).liffId, "2007221311-WjM9sZPz");
  assert.equal(core.buildRewardConfigPayload({ campaign: "calendar_auto" }).calendarMode, true);
});

test("reward points parser uses event text before default", () => {
  assert.equal(core.rewardPointsFromEvent({}, { summary: "課程贈點 5 K點" }), 5);
  assert.equal(core.rewardPointsFromEvent({}, { description: "points: 2.5" }), 2.5);
  assert.equal(core.rewardPointsFromEvent({}, { summary: "沒有數值" }), 10);
  assert.equal(core.rewardPointsFromEvent({ defaultCalendarPoints: 8 }, { summary: "沒有數值" }), 8);
  assert.equal(core.rewardPointsFromEvent({}, { summary: "贈點 0 K點" }), 10);
});

test("calendar parser drops invalid rows and keeps ascending event order", () => {
  const events = core.parseRewardCalendarRows([
    { id: "late", title: "Late", starts_at: 300, ends_at: 400 },
    { id: "missing", title: "Missing", starts_at: 0, ends_at: 400 },
    { id: "early", title: "Early", starts_at: 100, ends_at: 200 },
  ]);
  assert.deepEqual(events.map((event) => event.uid), ["early", "late"]);
  assert.equal(events[0].description, "");
  assert.equal(core.calendarEventRowToRewardEvent({ starts_at: 100 }).endsAt, 100 + 90 * 60 * 1000);
});

test("checkin window honors valid configured start and fallback boundaries", () => {
  const event = { startsAt: 1000, endsAt: 3000, checkinStartsAt: 900, checkinEndsAt: 2500 };
  assert.deepEqual(core.calendarEventCheckinWindow({}, event), { startsAt: 900, endsAt: 2500 });
  assert.deepEqual(core.calendarEventCheckinWindow({ checkinEarlyMinutes: 5 }, { startsAt: 1000, endsAt: 3000, checkinStartsAt: 1000 }), { startsAt: -299000, endsAt: 3000 });
  assert.equal(core.publicCalendarEvent({}, event, 1000).active, true);
  assert.equal(core.publicCalendarEvent({}, event, 3001).active, false);
});

test("null and invalid values become empty/default output", () => {
  const payload = core.buildRewardCalendarPayload({ rows: [null, { id: null, starts_at: "bad", ends_at: null }], now: 100 });
  assert.deepEqual(payload, { events: [] });
  assert.equal(core.isSameTaipeiDate("invalid", "invalid"), true);
});
