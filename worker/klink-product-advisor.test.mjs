import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKlinkProductAdvisorResponse,
  isMedicalProductQuery,
  isAllowedKlinkAdvisorHost,
  KLINK_MEDICAL_REFUSAL,
  listKlinkProducts,
} from "./klink-product-advisor.js";

test("catalog contains 23 products and every product has a review status", () => {
  const products = listKlinkProducts();
  assert.equal(products.length, 23);
  assert.ok(products.every((product) => ["approved", "partial", "pending_review"].includes(product.reviewStatus)));
  assert.ok(products.every((product) => product.productName && product.productSeries && Array.isArray(product.approvedPublicFacts)));
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
  assert.equal(result.needsClarification, false);
  assert.equal(result.products[0].name, "康綠寶");
  assert.match(result.answer, /500g/);
  assert.equal(result.actions[0].url, "https://lin.ee/example");
});

test("pending review products do not expose unapproved specifications", () => {
  const product = listKlinkProducts().find((item) => item.reviewStatus === "pending_review");
  assert.ok(product);
  const result = buildKlinkProductAdvisorResponse({ query: product.name, quadrant: "Q1" });
  assert.equal(result.products[0].reviewStatus, "pending_review");
  assert.deepEqual(result.products[0].specifications, []);
  assert.equal(result.products[0].size, "");
  assert.equal(result.products[0].usage, "");
});

test("unrelated requests require clarification instead of default recommendations", () => {
  const result = buildKlinkProductAdvisorResponse({ query: "我想找一個完全沒有資料的東西", quadrant: "Q2" });
  assert.equal(result.needsClarification, true);
  assert.deepEqual(result.products, []);
  assert.match(result.clarificationQuestion, /補充/);
});

test("quadrants change only wording and keep product facts identical", () => {
  const q1 = buildKlinkProductAdvisorResponse({ query: "康綠寶", quadrant: "rational_fast" });
  const q4 = buildKlinkProductAdvisorResponse({ query: "康綠寶", quadrant: "emotional_relationship" });
  assert.equal(q1.quadrantKey, "rational_fast");
  assert.equal(q4.quadrantKey, "emotional_relationship");
  assert.notEqual(q1.answer, q4.answer);
  assert.deepEqual(q1.products, q4.products);
});

test("public domains cannot call the internal product advisor", () => {
  assert.equal(isAllowedKlinkAdvisorHost("mlm.internal"), true);
  assert.equal(isAllowedKlinkAdvisorHost("mlm.fangwl591021.workers.dev"), false);
  assert.equal(isAllowedKlinkAdvisorHost("example.com"), false);
});
test("invalid member URL is never returned as CTA", () => {
  const result = buildKlinkProductAdvisorResponse({
    query: "想比較眼鏡款式",
    memberLineUrl: "javascript:alert(1)",
  });
  assert.equal(result.actions.some((item) => item.type === "line"), false);
});
test("consumer wording is natural and does not expose internal metadata", () => {
  const result = buildKlinkProductAdvisorResponse({ query: "康綠寶", quadrant: "emotional_experience", memberLineUrl: "https://lin.ee/example" });
  assert.doesNotMatch(result.answer, /可以！先幫你抓重點/);
  assert.doesNotMatch(result.answer, /Q[1-4]|理性快速|感性快速|產品編號|國際計畫/);
  assert.equal(result.disclaimer, "商品資訊以官方最新公告為準。");
  assert.deepEqual(result.actions.map((item) => item.label), ["問問推薦人", "查看官方介紹"]);
});

test("pending product uses a natural incomplete-data message", () => {
  const product = listKlinkProducts().find((item) => item.reviewStatus === "pending_review");
  const result = buildKlinkProductAdvisorResponse({ query: product.name, quadrant: "Q4" });
  assert.equal(result.answer, "這項商品的詳細資料還在整理中，你可以先問問推薦人。");
  assert.doesNotMatch(result.answer, /pending_review|審核狀態|Q4/);
});
test("natural copy formats specs and usage without mechanical punctuation", () => {
  const q3 = buildKlinkProductAdvisorResponse({ query: "齊夯諾", quadrant: "Q3" });
  assert.equal(q3.answer, "齊夯諾是粉包食品，每包 10g，一盒 20 包。想先看看裡面有哪些成分，還是直接了解怎麼沖泡？");
  assert.doesNotMatch(q3.answer, /。；|；；|可提供成分、容量與食用方式/);

  const green = buildKlinkProductAdvisorResponse({ query: "康綠寶", quadrant: "Q3" });
  assert.equal(green.answer, "康綠寶是粉狀沖泡食品，每瓶 500g。想先看看裡面有哪些成分，還是直接了解怎麼沖泡？");
  assert.match(green.answer, /怎麼沖泡/);
  assert.doesNotMatch(green.answer, /。；|；；|可提供成分、容量與食用方式/);
});