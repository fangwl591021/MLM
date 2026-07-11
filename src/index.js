import { createRouter } from './router/router.js';
import { registerSystemRoutes } from './modules/system/system.routes.js';
import { registerFrontendRoutes } from './modules/frontend/frontend.routes.js';
import { registerConsoleSummaryShadowRoute } from './modules/console/console-summary.routes.js';
import { registerCalendarEventsShadowRoute } from './modules/calendar/calendar-events.routes.js';
import { registerKnowledgeReadShadowRoutes } from './modules/knowledge/knowledge-read.routes.js';
import { legacyFetch } from './legacy/legacy-fetch.js';
import { createApp } from './app.js';

const router = createRouter();
registerSystemRoutes(router);
registerFrontendRoutes(router);
registerConsoleSummaryShadowRoute(router, { legacyFetch });
registerCalendarEventsShadowRoute(router, { legacyFetch });
registerKnowledgeReadShadowRoutes(router, { legacyFetch });

export { createApp } from './app.js';
export { createRouter } from './router/router.js';
export { registerSystemRoutes } from './modules/system/system.routes.js';
export { registerFrontendRoutes } from './modules/frontend/frontend.routes.js';
export { registerConsoleSummaryShadowRoute } from './modules/console/console-summary.routes.js';
export { registerCalendarEventsShadowRoute } from './modules/calendar/calendar-events.routes.js';
export { registerKnowledgeReadShadowRoutes } from './modules/knowledge/knowledge-read.routes.js';

export default createApp({ router, legacyFetch });
