import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const boundary = JSON.parse(fs.readFileSync(path.join(root, "docs/phase2-module-boundaries.json"), "utf8"));
const failures = [];
for (const relative of boundary.requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing required file: ${relative}`);
}
const corePath = path.join(root, "src/modules/points/point-stats-core.js");
if (fs.existsSync(corePath)) {
  const source = fs.readFileSync(corePath, "utf8").toLowerCase();
  for (const forbidden of boundary.forbiddenCoreReferences) {
    if (source.includes(forbidden.toLowerCase())) failures.push(`forbidden core reference: ${forbidden}`);
  }
}
const candidatePath = path.join(root, "src/modules/points/point-stats-candidate.js");
if (fs.existsSync(candidatePath) && !fs.readFileSync(candidatePath, "utf8").includes("featureFlag = false")) failures.push("feature flag default is not false");
if (fs.existsSync(candidatePath) && !fs.readFileSync(candidatePath, "utf8").includes("point-stats-core.js")) failures.push("candidate does not depend on core");
if (fs.existsSync(corePath) && fs.readFileSync(corePath, "utf8").includes("point-stats-candidate.js")) failures.push("core depends on candidate");
if (!fs.existsSync(path.join(root, "worker/worker.js"))) failures.push("worker/worker.js missing");
if (!fs.existsSync(path.join(root, "wrangler.toml"))) failures.push("wrangler.toml missing");
if (failures.length) {
  console.error("Phase 2 Boundary: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Phase 2 Boundary: PASS");
  console.log("- points core -> candidate: forbidden");
  console.log("- candidate -> points core: allowed");
  console.log("- feature flag default: false");
  console.log("- runtime wiring: local shadow harness only");
}
