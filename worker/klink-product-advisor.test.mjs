import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKlinkProductAdvisorResponse,
  isMedicalProductQuery,
  KLINK_MEDICAL_REFUSAL,
  listKlinkProducts,
} from "./klink-product-advisor.js";

test("catalog contains the 23 reviewed first-pass products and services", () => {
  assert.equal(listKlinkProducts().length, 23);
});

test("medical intent is blocked before product retrieval", () => {
  assert.equal(isMedicalProductQuery("睡不著可以吃哪一個產品改善"), true);
  assert.equal(isMedicalProductQuery("我在意的是商品選擇痛點與預算"), false);
  const result = buildKlinkProductAdvisorResponse({
    query: "血壓高可以吃康酵寶治療嗎",
    quadrant: "Q1",
    memberLineUrl: "https://lin.ee/example",
  });
  assert.equal(result.blocked, true);
  assert.equal(result.answer, KLINK_MEDICAL_REFUSAL);
  assert.deepEqual(result.products, []);
});

test("safe specification question returns facts and member CTA", () => {
  const result = buildKlinkProductAdvisorResponse({
    query: "康綠寶怎麼沖泡，容量是多少",
    quadrant: "Q2",
    memberLineUrl: "https://lin.ee/example",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.products[0].name, "康綠寶");
  assert.match(result.answer, /500g/);
  assert.equal(result.actions[0].url, "https://lin.ee/example");
});

test("invalid member URL is never returned as CTA", () => {
  const result = buildKlinkProductAdvisorResponse({
    query: "想比較眼鏡款式",
    memberLineUrl: "javascript:alert(1)",
  });
  assert.equal(result.actions.some((item) => item.type === "line"), false);
});
