import legacyWorker from '../../worker/worker.js';

export async function legacyFetch(request, env, ctx) {
  return legacyWorker.fetch(request, env, ctx);
}
