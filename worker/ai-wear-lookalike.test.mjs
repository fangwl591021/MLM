import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = fs.readFileSync(path.join(root, "worker", "worker.js"), "utf8");
const aiWear = fs.readFileSync(path.join(root, "ai-wear.html"), "utf8");
const consoleHtml = fs.readFileSync(path.join(root, "console.html"), "utf8");

test("public AI Wear endpoint passes generationType and separates payloads", () => {
  assert.match(worker, /getAiWearPublicData\(env, url\.searchParams\.get\("generationType"\)\)/);
  assert.match(worker, /const includeGlasses = !requested \|\| requested === "glasses"/);
  assert.match(worker, /const includeLookalike = !requested \|\| requested === "lookalike"/);
  assert.match(worker, /lookalikeTemplates: lookalikeTemplates\.items \|\| \[\]/);
});

test("frontend has explicit landing, glasses, and lookalike entries", () => {
  assert.match(aiWear, /id="modeChooser"/);
  assert.match(aiWear, /id="enterGlassesMode"/);
  assert.match(aiWear, /id="enterLookalikeMode"/);
  assert.match(aiWear, /state\.mode==="lookalike"\?"lookalike":state\.mode==="glasses"\?"glasses":""/);
});

test("lookalike generation uses the full person reference without a glasses mask", () => {
  assert.match(aiWear, /form\.append\("generationType",state\.mode==="lookalike"\?"lookalike":"glasses"\)/);
  assert.match(worker, /input\.generationType === "lookalike" \? "composition_style_reference" : "glasses_style_only"/);
  assert.match(worker, /function buildAiWearLookalikePrompt\(/);
  assert.match(worker, /整張圖都是同款目標，不只是人物姿勢參考/);
  assert.match(worker, /不得把完整場景裁成只有人物的近照或大頭照/);
  assert.match(aiWear, /完整人物＋場景參考/);
});

test("public lookalike template output excludes private prompts", () => {
  const listSection = worker.slice(worker.indexOf("async function listAiWearLookalikeTemplates"), worker.indexOf("async function uploadAiWearLookalikeTemplate"));
  assert.doesNotMatch(listSection, /prompt:/);
  assert.doesNotMatch(listSection, /negativePrompt:/);
  assert.match(worker, /SELECT id, title, category, description, gender, shot_type, aspect_ratio/);
});

test("lookalike templates and point events have separate server-owned fields", () => {
  assert.match(worker, /ai_lookalike_generate/);
  assert.match(worker, /ai-lookalike/);
  assert.match(worker, /lookalikePointDeductionEnabled/);
  assert.match(worker, /lookalikePointCost/);
  for (const id of ["aiWearLookalikeTemplateCategory", "aiWearLookalikeTemplateDescription", "aiWearLookalikeTemplatePrompt", "aiWearLookalikeTemplateNegativePrompt", "aiWearLookalikeTemplateGender", "aiWearLookalikeTemplateShotType", "aiWearLookalikeTemplateAspectRatio"]) {
    assert.match(consoleHtml, new RegExp(`id="${id}"`));
  }
});

test("legacy glasses mode remains the fallback", () => {
  assert.match(worker, /function normalizeAiWearGenerationType\(value\)/);
  assert.match(worker, /=== "lookalike" \? "lookalike" : "glasses"/);
  assert.match(aiWear, /state\.mode==="lookalike"\?"lookalike":"glasses"/);
});
