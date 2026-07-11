function buildHealthPayload(env, mode) {
  return {
    status: 'ok',
    service: 'mlm-modular-staging',
    mode,
    checks: {
      DB: Boolean(env.DB),
      AI_WEAR_BUCKET: Boolean(env.AI_WEAR_BUCKET),
      GAS_URL: Boolean(env.GAS_URL),
      LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
      OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
    },
    timestamp: new Date().toISOString(),
  };
}

export function registerSystemRoutes(router) {
  router.get('/health-modular', async (_request, env) => {
    return Response.json(buildHealthPayload(env, 'staging-only'));
  }, {
    id: 'SYSTEM-HEALTH-MODULAR-001',
    path: '/health-modular',
    risk: 'low',
    write: false,
  });

  // Canary takeover for the real /health path. It is intentionally disabled
  // unless MODULAR_HEALTH_ENABLED is the literal string "true".
  router.get((url, _request, env) => {
    if (url.pathname !== '/health') return false;
    return env.MODULAR_HEALTH_ENABLED === 'true';
  }, async (_request, env) => {
    return Response.json(buildHealthPayload(env, 'feature-flag'));
  }, {
    id: 'SYSTEM-HEALTH-CANARY-001',
    path: '/health',
    risk: 'low',
    write: false,
    featureFlag: 'MODULAR_HEALTH_ENABLED',
  });

  router.get('/calendar-modular', async (request) => {
    const url = new URL(request.url);
    return Response.redirect(`${url.origin}/console/calendar`, 302);
  }, {
    id: 'SYSTEM-CALENDAR-REDIRECT-001',
    path: '/calendar-modular',
    risk: 'low',
    write: false,
  });
}
