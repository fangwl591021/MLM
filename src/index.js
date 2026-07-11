import { createRouter } from './router/router.js';
import { registerSystemRoutes } from './modules/system/system.routes.js';
import { registerFrontendRoutes } from './modules/frontend/frontend.routes.js';
import { legacyFetch } from './legacy/legacy-fetch.js';
import { createApp } from './app.js';

const router = createRouter();
registerSystemRoutes(router);
registerFrontendRoutes(router);

export { createApp } from './app.js';
export { createRouter } from './router/router.js';
export { registerSystemRoutes } from './modules/system/system.routes.js';
export { registerFrontendRoutes } from './modules/frontend/frontend.routes.js';

export default createApp({ router, legacyFetch });
