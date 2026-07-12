import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { POINT_STATS_SQL } = require("../src/modules/points/point-stats-candidate.js");
const { REWARD_CALENDAR_SQL } = require("../src/modules/reward/reward-read-candidate.js");
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
}if (failures.length) {
  console.error("Point Stats SQL Parity: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Point Stats SQL Parity: PASS");
  console.log(`- bindings: ${JSON.stringify(bindings)}`);
  console.log("- four Legacy SQL statements preserved");
}
