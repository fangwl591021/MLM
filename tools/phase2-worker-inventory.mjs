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
if (fs.existsSync(path.join(root, "worker/worker.js")) && gitBlob("worker/worker.js") !== inventory.workerBlobSha1) failures.push("worker/worker.js baseline hash mismatch");
if (fs.existsSync(path.join(root, "wrangler.toml")) && gitBlob("wrangler.toml") !== inventory.wranglerBlobSha1) failures.push("wrangler.toml baseline hash mismatch");
for (const file of ["src/modules/points/point-stats-core.js", "src/modules/points/point-stats-candidate.js", "src/modules/reward/reward-read-core.js", "src/modules/reward/reward-read-candidate.js"]) if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);
const candidate = fs.readFileSync(path.join(root, "src/modules/points/point-stats-candidate.js"), "utf8");
if (!candidate.includes("featureFlag = false")) failures.push("feature flag default is not false");
const rewardCandidate = fs.readFileSync(path.join(root, "src/modules/reward/reward-read-candidate.js"), "utf8");
if (!rewardCandidate.includes("featureFlag = false")) failures.push("reward feature flag default is not false");
if (failures.length) {
  console.error("Phase 2 Worker Inventory: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Phase 2 Worker Inventory: PASS");
  console.log("- Worker and wrangler baseline hashes unchanged");
  console.log("- formal routes unchanged by runtime hash guard");
  console.log("- no new production write route");
  console.log("- feature flag default: false");
}
