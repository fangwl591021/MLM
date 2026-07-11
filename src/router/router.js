export function createRouter() {
  const routes = [];

  function register(method, matcher, handler, meta = {}) {
    routes.push({ method: method.toUpperCase(), matcher, handler, meta });
  }

  return {
    get(pathOrMatcher, handler, meta) {
      const matcher = typeof pathOrMatcher === 'function'
        ? pathOrMatcher
        : (url) => url.pathname === pathOrMatcher;
      register('GET', matcher, handler, meta);
    },
    any(pathOrMatcher, handler, meta) {
      const matcher = typeof pathOrMatcher === 'function'
        ? pathOrMatcher
        : (url) => url.pathname === pathOrMatcher;
      register('*', matcher, handler, meta);
    },
    async handle(request, env, ctx) {
      const url = new URL(request.url);
      for (const route of routes) {
        if (route.method !== '*' && route.method !== request.method.toUpperCase()) continue;
        if (!route.matcher(url, request)) continue;
        return route.handler(request, env, ctx, { url, meta: route.meta });
      }
      return null;
    },
    list() {
      return routes.map(({ method, meta }) => ({ method, ...meta }));
    },
  };
}
