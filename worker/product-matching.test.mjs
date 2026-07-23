import test from "node:test";
import assert from "node:assert/strict";
import { detectMedicalQuestion, matchProducts, matchRequest, normalizeProduct, QUADRANTS } from "./product-matching.mjs";

const product = {
  name: "葉綠素套組",
  series: "日常營養系列",
  publicFacts: ["含葉綠素與蔬果來源成分"],
  specs: ["每瓶 500ml"],
  usage: ["依標示使用"],
  safetyTags: ["孕哺期請先諮詢專業人員"],
  prohibitedClaims: ["不得宣稱治療疾病"],
  source: "approved-catalog",
  reviewStatus: "approved",
  quadrants: {
    rational_fast: "快速了解成分與使用方式。",
    rational_careful: "先閱讀標示與注意事項，再依需求評估。",
    emotional_experience: "把日常補給變成輕鬆的生活體驗。",
    emotional_relationship: "陪你建立適合自己的日常補給習慣。",
  },
};

test("keeps the required four communication quadrants", () => {
  assert.deepEqual(Object.keys(QUADRANTS), ["rational_fast", "rational_careful", "emotional_experience", "emotional_relationship"]);
  assert.equal(normalizeProduct(product).quadrants.rational_careful, product.quadrants.rational_careful);
});

test("intercepts medical questions before product matching", () => {
  assert.equal(detectMedicalQuestion("這個可以治療糖尿病嗎").blocked, true);
  const result = matchProducts({ question: "能不能改善症狀", products: [product] });
  assert.equal(result.code, "MEDICAL_CLAIM_INTERCEPTED");
  assert.equal(result.candidates.length, 0);
});

test("matches only approved products and preserves product facts", () => {
  const result = matchProducts({ question: "葉綠素怎麼使用", quadrant: "emotional_experience", products: [product, { ...product, name: "草稿商品", reviewStatus: "draft" }] });
  assert.equal(result.code, "MATCHED");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].product.publicFacts[0], product.publicFacts[0]);
  assert.equal(result.candidates[0].product.message, product.quadrants.emotional_experience);
  assert.deepEqual(result.candidates[0].product.prohibitedClaims, product.prohibitedClaims);
});

test("accepts only Service Binding host mlm.internal", () => {
  const payload = { question: "葉綠素", products: [product] };
  assert.equal(matchRequest(new Request("https://example.com/api/internal/klink/product-match"), payload).httpStatus, 403);
  const internal = matchRequest(new Request("https://mlm.internal/api/internal/klink/product-match"), payload);
  assert.equal(internal.httpStatus, 200);
  assert.equal(internal.body.code, "MATCHED");
});