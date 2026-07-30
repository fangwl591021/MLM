export function createApp({ router, legacyFetch, randomUUID = () => crypto.randomUUID(), now = () => Date.now(), logger = console }) {
  if (!router || typeof router.handle !== 'function') throw new TypeError('router.handle is required');
  if (typeof legacyFetch !== 'function') throw new TypeError('legacyFetch is required');

  return {
    async fetch(request, env, ctx) {
      const startedAt = now();
      const requestId = randomUUID();

      try {
        const modularResponse = await router.handle(request, env, ctx);
        const routedBy = modularResponse ? 'modular' : 'legacy';
        const response = modularResponse || await legacyFetch(request, env, ctx);

        if (!(response instanceof Response)) {
          throw new TypeError(`${routedBy} handler must return a Response`);
        }

        const result = new Response(response.body, response);
        result.headers.set('x-mlm-request-id', requestId);
        result.headers.set('x-mlm-router', routedBy);
        result.headers.set('server-timing', `app;dur=${Math.max(0, now() - startedAt)}`);
        return result;
      } catch (error) {
        logger.error(JSON.stringify({
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
}
