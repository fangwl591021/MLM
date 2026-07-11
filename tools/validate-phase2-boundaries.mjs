import fs from 'node:fs';

const path = process.argv[2] || 'docs/phase2-module-boundaries.json';
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
const errors = [];
const allowedRisk = new Set(['low', 'medium', 'high', 'critical']);
const allowedActivation = new Set(['shadow-after-legacy-200', 'deferred']);

if (manifest.strategy !== 'strangler-with-shadow-read') errors.push('strategy must be strangler-with-shadow-read');
if (!Array.isArray(manifest.productionEntryFrozen) || !manifest.productionEntryFrozen.includes('worker/worker.js') || !manifest.productionEntryFrozen.includes('wrangler.toml')) {
  errors.push('productionEntryFrozen must include worker/worker.js and wrangler.toml');
}
if (!Array.isArray(manifest.batches) || manifest.batches.length === 0) errors.push('batches must be non-empty');

const ids = new Set();
for (const [index, batch] of (manifest.batches || []).entries()) {
  const prefix = `batches[${index}]`;
  for (const field of manifest.requiredFields || []) {
    if (!(field in batch)) errors.push(`${prefix}.${field} is required`);
  }
  if (!batch.id || ids.has(batch.id)) errors.push(`${prefix}.id must be unique and non-empty`);
  ids.add(batch.id);
  if (!allowedRisk.has(batch.risk)) errors.push(`${prefix}.risk is invalid`);
  if (!allowedActivation.has(batch.activation)) errors.push(`${prefix}.activation is invalid`);
  for (const field of ['reads', 'writes', 'externalApis', 'routes']) {
    if (!Array.isArray(batch[field])) errors.push(`${prefix}.${field} must be an array`);
  }
  if (typeof batch.schemaSideEffects !== 'boolean') errors.push(`${prefix}.schemaSideEffects must be boolean`);

  if (batch.activation === 'shadow-after-legacy-200') {
    if (batch.writes.length) errors.push(`${prefix} shadow batch must not contain writes`);
    if (batch.externalApis.length) errors.push(`${prefix} shadow batch must not call external APIs`);
    if (batch.schemaSideEffects) errors.push(`${prefix} shadow batch must not have schema side effects`);
    if (!batch.routes.every((route) => route.startsWith('GET '))) errors.push(`${prefix} shadow batch routes must be GET-only`);
  }

  if ((batch.writes.length || batch.externalApis.length || batch.schemaSideEffects) && batch.activation !== 'deferred') {
    errors.push(`${prefix} side-effecting batch must remain deferred`);
  }
}

if (errors.length) {
  console.error('Phase 2 boundary validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const ready = manifest.batches.filter((batch) => batch.activation === 'shadow-after-legacy-200').length;
const deferred = manifest.batches.filter((batch) => batch.activation === 'deferred').length;
console.log(`Phase 2 boundaries valid: ${ready} shadow-read batches, ${deferred} deferred batches.`);
