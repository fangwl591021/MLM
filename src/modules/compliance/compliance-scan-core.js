function normalizeComplianceText(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase();
}

function enabledTerms(terms) {
  return (Array.isArray(terms) ? terms : [])
    .filter((term) => term && term.enabled !== 0 && term.enabled !== false)
    .map((term) => ({
      ...term,
      term: String(term.term || ""),
      normalizedTerm: String(term.normalized_term || normalizeComplianceText(term.term)),
      category: String(term.category || "internal_review"),
      riskLevel: String(term.risk_level || "orange").toLowerCase(),
      blockPublish: Number(term.block_publish || 0) === 1,
      reason: String(term.reason || term.internal_case_note || ""),
      ruleVersion: String(term.rule_version || "compliance-v1"),
    }))
    .filter((term) => term.normalizedTerm);
}

function scanComplianceFields(fields = {}, terms = []) {
  const matches = [];
  for (const fieldName of ["question", "answer", "keywords"]) {
    const rawValue = Array.isArray(fields[fieldName]) ? fields[fieldName].join(" ") : fields[fieldName];
    const normalizedValue = normalizeComplianceText(rawValue);
    if (!normalizedValue) continue;
    for (const term of enabledTerms(terms)) {
      if (!normalizedValue.includes(term.normalizedTerm)) continue;
      matches.push({
        field: fieldName,
        matchedTerm: term.term,
        matchedText: String(rawValue || ""),
        riskLevel: term.riskLevel,
        category: term.category,
        blockPublish: term.blockPublish,
        reason: term.reason,
        suggestedReplacement: String(term.suggested_replacement || ""),
        ruleVersion: term.ruleVersion,
      });
    }
  }
  return matches;
}

function resolveComplianceRiskLevel(matches = []) {
  if (matches.some((match) => match.riskLevel === "red")) return "red";
  if (matches.some((match) => match.riskLevel === "orange")) return "orange";
  return "green";
}

function buildComplianceScanResult(fields = {}, terms = [], options = {}) {
  const matches = scanComplianceFields(fields, terms);
  const riskLevel = resolveComplianceRiskLevel(matches);
  const versions = [...new Set(matches.map((match) => match.ruleVersion).filter(Boolean))];
  return { riskLevel, canPublish: !matches.some((match) => match.blockPublish), matches, ruleVersion: String(options.ruleVersion || versions[0] || "compliance-v1") };
}

function canPublishComplianceResult(result = {}) {
  return result.riskLevel !== "red" && result.canPublish !== false;
}

function hashComplianceContent(fields = {}) {
  const text = JSON.stringify({ question: String(fields.question || ""), answer: String(fields.answer || ""), keywords: Array.isArray(fields.keywords) ? fields.keywords.map(String) : [] });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

module.exports = { buildComplianceScanResult, canPublishComplianceResult, hashComplianceContent, normalizeComplianceText, resolveComplianceRiskLevel, scanComplianceFields };
