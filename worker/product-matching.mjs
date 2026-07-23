const QUADRANTS = Object.freeze({
  rational_fast: "理性快速",
  rational_careful: "理性謹慎",
  emotional_experience: "感性體驗",
  emotional_relationship: "感性關係",
});

const MEDICAL_TERMS = ["醫療", "疾病", "症狀", "治療", "療效", "診斷", "人體機能改善", "改善血糖", "降血壓", "抗癌", "治癒", "消炎"];

function text(value) { return String(value === undefined || value === null ? "" : value).trim(); }
function list(value) { return (Array.isArray(value) ? value : []).map(text).filter(Boolean); }
function normalize(value) { return text(value).normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase(); }
function normalizeQuadrant(value) { return Object.prototype.hasOwnProperty.call(QUADRANTS, value) ? value : "rational_careful"; }

function normalizeProduct(input = {}) {
  const quadrants = input.quadrants && typeof input.quadrants === "object" ? input.quadrants : {};
  return {
    name: text(input.name || input.productName),
    series: text(input.series),
    publicFacts: list(input.publicFacts || input.public_facts),
    specs: list(input.specs || input.specifications),
    usage: list(input.usage || input.usageInstructions),
    safetyTags: list(input.safetyTags || input.safety_tags),
    prohibitedClaims: list(input.prohibitedClaims || input.prohibited_claims),
    source: text(input.source),
    reviewStatus: text(input.reviewStatus || input.review_status).toLowerCase(),
    quadrants: {
      rational_fast: text(quadrants.rational_fast),
      rational_careful: text(quadrants.rational_careful),
      emotional_experience: text(quadrants.emotional_experience),
      emotional_relationship: text(quadrants.emotional_relationship),
    },
  };
}

function isApproved(product) { return ["approved", "reviewed", "published", "審核通過", "已審核"].includes(product.reviewStatus); }
function detectMedicalQuestion(question) {
  const value = normalize(question);
  const matches = MEDICAL_TERMS.filter((term) => value.includes(normalize(term)));
  return { blocked: matches.length > 0, matches };
}
function tokens(value) { return normalize(value).split(/[，。！？、,\.\s]+/u).filter((item) => item.length >= 2); }
function scoreProduct(product, question) {
  const haystack = normalize([product.name, product.series, ...product.publicFacts, ...product.specs, ...product.usage, ...product.safetyTags].join(" "));
  return tokens(question).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function publicProduct(product, quadrant) {
  return { name: product.name, series: product.series, publicFacts: [...product.publicFacts], specs: [...product.specs], usage: [...product.usage], safetyTags: [...product.safetyTags], prohibitedClaims: [...product.prohibitedClaims], source: product.source, reviewStatus: product.reviewStatus, quadrant, message: product.quadrants[quadrant] };
}

function matchProducts(payload = {}) {
  const question = text(payload.question || payload.userQuestion || payload.text);
  const medical = detectMedicalQuestion(question);
  if (medical.blocked) return { ok: false, code: "MEDICAL_CLAIM_INTERCEPTED", stage: "before_product_matching", matches: medical.matches, candidates: [] };
  const quadrant = normalizeQuadrant(payload.persona && payload.persona.quadrant || payload.quadrant);
  const products = (Array.isArray(payload.products) ? payload.products : []).map(normalizeProduct).filter(isApproved);
  const candidates = products.map((product, index) => ({ product, score: scoreProduct(product, question), index })).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, Math.max(1, Math.min(Number(payload.limit) || 3, 10))).map(({ product, score }) => ({ score, product: publicProduct(product, quadrant) }));
  return { ok: true, code: candidates.length ? "MATCHED" : "NO_MATCH", quadrant, candidates };
}

function matchRequest(request, payload) {
  if (new URL(request.url).hostname.toLowerCase() !== "mlm.internal") return { httpStatus: 403, body: { ok: false, code: "INTERNAL_SERVICE_ONLY" } };
  return { httpStatus: 200, body: matchProducts(payload) };
}

export { QUADRANTS, detectMedicalQuestion, matchProducts, matchRequest, normalizeProduct };