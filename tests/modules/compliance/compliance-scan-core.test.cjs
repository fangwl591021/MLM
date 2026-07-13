const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../../src/modules/compliance/compliance-scan-core.js");

const terms = [
  { term: "體型管理", normalized_term: "體型管理", category: "company_internal_banned_term", risk_level: "red", block_publish: 1, rule_version: "compliance-v1", enabled: 1, internal_case_note: "公司歷史裁罰高風險用語" },
  { term: "食品療效", normalized_term: "食品療效", category: "food_claim_review", risk_level: "orange", block_publish: 0, rule_version: "compliance-v1", enabled: 1 },
];

test("compliance scan normalizes whitespace, fullwidth text and case", () => {
  assert.equal(core.normalizeComplianceText(" Ｔｅｓｔ  " ), "test");
  const result = core.buildComplianceScanResult({ question: "請問 體 型 管理", answer: "食品療效", keywords: ["食品療效"] }, terms);
  assert.equal(result.riskLevel, "red");
  assert.equal(result.canPublish, false);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(new Set(result.matches.map((match) => match.field)), new Set(["question", "answer", "keywords"]));
});

test("green and orange results remain publishable with explicit risk", () => {
  const orange = core.buildComplianceScanResult({ question: "食品療效請人工確認" }, terms);
  assert.equal(orange.riskLevel, "orange");
  assert.equal(core.canPublishComplianceResult(orange), true);
  const green = core.buildComplianceScanResult({ question: "產品規格", answer: "一般說明" }, terms);
  assert.equal(green.riskLevel, "green");
  assert.equal(green.canPublish, true);
});

test("content hash is stable and scan matches preserve rule metadata", () => {
  assert.equal(core.hashComplianceContent({ question: "Q", answer: "A", keywords: ["K"] }), core.hashComplianceContent({ question: "Q", answer: "A", keywords: ["K"] }));
  const result = core.buildComplianceScanResult({ answer: "體型管理" }, terms);
  assert.equal(result.matches[0].category, "company_internal_banned_term");
  assert.equal(result.matches[0].reason, "公司歷史裁罰高風險用語");
});

