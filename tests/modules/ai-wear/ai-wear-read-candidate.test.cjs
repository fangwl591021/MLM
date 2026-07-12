const test = require("node:test");
const assert = require("node:assert/strict");
const candidate = require("../../../src/modules/ai-wear/ai-wear-read-candidate.js");

function createDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql, bindings, mode: "bind" });
          return { first: async () => ({ value: JSON.stringify({ title: "Demo", image2ApiKey: "private" }) }), all: async () => ({ results: [] }) };
        },
        first: async () => ({ value: JSON.stringify({ title: "Demo", image2ApiKey: "private" }) }),
        all: async () => ({ results: [] }),
      };
    },
  };
}

test("AI Wear flag is false and disabled path performs no read", async () => {
  assert.equal(candidate.AI_WEAR_READ_SHADOW_ENABLED, false);
  const result = await candidate.runAiWearPublicCandidate({ db: { prepare() { throw new Error("must not query"); } } });
  assert.deepEqual(result, { enabled: false, data: null });
});

test("public candidate reads settings then gallery and never exposes API key", async () => {
  const db = createDb();
  const result = await candidate.runAiWearPublicCandidate({ db, featureFlag: true, baseUrl: "https://example.test" });
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].bindings[0], "ai_wear_settings");
  assert.equal(result.data.settings.image2ApiKey, "");
  assert.equal(Object.hasOwn(result.data.settings, "costPerGeneration"), false);
});

test("results, settings, share and cost candidates are read-only and isolate missing result", async () => {
  const db = createDb();
  const results = await candidate.runAiWearResultsCandidate({ db, featureFlag: true, limit: 0 });
  assert.deepEqual(results.data, { items: [] });
  const settings = await candidate.runAiWearSettingsCandidate({ db, featureFlag: true });
  assert.equal(settings.data.hasImage2ApiKey, true);
  const share = await candidate.runAiWearShareCardCandidate({ db, id: "missing", featureFlag: true });
  assert.equal(share.status, 200);
  const missing = await candidate.runAiWearResultCandidate({ row: null, featureFlag: true });
  assert.equal(missing.status, 404);
  const cost = await candidate.runAiWearCostSummaryCandidate({ db, featureFlag: true, now: Date.parse("2026-07-12T00:00:00Z") });
  assert.equal(cost.data.today.count, 0);
  assert.equal(db.calls.every((call) => call.mode === "bind"), true);
});

test("candidate exceptions propagate without write adapter", async () => {
  let writes = 0;
  await assert.rejects(() => candidate.runAiWearGalleryCandidate({ featureFlag: true, db: { prepare() { throw new Error("SQL failure"); }, run() { writes += 1; } } }), /SQL failure/);
  assert.equal(writes, 0);
});
