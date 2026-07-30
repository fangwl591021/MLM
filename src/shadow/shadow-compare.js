function cloneHeaders(headers) {
  const output = {};
  for (const [key, value] of headers.entries()) output[key.toLowerCase()] = value;
  return output;
}

function removeIgnoredPaths(value, ignoredPaths = []) {
  const clone = structuredClone(value);
  for (const path of ignoredPaths) {
    const parts = String(path).split('.').filter(Boolean);
    let current = clone;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!current || typeof current !== 'object') break;
      current = current[parts[index]];
    }
    if (current && typeof current === 'object') delete current[parts.at(-1)];
  }
  return clone;
}

async function responseSnapshot(response, ignoredPaths = []) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.clone().text();
  let body = text;
  if (contentType.includes('application/json')) {
    try { body = removeIgnoredPaths(JSON.parse(text), ignoredPaths); } catch (_) { body = text; }
  }
  return {
    status: response.status,
    headers: cloneHeaders(response.headers),
    body,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

export async function compareResponses(legacyResponse, candidateResponse, options = {}) {
  const ignoredHeaders = new Set((options.ignoredHeaders || ['date', 'server-timing', 'x-mlm-request-id', 'x-mlm-router']).map((item) => item.toLowerCase()));
  const legacy = await responseSnapshot(legacyResponse, options.ignoredBodyPaths || []);
  const candidate = await responseSnapshot(candidateResponse, options.ignoredBodyPaths || []);
  const headers = (snapshot) => Object.fromEntries(Object.entries(snapshot.headers).filter(([key]) => !ignoredHeaders.has(key)));
  const differences = [];
  if (legacy.status !== candidate.status) differences.push({ field: 'status', legacy: legacy.status, candidate: candidate.status });
  if (JSON.stringify(stableJson(headers(legacy))) !== JSON.stringify(stableJson(headers(candidate)))) differences.push({ field: 'headers', legacy: headers(legacy), candidate: headers(candidate) });
  if (JSON.stringify(stableJson(legacy.body)) !== JSON.stringify(stableJson(candidate.body))) differences.push({ field: 'body', legacy: legacy.body, candidate: candidate.body });
  return { equal: differences.length === 0, differences, legacy, candidate };
}

export async function runShadowRead({ legacy, candidate, compareOptions, logger = console }) {
  const [legacyResponse, candidateResult] = await Promise.all([
    legacy(),
    candidate().then((response) => ({ response })).catch((error) => ({ error })),
  ]);
  if (candidateResult.error) {
    logger.error(JSON.stringify({ level: 'error', type: 'shadow-read-candidate-error', message: candidateResult.error instanceof Error ? candidateResult.error.message : String(candidateResult.error) }));
    return { response: legacyResponse, comparison: { equal: false, candidateError: true } };
  }
  const comparison = await compareResponses(legacyResponse, candidateResult.response, compareOptions);
  logger.info?.(JSON.stringify({ level: comparison.equal ? 'info' : 'warn', type: 'shadow-read-comparison', equal: comparison.equal, differences: comparison.differences }));
  return { response: legacyResponse, comparison };
}

export async function runShadowReadAfterLegacy({ legacy, candidate, compareOptions, logger = console, allowedStatuses = [200] }) {
  const legacyResponse = await legacy();
  if (!allowedStatuses.includes(legacyResponse.status)) {
    logger.info?.(JSON.stringify({ level: 'info', type: 'shadow-read-skipped', legacyStatus: legacyResponse.status }));
    return { response: legacyResponse, comparison: { skipped: true, legacyStatus: legacyResponse.status } };
  }
  try {
    const candidateResponse = await candidate();
    const comparison = await compareResponses(legacyResponse, candidateResponse, compareOptions);
    logger.info?.(JSON.stringify({ level: comparison.equal ? 'info' : 'warn', type: 'shadow-read-comparison', equal: comparison.equal, differences: comparison.differences }));
    return { response: legacyResponse, comparison };
  } catch (error) {
    logger.error(JSON.stringify({ level: 'error', type: 'shadow-read-candidate-error', message: error instanceof Error ? error.message : String(error) }));
    return { response: legacyResponse, comparison: { equal: false, candidateError: true } };
  }
}
