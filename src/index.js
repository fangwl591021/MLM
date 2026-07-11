import { createRouter } from './router/router.js';
import { registerSystemRoutes } from './modules/system/system.routes.js';
import { legacyFetch } from './legacy/legacy-fetch.js';
import { createApp } from './app.js';

const router = createRouter();
registerSystemRoutes(router);

export { createApp } from './app.js';
export { createRouter } from './router/router.js';
export { registerSystemRoutes } from './modules/system/system.routes.js';

export default createApp({ router, legacyFetch });
