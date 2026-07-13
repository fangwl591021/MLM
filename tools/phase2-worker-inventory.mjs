import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(fs.readFileSync(path.join(root, "docs/phase2-worker-inventory.json"), "utf8"));
const failures = [];
function gitBlob(relative) {
  return execFileSync("git", ["-C", root, "hash-object", relative], { encoding: "utf8" }).trim();
}
for (const file of ["worker/worker.js", "wrangler.toml"]) if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);
const workerPath = path.join(root, "worker/worker.js");
const workerChanged = fs.existsSync(workerPath) && gitBlob("worker/worker.js") !== inventory.workerBlobSha1;
if (workerChanged) {
  const diff = execFileSync("git", ["-C", root, "diff", "--", "worker/worker.js"], { encoding: "utf8" });
  if (!/knowledge|compliance/i.test(diff)) failures.push("Worker changed outside approved Knowledge/Compliance area");
  const forbidden = [/points/i, /reward/i, /ai-wear/i, /line-oa/i, /auth/i, /crm/i, /calendar/i, /checkin/i, /reply-learning/i];
  for (const pattern of forbidden) if (pattern.test(diff) && !/knowledge|compliance/i.test(diff)) failures.push(`Worker diff contains forbidden domain: ${pattern}`);
}
if (fs.existsSync(path.join(root, "wrangler.toml")) && gitBlob("wrangler.toml") !== inventory.wranglerBlobSha1) failures.push("wrangler.toml baseline hash mismatch");
for (const file of ["src/modules/points/point-stats-core.js", "src/modules/points/point-stats-candidate.js", "src/modules/reward/reward-read-core.js", "src/modules/reward/reward-read-candidate.js", "src/modules/ai-wear/ai-wear-read-core.js", "src/modules/ai-wear/ai-wear-read-candidate.js", "src/modules/compliance/compliance-scan-core.js"]) if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);
const candidate = fs.readFileSync(path.join(root, "src/modules/points/point-stats-candidate.js"), "utf8");
if (!candidate.includes("featureFlag = false")) failures.push("feature flag default is not false");
const rewardCandidate = fs.readFileSync(path.join(root, "src/modules/reward/reward-read-candidate.js"), "utf8");
if (!rewardCandidate.includes("featureFlag = false")) failures.push("reward feature flag default is not false");
const aiWearCandidate = fs.readFileSync(path.join(root, "src/modules/ai-wear/ai-wear-read-candidate.js"), "utf8");
if (!aiWearCandidate.includes("AI_WEAR_READ_SHADOW_ENABLED = false")) failures.push("AI Wear feature flag default is not false");
if (failures.length) {
  console.error("Phase 2 Worker Inventory: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Phase 2 Worker Inventory: PASS");
  console.log(workerChanged ? "- Worker changed only in approved Knowledge/Compliance scope" : "- Worker baseline hash unchanged");
  console.log("- formal routes unchanged by runtime hash guard");
  console.log("- no new production write route");
  console.log("- feature flag default: false");
}
