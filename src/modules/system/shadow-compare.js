function compareShadowValues(legacy, candidate, path = "") {
  const mismatches = [];
  const push = (reason, left, right, childPath = path) => mismatches.push({ path: childPath || "$", legacy: left, candidate: right, reason });
  const leftNull = legacy === null || legacy === undefined;
  const rightNull = candidate === null || candidate === undefined;
  if (leftNull || rightNull) {
    if (legacy !== candidate) push("value_mismatch", legacy, candidate);
    return mismatches;
  }
  if (Array.isArray(legacy) || Array.isArray(candidate)) {
    if (!Array.isArray(legacy) || !Array.isArray(candidate)) {
      push("type_mismatch", legacy, candidate);
      return mismatches;
    }
    if (legacy.length !== candidate.length) push("array_length_mismatch", legacy.length, candidate.length, `${path}.length`);
    if (legacy.length === candidate.length && legacy.length > 1) {
      const ordered = legacy.map((item) => JSON.stringify(item));
      const candidateOrdered = candidate.map((item) => JSON.stringify(item));
      if (ordered.join("\u0000") !== candidateOrdered.join("\u0000") && ordered.slice().sort().join("\u0000") === candidateOrdered.slice().sort().join("\u0000")) {
        push("array_order_mismatch", legacy, candidate, path || "$");
      }
    }
    const length = Math.max(legacy.length, candidate.length);
    for (let index = 0; index < length; index += 1) {
      if (!(index in legacy)) push("missing_key", undefined, candidate[index], `${path}[${index}]`);
      else if (!(index in candidate)) push("missing_key", legacy[index], undefined, `${path}[${index}]`);
      else mismatches.push(...compareShadowValues(legacy[index], candidate[index], `${path}[${index}]`));
    }
    return mismatches;
  }
  if (typeof legacy !== typeof candidate) {
    push("type_mismatch", legacy, candidate);
    return mismatches;
  }
  if (typeof legacy === "object") {
    const keys = new Set([...Object.keys(legacy), ...Object.keys(candidate)]);
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in legacy)) push("extra_key", undefined, candidate[key], childPath);
      else if (!(key in candidate)) push("missing_key", legacy[key], undefined, childPath);
      else mismatches.push(...compareShadowValues(legacy[key], candidate[key], childPath));
    }
    return mismatches;
  }
  if (legacy !== candidate) push("value_mismatch", legacy, candidate);
  return mismatches;
}

function compareShadowResults(legacy, candidate) {
  const mismatches = compareShadowValues(legacy, candidate);
  return { equal: mismatches.length === 0, mismatches };
}

module.exports = { compareShadowResults, compareShadowValues };
