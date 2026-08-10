import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = fs.readFileSync(path.join(root, "worker", "worker.js"), "utf8");

test("point sources keep separate point types", () => {
  assert.match(worker, /function pointTypeForSource\(channelKey\) \{\s*return channelKey === POINT_OA2 \? "system_point" : "gift_money";\s*\}/);
  assert.match(worker, /if \(channelKey === POINT_OA2\) return \[pointTypeForSource\(channelKey\)\]/);
});

test("OA2 stays pinned to shop 1584 and cannot inherit the OA1 shop override", () => {
  assert.match(worker, /if \(channelKey === POINT_OA2\) return Number\(POINT_SOURCE_META\[POINT_OA2\]\.shopId\);/);
  assert.doesNotMatch(worker, /channelKey === POINT_OA2 \? env\.WETW_POINT_SHOP_ID_OA2/);
});

test("OA2 balances do not fall back to gift money rows", () => {
  assert.match(worker, /requestedType === "gift_money" \? fallbackRows : \[\]/);
});

test("ledger and mutations use the source point type", () => {
  assert.match(worker, /const pointType = pointTypeForSource\(sourceKey\);\s*const snapshot = await fetchWetwPointSnapshot\(env, sourceKey, sourceLineUserId, pointType, limit\)/);
  assert.match(worker, /const pointType = pointTypeForSource\(channelKey\);[\s\S]*?pointType,\s*pointDelta: delta/);
  assert.match(worker, /point_type: pointType,/);
});

test("AI Wear remains pinned to OA1 gift money", () => {
  assert.match(worker, /return \{ \.\.\.settings, pointChannelKey: POINT_OA1, pointType: "gift_money" \};/);
});
