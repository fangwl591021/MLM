import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");

test("expired LINE ID token fallback is signed, internal-only, and bounded", () => {
  const routeStart = worker.indexOf('url.pathname === "/api/ai-wear/member-points"');
  const routeEnd = worker.indexOf('url.pathname === "/api/ai-wear/member-settings"', routeStart);
  const route = worker.slice(routeStart, routeEnd);
  const helperStart = worker.indexOf("async function recentlyExpiredSignedAiWearLineProfile");
  const helperEnd = worker.indexOf("async function verifyAiWearLineProfileFromToken", helperStart);
  const helper = worker.slice(helperStart, helperEnd);

  assert.match(route, /allowRecentlyExpiredIdToken: url\.hostname === "mlm\.internal"/);
  assert.match(helper, /https:\/\/api\.line\.me\/oauth2\/v2\.1\/certs/);
  assert.match(helper, /crypto\.subtle\.verify/);
  assert.match(helper, /claims && claims\.iss.*https:\/\/access\.line\.me/);
  assert.match(helper, /audiences.*includes\(expectedClientId\)/s);
  assert.match(helper, /\^U\[0-9a-f\]\{32\}\$/i);
  assert.match(helper, /now - expiresAt > 7 \* 86400/);
});

test("public callers cannot enable the expired token fallback through request data", () => {
  assert.doesNotMatch(worker, /body\.allowRecentlyExpiredIdToken/);
});
