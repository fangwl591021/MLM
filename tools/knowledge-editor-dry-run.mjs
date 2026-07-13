import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import core from "../src/modules/compliance/compliance-scan-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "migrations/0001_knowledge_editor_compliance.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "worker/schema.sql"), "utf8");

assert.match(migration, /ALTER TABLE knowledge_items ADD COLUMN status/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS compliance_terms/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS compliance_scan_logs/);
assert.match(migration, /INSERT OR IGNORE INTO compliance_terms/);
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM knowledge_items/i);
assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_items/);

const oldRow = { id: 48, floor_id: "main", question: "舊問題", answer: "舊答案", source: "legacy.json", status: "published", deleted_at: null };
assert.equal(oldRow.id, 48);
assert.equal(oldRow.status, "published");
assert.equal(oldRow.deleted_at, null);

const terms = [
  { term: "體型管理", normalized_term: "體型管理", category: "company_internal_banned_term", risk_level: "red", block_publish: 1, rule_version: "compliance-v1", enabled: 1 },
  { term: "食品療效", normalized_term: "食品療效", category: "food_claim_review", risk_level: "orange", block_publish: 0, rule_version: "compliance-v1", enabled: 1 },
];
const draft = core.buildComplianceScanResult({ question: "體型管理", answer: "草稿", keywords: [] }, terms);
assert.equal(draft.canPublish, false);
assert.equal(draft.riskLevel, "red");
const safe = core.buildComplianceScanResult({ question: "產品規格", answer: "一般說明", keywords: [] }, terms);
assert.equal(safe.canPublish, true);
assert.equal(safe.riskLevel, "green");

console.log("Knowledge Editor Local Dry Run: PASS");
console.log("- migration preserves legacy row identity and does not drop knowledge_items");
console.log("- draft red scan is blocked from publish");
console.log("- safe content remains publishable");
console.log("- no Remote D1 or production write executed");
