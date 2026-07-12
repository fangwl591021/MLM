const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../../src/modules/ai-wear/ai-wear-read-core.js");

const BASE = "https://example.test";

test("public settings use an explicit whitelist and omit private/cost fields", () => {
  const settings = core.normalizeSettings({ image2ApiKey: "secret", costPerGeneration: "1.5", costControlEnabled: true, pointCost: 10, title: "公開" });
  const publicSettings = core.sanitizeAiWearSettingsForPublic(settings);
  assert.equal(publicSettings.title, "公開");
  assert.equal(publicSettings.image2ApiKey, "");
  assert.equal(publicSettings.hasImage2ApiKey, true);
  assert.equal(Object.hasOwn(publicSettings, "costPerGeneration"), false);
  assert.equal(Object.hasOwn(publicSettings, "prompt"), true);
  assert.equal(Object.hasOwn(publicSettings, "image2ApiKey"), true);
  assert.equal(Object.hasOwn(publicSettings, "rawModelSettings"), false);
});

test("JSON, boolean, number and settings defaults preserve legacy behavior", () => {
  assert.deepEqual(core.parseAiWearJson("invalid", { fallback: true }), { fallback: true });
  assert.deepEqual(core.parseAiWearJson("[]", { fallback: true }), []);
  assert.equal(core.normalizeSettings({ pointDeductionEnabled: false, pointCost: 0, usdToTwdRate: 0 }).pointDeductionEnabled, false);
  assert.equal(core.normalizeSettings({ liffId: "bad" }).liffId, "2007221311-ISFxRBY3");
  assert.equal(core.normalizeSettings({ publicPath: "/admin/private" }).publicPath, "/ai-wear");
});

test("gallery mapping preserves order, duplicates, missing fields and URL version", () => {
  const rows = [
    { id: "a", title: "", series: null, file_name: "a.png", mime_type: "image/png", size: "2", created_at: 1, updated_at: 9 },
    { id: "a", title: "duplicate", result_secret: "hidden", created_at: 2, updated_at: 0 },
  ];
  const mapped = core.mapAiWearGallery(rows, BASE);
  assert.equal(mapped.items.length, 2);
  assert.equal(mapped.items[0].url, "https://example.test/assets/ai-wear/reference/a?v=9");
  assert.equal(mapped.items[1].id, "a");
  assert.equal(mapped.items[1].url, "https://example.test/assets/ai-wear/reference/a?v=2");
  assert.equal(Object.hasOwn(mapped.items[0], "result_secret"), false);
});

test("result and share card mappings preserve schema and fallback", () => {
  const result = core.mapAiWearResult({ id: "r1", line_user_id: "U1", has_result_blob: 1, result_image_url: "remote", status: "completed", created_at: "4" }, BASE);
  assert.equal(result.resultImageUrl, "https://example.test/assets/ai-wear/result/r1");
  assert.equal(result.createdAt, 4);
  const card = core.mapAiWearShareCard({ id: "s1", sharer_name: "Tony", image_url: "https://img.test/card", share_format: "format2" }, BASE);
  assert.equal(card.imageUrl, "https://img.test/card.jpg");
  assert.equal(card.shareUrl, "https://example.test/ai-wear/share/s1");
  assert.equal(card.flexAspectRatio, "3:4");
  assert.equal(card.caption, "看看我的 AI 眼鏡試戴對照圖。");
});

test("cost summary keeps precision, types, zero and null handling", () => {
  const summary = core.mapAiWearCostSummary({
    settings: { costPerGeneration: "0.7", costCurrency: "usd", usdToTwdRate: "32" },
    today: { count: "2", success_count: null, total_cost_twd: "0.7078", total_point_cost: "0" },
    byMember: [{ line_user_id: "U1", total_cost_twd: "1.23456", count: "1" }],
  });
  assert.equal(summary.today.totalCostTwd, 0.7078);
  assert.equal(summary.today.successCount, 0);
  assert.equal(summary.settings.costCurrency, "USD");
  assert.equal(summary.byMember[0].totalCostTwd, 1.2346);
  assert.equal(summary.recent.length, 0);
});
