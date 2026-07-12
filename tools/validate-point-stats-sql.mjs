import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { POINT_STATS_SQL } = require("../src/modules/points/point-stats-candidate.js");
const { REWARD_CALENDAR_SQL } = require("../src/modules/reward/reward-read-candidate.js");
const { AI_WEAR_SETTINGS_SQL, AI_WEAR_GALLERY_SQL, AI_WEAR_RESULTS_SQL, AI_WEAR_SHARE_CARD_SQL, AI_WEAR_COST_SQL } = require("../src/modules/ai-wear/ai-wear-read-candidate.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = fs.readFileSync(path.join(root, "worker/worker.js"), "utf8");
const where = "pl.created_at >= ? AND pl.source NOT IN ('sync', 'import') AND pl.action NOT IN ('sync', 'import') AND pl.business_key NOT LIKE 'sync:%' AND pl.channel_key = ? AND pl.point_type = ?";
const bindings = ["2026-07-10 00:00:00", "oa1", "gift_money"];
const userNameSql = `COALESCE(
    NULLIF((
      SELECT cm.name
      FROM crm_members cm
      WHERE cm.member_ref = pl.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = pl.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = pl.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = pl.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = pl.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.LINE_display_name')
      FROM crm_members cm
      WHERE cm.member_ref = pl.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = pl.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = pl.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = pl.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = pl.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.display_name')
      FROM crm_members cm
      WHERE cm.member_ref = pl.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = pl.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = pl.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = pl.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT p.display_name
      FROM profiles p
      WHERE p.user_id = pl.line_user_id
        AND p.display_name IS NOT NULL
        AND p.display_name <> ''
        AND p.display_name <> p.user_id
      ORDER BY p.updated_at DESC
      LIMIT 1
    ), '')
  )`;
const specs = [
  ["daily", /const dailyRows = await env\.DB\.prepare\(`([\s\S]*?)`\)\.bind/, () => POINT_STATS_SQL.daily(where)],
  ["breakdown", /const breakdownRows = await env\.DB\.prepare\(`([\s\S]*?)`\)\.bind/, () => POINT_STATS_SQL.breakdown(where)],
  ["recent", /const recentRows = await env\.DB\.prepare\(`([\s\S]*?)`\)\.bind/, () => POINT_STATS_SQL.recent(where, userNameSql)],
  ["members", /const memberRows = await env\.DB\.prepare\(`([\s\S]*?)`\)\.bind/, () => POINT_STATS_SQL.members(where, userNameSql)],
];
const normalize = (value) => value.replace(/\r\n/g, "\n");
const failures = [];
for (const [name, pattern, candidateFactory] of specs) {
  const match = worker.match(pattern);
  if (!match) { failures.push(`${name}: Legacy SQL not found`); continue; }
  const legacy = normalize(match[1]).replaceAll("${filter.where}", where).replaceAll("${userNameSql}", userNameSql);
  const candidate = normalize(candidateFactory());
  const hash = (sql) => crypto.createHash("sha256").update(sql).digest("hex");
  console.log(`${name}: ${hash(legacy)} ${hash(candidate)}`);
  if (legacy !== candidate) failures.push(`${name}: SQL mismatch`);
}
const rewardMatch = worker.match(/async function fetchRewardCalendarEvents[\s\S]*?prepare\(`([\s\S]*?)`\)\.bind/);
if (!rewardMatch) failures.push("reward-calendar: Legacy SQL not found");
else {
  const legacy = normalize(rewardMatch[1]);
  const candidate = normalize(REWARD_CALENDAR_SQL);
  const hash = (sql) => crypto.createHash("sha256").update(sql).digest("hex");
  console.log(`reward-calendar: ${hash(legacy)} ${hash(candidate)}`);
  if (legacy !== candidate) failures.push("reward-calendar: SQL mismatch");
}const aiWearLegacySql = [
  ["ai-wear-settings", AI_WEAR_SETTINGS_SQL, "SELECT value FROM app_meta WHERE key = ?"],
  ["ai-wear-gallery", AI_WEAR_GALLERY_SQL, "SELECT id, title, series, file_name, mime_type, size, active, created_at, updated_at FROM ai_wear_references WHERE active = 1 ORDER BY updated_at DESC LIMIT 200"],
  ["ai-wear-results", AI_WEAR_RESULTS_SQL, "SELECT id, line_user_id, display_name, model_id, model_title, person_image_url, result_image_url, result_mime_type, CASE WHEN result_base64 != '' THEN 1 ELSE 0 END AS has_result_blob, point_cost, point_channel_key, point_type, status, created_at FROM ai_wear_results ORDER BY created_at DESC LIMIT ?"],
  ["ai-wear-share-card", AI_WEAR_SHARE_CARD_SQL, "SELECT id, sharer_name, caption, image_url, purchase_line_url, share_format FROM ai_wear_shares WHERE id = ?"],
  ["ai-wear-cost-today", AI_WEAR_COST_SQL.today, "SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?"],
  ["ai-wear-cost-month", AI_WEAR_COST_SQL.month, "SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?"],
  ["ai-wear-cost-member", AI_WEAR_COST_SQL.byMember, "SELECT line_user_id, display_name, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost, MAX(created_at) AS last_at FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY line_user_id, display_name ORDER BY total_cost_twd DESC, count DESC LIMIT ?"],
  ["ai-wear-cost-model", AI_WEAR_COST_SQL.byModel, "SELECT model_id, model_title, ai_model, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY model_id, model_title, ai_model ORDER BY total_cost_twd DESC, count DESC LIMIT ?"],
  ["ai-wear-cost-recent", AI_WEAR_COST_SQL.recent, "SELECT result_id, line_user_id, display_name, model_title, ai_model, provider, point_cost, estimated_cost_twd, actual_cost_usd, cost_source, status, created_at FROM ai_wear_cost_events ORDER BY created_at DESC LIMIT ?"],
];
for (const [name, candidate, legacy] of aiWearLegacySql) {
  const candidateNormalized = normalize(candidate);
  const legacyNormalized = normalize(legacy);
  const hash = (sql) => crypto.createHash("sha256").update(sql).digest("hex");
  console.log(name + ": " + hash(legacyNormalized) + " " + hash(candidateNormalized));
  if (legacyNormalized !== candidateNormalized || !worker.includes(legacy)) failures.push(name + ": SQL mismatch or Legacy SQL not found");
}
if (failures.length) {
  console.error("Point Stats SQL Parity: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Point Stats SQL Parity: PASS");
  console.log(`- bindings: ${JSON.stringify(bindings)}`);
  console.log("- four Legacy SQL statements preserved");
}
