const test = require("node:test");
const assert = require("node:assert/strict");
const { compareShadowResults } = require("../../../src/modules/system/shadow-compare.js");

test("equal results compare cleanly", () => assert.deepEqual(compareShadowResults({ status: 200, data: [1] }, { status: 200, data: [1] }), { equal: true, mismatches: [] }));
test("compare reports type, key, order, length and nested differences", () => {
  const result = compareShadowResults({ a: 1, b: null, rows: [{ x: 1 }, { x: 2 }] }, { a: "1", rows: [{ x: 2 }] });
  assert.equal(result.equal, false);
  assert.equal(result.mismatches.some((item) => item.path === "a" && item.reason === "type_mismatch"), true);
  assert.equal(result.mismatches.some((item) => item.path === "b" && item.reason === "missing_key"), true);
  assert.equal(result.mismatches.some((item) => item.path === "rows.length" && item.reason === "array_length_mismatch"), true);
  assert.equal(result.mismatches.some((item) => item.path === "rows[0].x" && item.reason === "value_mismatch"), true);
  assert.equal(compareShadowResults({ rows: [{ id: 1 }, { id: 2 }] }, { rows: [{ id: 2 }, { id: 1 }] }).mismatches.some((item) => item.reason === "array_order_mismatch"), true);
});
