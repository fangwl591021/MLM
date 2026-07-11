function buildHealthChecks(env) {
  return {
    DB: Boolean(env.DB),
    GAS_URL: Boolean(env.GAS_URL),
    GAS_SHARED_SECRET: Boolean(env.GAS_SHARED_SECRET),
    LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
    LINE_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
    LINE_ADMIN_CHANNEL_SECRET: Boolean(env.LINE_ADMIN_CHANNEL_SECRET),
    LINE_ADMIN_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_ADMIN_CHANNEL_ACCESS_TOKEN),
    LINE_OA1_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_OA1_CHANNEL_ACCESS_TOKEN),
    LINE_OA2_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_OA2_CHANNEL_ACCESS_TOKEN),
    DASHBOARD_API_TOKEN: Boolean(env.DASHBOARD_API_TOKEN),
    ADMIN_TOKEN: Boolean(env.ADMIN_TOKEN),
    CHANNEL_CONFIG_JSON: Boolean(env.CHANNEL_CONFIG_JSON),
    POINT_API_KEY: Boolean(env.POINT_API_KEY),
    WETW_MEMBERS_URL: Boolean(env.WETW_MEMBERS_URL),
    WETW_POINTS_URL: Boolean(env.WETW_POINTS_URL),
    WETW_POINT_INSERT_URL: Boolean(env.WETW_POINT_INSERT_URL),
    WETW_SHOP_ID: Boolean(env.WETW_SHOP_ID),
    GATEWAY_FORWARD_TOKEN: Boolean(env.GATEWAY_FORWARD_TOKEN || env.MLM_FORWARD_TOKEN),
    OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
    CALENDAR_EVENTS_DB: Boolean(env.DB),
    DASHBOARD_LIFF_ID: Boolean(env.DASHBOARD_LIFF_ID),
    ALLOWED_ORIGIN: Boolean(env.ALLOWED_ORIGIN),
  };
}

export function buildLegacyCompatibleHealthPayload(env) {
  return {
    status: 'ok',
    service: 'line-oa-ai-suggestion-worker',
    checks: buildHealthChecks(env),
  };
}

function buildModularDiagnosticPayload(env) {
  return {
    ...buildLegacyCompatibleHealthPayload(env),
    modular: {
      service: 'mlm-modular-staging',
      mode: 'staging-only',
      timestamp: new Date().toISOString(),
    },
  };
}

function calendarRedirectResponse(request) {
  const url = new URL(request.url);
  return Response.redirect(`${url.origin}/console/calendar`, 302);
}

export function registerSystemRoutes(router) {
  router.get('/health-modular', async (_request, env) => {
    return Response.json(buildModularDiagnosticPayload(env));
  }, {
    id: 'SYSTEM-HEALTH-MODULAR-001',
    path: '/health-modular',
    risk: 'low',
    write: false,
  });

  router.get((url, _request, env) => {
    if (url.pathname !== '/health') return false;
    return env.MODULAR_HEALTH_ENABLED === 'true';
  }, async (_request, env) => {
    return Response.json(buildLegacyCompatibleHealthPayload(env));
  }, {
    id: 'SYSTEM-HEALTH-CANARY-001',
    path: '/health',
    risk: 'low',
    write: false,
    featureFlag: 'MODULAR_HEALTH_ENABLED',
  });

  router.get('/calendar-modular', async (request) => {
    return calendarRedirectResponse(request);
  }, {
    id: 'SYSTEM-CALENDAR-MODULAR-001',
    path: '/calendar-modular',
    risk: 'low',
    write: false,
  });

  router.get((url, _request, env) => {
    if (url.pathname !== '/calendar') return false;
    return env.MODULAR_CALENDAR_ENABLED === 'true';
  }, async (request) => {
    return calendarRedirectResponse(request);
  }, {
    id: 'SYSTEM-CALENDAR-CANARY-001',
    path: '/calendar',
    risk: 'low',
    write: false,
    featureFlag: 'MODULAR_CALENDAR_ENABLED',
  });
}
