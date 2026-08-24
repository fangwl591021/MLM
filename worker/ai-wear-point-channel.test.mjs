import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");

test("AI Wear point verification uses its LIFF channel before legacy reward settings", () => {
  const start = worker.indexOf("function aiWearLineClientId");
  const end = worker.indexOf("async function verifyAiWearLineProfileFromToken", start);
  const implementation = worker.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(
    implementation.indexOf("AI_WEAR_LINE_LOGIN_CHANNEL_ID") < implementation.indexOf("normalizeAiWearLiffId"),
  );
  assert.ok(
    implementation.indexOf("normalizeAiWearLiffId") < implementation.indexOf("REWARD_LINE_LOGIN_CHANNEL_ID"),
  );
});
