export function registerSystemRoutes(router) {
  router.get('/health-modular', async (_request, env) => {
    const checks = {
      DB: Boolean(env.DB),
      AI_WEAR_BUCKET: Boolean(env.AI_WEAR_BUCKET),
      GAS_URL: Boolean(env.GAS_URL),
      LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
      OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
    };

    return Response.json({
      status: 'ok',
      service: 'mlm-modular-staging',
      mode: 'staging-only',
      checks,
      timestamp: new Date().toISOString(),
    });
  }, {
    id: 'SYSTEM-HEALTH-MODULAR-001',
    path: '/health-modular',
    risk: 'low',
    write: false,
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
