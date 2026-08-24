import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../ai-wear.html", import.meta.url), "utf8");

test("AI Wear prevents repeated LINE login redirects", () => {
  assert.match(html, /AI_WEAR_LOGIN_PENDING_KEY/);
  assert.match(html, /isAiWearLineClient\(\)/);
  assert.match(html, /beginAiWearLineLogin\(\)/);
  assert.match(html, /cleanAiWearLoginRedirectUrl\(\)/);
  assert.doesNotMatch(html, /liff\.login\(\{ redirectUri: location\.href \}\)/);
});

test("expired AI Wear tokens use one bounded LIFF reauth redirect", () => {
  const start = html.indexOf("function forceAiWearLineRelogin");
  const end = html.indexOf("function aiWearReferralId", start);
  const handler = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(handler, /liff\.logout/);
  assert.doesNotMatch(handler, /liff\.login/);
  assert.match(handler, /AI_WEAR_REAUTH_ATTEMPT_KEY/);
  assert.match(handler, /aiWearReauthRecentlyAttempted\(\)/);
  assert.match(handler, /location\.replace\(target\)/);
  assert.match(handler, /正在更新登入狀態/);
});
