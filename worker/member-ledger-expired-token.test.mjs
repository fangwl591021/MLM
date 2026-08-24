import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");

test("member ledger uses the signed expired-token fallback only for internal calls", () => {
  const routeStart = worker.indexOf('url.pathname === "/api/points/member-ledger"');
  const routeEnd = worker.indexOf('url.pathname === "/api/copilot/customer"', routeStart);
  const route = worker.slice(routeStart, routeEnd);
  const verifyStart = worker.indexOf("async function verifyLineIdToken");
  const verifyEnd = worker.indexOf("async function fetchMemberPointLedger", verifyStart);
  const verifier = worker.slice(verifyStart, verifyEnd);

  assert.match(route, /allowRecentlyExpiredIdToken: url\.hostname === "mlm\.internal"/);
  assert.match(verifier, /recentlyExpiredSignedAiWearLineProfile\(idToken, clientId\)/);
  assert.match(verifier, /if \(expiredProfile\) return expiredProfile/);
});

test("member ledger public request body cannot enable fallback", () => {
  assert.doesNotMatch(worker, /body\.allowRecentlyExpiredIdToken/);
});
