import { createRouter } from './router/router.js';
import { registerSystemRoutes } from './modules/system/system.routes.js';
import { legacyFetch } from './legacy/legacy-fetch.js';

const router = createRouter();
registerSystemRoutes(router);

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();

    try {
      const modularResponse = await router.handle(request, env, ctx);
      const response = modularResponse || await legacyFetch(request, env, ctx);
      response.headers.set('x-mlm-request-id', requestId);
      response.headers.set('x-mlm-router', modularResponse ? 'modular' : 'legacy');
      response.headers.set('server-timing', `app;dur=${Date.now() - startedAt}`);
      return response;
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({
        status: 'error',
        message: '系統暫時無法處理此請求',
        requestId,
      }, {
        status: 500,
        headers: { 'x-mlm-request-id': requestId },
      });
    }
  },
};
