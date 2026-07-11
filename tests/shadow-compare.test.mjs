import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResponses, runShadowRead } from '../src/shadow/shadow-compare.js';

test('identical JSON responses compare equal regardless of key order', async () => {
  const legacy = Response.json({ status: 'ok', data: { b: 2, a: 1 } }, { headers: { 'x-mlm-router': 'legacy' } });
  const candidate = Response.json({ data: { a: 1, b: 2 }, status: 'ok' }, { headers: { 'x-mlm-router': 'modular' } });
  const result = await compareResponses(legacy, candidate);
  assert.equal(result.equal, true);
  assert.deepEqual(result.differences, []);
});

test('volatile body paths can be ignored', async () => {
  const legacy = Response.json({ status: 'ok', generatedAt: 'old', data: [1] });
  const candidate = Response.json({ status: 'ok', generatedAt: 'new', data: [1] });
  const result = await compareResponses(legacy, candidate, { ignoredBodyPaths: ['generatedAt'] });
  assert.equal(result.equal, true);
});

test('status, headers and body differences are reported', async () => {
  const legacy = Response.json({ status: 'ok' }, { status: 200, headers: { 'x-contract': 'legacy' } });
  const candidate = Response.json({ status: 'changed' }, { status: 201, headers: { 'x-contract': 'candidate' } });
  const result = await compareResponses(legacy, candidate);
  assert.equal(result.equal, false);
  assert.deepEqual(result.differences.map((item) => item.field), ['status', 'headers', 'body']);
});

test('shadow read always returns the legacy response', async () => {
  const logs = [];
  const result = await runShadowRead({
    legacy: async () => Response.json({ source: 'legacy' }, { status: 207 }),
    candidate: async () => Response.json({ source: 'candidate' }),
    logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
  });
  assert.equal(result.response.status, 207);
  assert.deepEqual(await result.response.json(), { source: 'legacy' });
  assert.equal(result.comparison.equal, false);
  assert.equal(logs.length, 1);
});

test('candidate failure is logged without affecting the legacy response', async () => {
  const logs = [];
  const result = await runShadowRead({
    legacy: async () => Response.json({ source: 'legacy' }),
    candidate: async () => { throw new Error('candidate failed'); },
    logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
  });
  assert.deepEqual(await result.response.json(), { source: 'legacy' });
  assert.equal(result.comparison.candidateError, true);
  assert.match(logs[0], /candidate failed/);
});
