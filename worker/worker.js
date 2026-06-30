/**
 * Cloudflare Worker: LINE OA dashboard API backed by D1.
 *
 * Core rule:
 * - Incoming LINE messages are never auto-replied.
 * - D1 is the primary realtime store.
 * - GAS is kept as an async backup / legacy bridge.
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const STATUS_PENDING = "\u5f85\u56de\u8986";
const STATUS_IMPORTANT = "\u5f85\u8655\u7406";
const STATUS_DONE = "\u8655\u7406\u5b8c\u7562";
const ADMIN_ROLE = "admin";
const USER_ROLE = "user";
const FLOOR_MAIN = "main";
const FLOOR_ADMIN = "admin";
const FLOOR_SMART = "smart";
const FLOOR_SUPER_ADMIN = "admin_all";
const FLOOR_IDS = new Set([FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART]);
const ACCESS_LIST_IDS = new Set([FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART, FLOOR_SUPER_ADMIN]);
const BUILTIN_ADMIN_UIDS = new Set(["U1b5150879fb688cae4b52e80a4b836c6"]);
const PASSWORD_LOGIN_USERS = {
  admin: { password: "@1234", name: "系統管理員", admin: true, floors: [FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART], home: "/console" },
  adservice: { password: "#1234", name: "行政客服", admin: false, floors: [FLOOR_ADMIN, FLOOR_SMART], home: "/dashboard?floor=admin" },
  pdservice: { password: "$1234", name: "產品客服", admin: false, floors: [FLOOR_MAIN, FLOOR_SMART], home: "/dashboard?floor=main" },
};
const POINT_OA1 = "oa1";
const POINT_OA2 = "oa2";
const POINT_CHANNELS = new Set([POINT_OA1, POINT_OA2]);
const POINT_CHANNEL_FLOORS = { [POINT_OA1]: FLOOR_SMART, [POINT_OA2]: FLOOR_ADMIN };
const PENDING_DISPLAY_NAME = "名稱待同步";
const D1_IN_QUERY_BATCH_SIZE = 50;
const POINT_SOURCE_META = {
  [POINT_OA1]: { label: "康立智能", shopId: 1086, loginUrl: "https://k-link.cc/index.php/line_login/1086/", canGrant: true },
  [POINT_OA2]: { label: "康立全球", shopId: 1584, loginUrl: "https://k-link.cc/index.php/line_login/1584/", canGrant: false, deductPriority: true },
};
const DEFAULT_WETW_POINT_INSERT_URL = "https://k-link.cc/index.php/wp-json/wetw-point/v1/insert-user-point";
const DEFAULT_WETW_POINT_QUERY_URL = "https://k-link.cc/index.php/wp-json/wetw-point/v1/query-user-point-list";
const FRONTEND_RAW_BASE = "https://raw.githubusercontent.com/fangwl591021/MLM/main";
const FRONTEND_BUILD_ID = "checkin-template-designer-20260627-1";
const REWARD_LIFF_ID = "2007221311-WjM9sZPz";
const REWARD_NFC_LIFF_ID = "2007221311-sqXIHCoK";
const POINTS_LIFF_ID = "2007221311-c9SEkcRL";
const DEFAULT_REWARD_POINTS = 1;
const REWARD_CAMPAIGN_POINTS = {
  smart_202605: 1,
  smart_202605_5: 10,
};
const REWARD_CALENDAR_AUTO = "calendar_auto";
const NFC_TEST_CAMPAIGN_PREFIX = "nfc_test_";
const DEFAULT_PUBLIC_BASE_URL = "https://mlm.fangwl591021.workers.dev";

const DEFAULT_REWARD_GEOFENCE_METERS = 50;
const DEFAULT_REWARD_CALENDAR_POINTS = 10;
const DEFAULT_REWARD_CHECKIN_EARLY_MINUTES = 60;
const AI_WEAR_SETTINGS_META_KEY = "ai_wear_settings";
const AI_WEAR_REFERENCE_ASSET_PREFIX = "/assets/ai-wear/reference/";
const AI_WEAR_SELFIE_ASSET_PREFIX = "/assets/ai-wear/selfie/";
const AI_WEAR_RESULT_ASSET_PREFIX = "/assets/ai-wear/result/";
const AI_WEAR_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const AI_WEAR_SELFIE_MAX_BYTES = 1200 * 1024;
const AI_WEAR_RESULT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
const AI_WEAR_D1_RESULT_BASE64_MAX_CHARS = 700000; // Legacy fallback only; new AI wear results are stored in R2.
const DEFAULT_AI_WEAR_LIFF_ID = "2007221311-ISFxRBY3";
const DEFAULT_AI_WEAR_PROMPT = `請以人物照片為主圖，完整保留人物本人臉部特徵、臉型、五官、膚色、表情、眼神、髮型、衣服、拍攝角度、背景與光線。

請以眼鏡參考圖作為眼鏡款式來源，只參考眼鏡本身，不參考圖片中的人物、背景或其他元素。

請將眼鏡參考圖中的眼鏡自然套用到人物照片的人物臉上，包含鏡框形狀、顏色、材質、粗細、鏡片大小、鏡片形狀、鼻墊、鏡腳、鏡片透明度與反光效果。

若人物照片原本已配戴眼鏡，請先自然移除原本眼鏡，再換上新的參考眼鏡。新眼鏡必須符合人物臉部角度、鼻樑位置、眼睛位置、耳朵方向與頭部透視，並加入自然陰影、反光與接觸感。

最終結果必須像人物本人實際戴上這副眼鏡的真實照片。除了眼鏡之外，不得修改人物長相、髮型、衣服、背景、姿勢、光線與照片風格。`;
const DEFAULT_AI_WEAR_SETTINGS = {
  title: "康立負離子眼鏡系列",
  publicPath: "/ai-wear",
  liffId: DEFAULT_AI_WEAR_LIFF_ID,
  prompt: DEFAULT_AI_WEAR_PROMPT,
  imageModel: "image2",
  imageApiUrl: "",
  aiweAjaxUrl: "",
  aiweNonce: "",
  aiwePostId: "",
  pointDeductionEnabled: false,
  pointCost: 0,
  pointChannelKey: POINT_OA1,
  pointType: "gift_money",
};

const CHECKIN_LOCATION_META = {
  taipei: { label: "台北", keywords: ["台北", "臺北", "南京東路五段108", "台北總公司"], lat: 25.0513143, lng: 121.5621864 },
  taichung: { label: "台中", keywords: ["台中", "臺中", "市政路500", "台中營業處"], lat: 24.159265, lng: 120.636989 },
  kaohsiung: { label: "高雄", keywords: ["高雄", "光華一路206", "高雄營業處"], lat: 22.6290869, lng: 120.3138688 },
  other: { label: "其他", keywords: [] },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse({
          status: "ok",
          service: "line-oa-ai-suggestion-worker",
          checks: {
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
          },
        }, 200, corsHeaders);
      }

      if ((url.pathname === "/login" || url.pathname === "/login.html") && request.method === "GET") {
        return passwordLoginHtml(corsHeaders);
      }

      if (url.pathname === "/api/login-config" && request.method === "GET") {
        const liffId = dashboardLiffId(env);
        return jsonResponse({
          status: "success",
          data: {
            liffId,
            lineLoginEnabled: Boolean(liffId),
            apiBase: url.origin,
          },
        }, 200, corsHeaders);
      }

      if ((url.pathname === "/console" || url.pathname === "/console.html" || url.pathname === "/console/calendar" || url.pathname === "/console/events" || url.pathname === "/console/ai-wear" || url.pathname === "/checkin-template" || url.pathname === "/checkin-template.html") && (request.method === "GET" || request.method === "HEAD")) {
        const session = await verifyConsoleSession(request, env);
        if (session.ok && !session.profile.admin) {
          const floors = Array.isArray(session.profile.floors) ? session.profile.floors : [];
          const floor = floors.includes(FLOOR_ADMIN) ? FLOOR_ADMIN : FLOOR_MAIN;
          return Response.redirect(`${url.origin}/dashboard?floor=${encodeURIComponent(floor)}`, 302);
        }
        return serveFrontendHtml("console.html", corsHeaders);
      }

      if ((url.pathname === "/dashboard" || url.pathname === "/index.html") && request.method === "GET") {
        return serveFrontendHtml("index.html", corsHeaders);
      }

      if ((url.pathname === "/ai-wear" || url.pathname === "/ai-wear.html") && (request.method === "GET" || request.method === "HEAD")) {
        return serveFrontendHtml("ai-wear.html", corsHeaders);
      }

      if (url.pathname === "/calendar" && (request.method === "GET" || request.method === "HEAD")) {
        return Response.redirect(`${url.origin}/console/calendar`, 302);
      }

      if ((url.pathname === "/knowledge-base" || url.pathname === "/knowledge-base.html") && request.method === "GET") {
        return serveFrontendHtml("knowledge-base.html", corsHeaders);
      }

      if (url.pathname.startsWith("/docs/") && request.method === "GET") {
        return serveFrontendAsset(url.pathname.replace(/^\/+/, ""), corsHeaders);
      }
      if (url.pathname.startsWith("/assets/checkin-template/") && request.method === "GET") {
        return serveCheckinTemplateImage(env, url.pathname, corsHeaders);
      }
      if (url.pathname.startsWith(AI_WEAR_REFERENCE_ASSET_PREFIX) && request.method === "GET") {
        return serveAiWearReferenceImage(env, url.pathname, corsHeaders);
      }
      if (url.pathname.startsWith(AI_WEAR_SELFIE_ASSET_PREFIX) && request.method === "GET") {
        return serveAiWearSelfieImage(env, url.pathname, corsHeaders);
      }
      if (url.pathname.startsWith(AI_WEAR_RESULT_ASSET_PREFIX) && request.method === "GET") {
        return serveAiWearResultImage(env, url.pathname, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-public" && request.method === "GET") {
        const data = await getAiWearPublicData(env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear/upload-selfie" && request.method === "POST") {
        const data = await uploadAiWearSelfie(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear/member-points" && request.method === "POST") {
        const body = await safeJson(request).catch(() => ({}));
        const data = await fetchAiWearMemberPoints(env, body);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear/preflight" && request.method === "POST") {
        const data = await preflightAiWearGenerate(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear/generate" && request.method === "POST") {
        const data = await generateAiWearImage(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        const session = await verifyConsoleSession(request, env);
        if (!session.ok) return jsonResponse({ status: "error", message: session.message || "尚未登入" }, 401, corsHeaders);
        const access = { allowed: true, admin: Boolean(session.profile.admin), floors: Array.isArray(session.profile.floors) ? session.profile.floors : [] };
        return jsonResponse({ status: "success", profile: session.profile, access }, 200, corsHeaders);
      }
      if (url.pathname === "/api/auth/password-login" && request.method === "POST") {
        const body = await safeJson(request);
        const result = verifyPasswordLogin(body);
        const response = jsonResponse({
          status: result.ok ? "success" : "error",
          profile: result.profile || null,
          access: result.access || { allowed: false, admin: false, floors: [] },
          home: result.home || "/login",
          message: result.ok ? "" : (result.message || "帳號或密碼錯誤"),
        }, result.ok ? 200 : 401, corsHeaders);
        if (result.ok) response.headers.append("Set-Cookie", await buildConsoleSessionCookie(env, result.profile, result.access));
        return response;
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const response = jsonResponse({ status: "success" }, 200, corsHeaders);
        response.headers.append("Set-Cookie", "kl_console_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
        return response;
      }

      if (url.pathname === "/api/auth/line-login" && request.method === "POST") {
        const body = await safeJson(request);
        const result = await verifyLineLoginIdToken(env, stringValue(body.idToken || body.id_token));
        const access = result.ok ? await resolveLineDashboardAccess(env, result.profile) : { allowed: false, admin: false, floors: [] };
        const response = jsonResponse({
          status: result.ok ? "success" : "error",
          profile: result.profile || null,
          access,
          message: result.ok ? "" : (result.message || "LINE Login 驗證失敗"),
        }, result.ok ? 200 : 401, corsHeaders);
        if (result.ok && access.admin) {
          response.headers.append("Set-Cookie", await buildConsoleSessionCookie(env, result.profile, access));
        }
        return response;
      }

      if (url.pathname === "/r/nfc" && (request.method === "GET" || request.method === "HEAD")) {
        if (url.searchParams.has("liff.state") || url.searchParams.has("campaign")) {
          return rewardCompactNfcLiffHtml(env, corsHeaders);
        }
        return redirectToRewardLiff(env, "calendar_auto", "nfc");
      }

      if ((url.pathname === "/r/checkin" || url.pathname === "/r/course-checkin") && (request.method === "GET" || request.method === "HEAD")) {
        return redirectToRewardLiff(env, "calendar_auto", "checkin", Object.fromEntries(url.searchParams.entries()));
      }

      if (url.pathname === "/r/nfc-test" && (request.method === "GET" || request.method === "HEAD")) {
        const token = normalizeNfcTestToken(url.searchParams.get("token"));
        if (!token) return new Response("NFC test token is required", { status: 400, headers: corsHeaders });
        return redirectToRewardLiff(env, `${NFC_TEST_CAMPAIGN_PREFIX}${token}`, "nfc");
      }

      if (url.pathname === "/r/nfc5" && (request.method === "GET" || request.method === "HEAD")) {
        return redirectToRewardLiff(env, "smart_202605_5", "nfc");
      }

      if ((url.pathname === "/nfc" || url.pathname === "/reward-nfc") && (request.method === "GET" || request.method === "HEAD")) {
        return rewardNfcInstructionsHtml(request, env, corsHeaders);
      }

      if (url.pathname === "/liff/nfc" && (request.method === "GET" || request.method === "HEAD")) {
        return rewardCompactNfcLiffHtml(env, corsHeaders);
      }

      if (url.pathname === "/liff/points" && (request.method === "GET" || request.method === "HEAD")) {
        return pointsTallLiffHtml(env, corsHeaders);
      }

      const floor = resolveFloor(request);
      const provider = getProvider(env, floor);

      const smartMonitorDataMode = url.pathname === "/api/data" && url.searchParams.get("smart") === "1";
      if (requiresFloorAccess(url.pathname) && !smartMonitorDataMode) {
        await assertFloorAccess(request, env, floor);
      }

      if (url.pathname === "/api/console/summary" && request.method === "GET") {
        await assertAccessManager(request, env);
        const data = await fetchConsoleSummary(env);
        return jsonResponse({ status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/calendar/import-image" && request.method === "POST") {
        await assertAccessManager(request, env);
        const result = await importCalendarImageToD1(env, request);
        return jsonResponse({ status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/calendar/events" && request.method === "GET") {
        await assertAccessManager(request, env);
        const events = await listCalendarEvents(env, url);
        return jsonResponse({ status: "success", events }, 200, corsHeaders);
      }

      if (url.pathname === "/api/calendar/events" && request.method === "POST") {
        await assertAccessManager(request, env);
        const body = await safeJson(request);
        const event = await saveCalendarEvent(env, body);
        return jsonResponse({ status: "success", event }, 200, corsHeaders);
      }

      if (url.pathname === "/api/calendar/events" && request.method === "DELETE") {
        await assertAccessManager(request, env);
        const deleted = await deleteCalendarEvent(env, url.searchParams.get("id"));
        return jsonResponse({ status: "success", deleted }, 200, corsHeaders);
      }
      if (url.pathname === "/api/reward/config" && request.method === "GET") {
        const campaign = normalizeCampaign(url.searchParams.get("campaign") || "smart_202605");
        return jsonResponse({
          success: true,
          status: "success",
          liffId: stringValue(env.REWARD_LIFF_ID) || REWARD_LIFF_ID,
          campaign,
          points: campaign === REWARD_CALENDAR_AUTO || isNfcTestCampaign(campaign) ? calendarDefaultPoints(env) : rewardPointsForCampaign(campaign),
          source: POINT_SOURCE_META[POINT_OA1].label,
          calendarMode: campaign === REWARD_CALENDAR_AUTO || isNfcTestCampaign(campaign),
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/reward/calendar-events" && request.method === "GET") {
        const events = await fetchRewardCalendarEvents(env);
        const now = Date.now();
        return jsonResponse({
          success: true,
          status: "success",
          events: events.map((event) => publicCalendarEvent(event, now, null, env)),
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/reward/claim" && request.method === "POST") {
        const body = await safeJson(request);
        const result = await claimQrReward(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/reward/client-log" && request.method === "POST") {
        const body = await safeJson(request).catch(() => ({}));
        const result = await recordRewardClientLog(env, request, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/points/member-ledger" && request.method === "POST") {
        const body = await safeJson(request).catch(() => ({}));
        const result = await fetchMemberPointLedger(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/data" && request.method === "GET") {
        const smartMonitorMode = url.searchParams.get("smart") === "1";
        await (smartMonitorMode ? assertDashboardAuth(request, env) : assertFloorAccess(request, env, floor));
        const dataFloor = smartMonitorMode ? FLOOR_SMART : floor;
        const searchQuery = stringValue(url.searchParams.get("q") || url.searchParams.get("search") || url.searchParams.get("query"));
        const data = await fetchDashboardData(env, dataFloor, { searchQuery });
        if (env.DB && provider.accessToken) {
          ctx.waitUntil(backfillProfiles(env, dataFloor, provider, 12, { force: false, staleMs: 6 * 60 * 60 * 1000 }));
        }
        return jsonResponse(data, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm" && request.method === "GET") {
        return crmAdminToolHtml(corsHeaders);
      }

      if (url.pathname === "/admin/crm/members" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const data = await listCrmMembers(env, url);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm/member-search" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const candidates = await searchCrmMemberCandidates(env, url);
        return jsonResponse({ success: true, status: "success", candidates }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm/sync-members" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const result = await syncCrmMembers(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm/sync-points" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const result = await syncCrmPoints(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/stats" && request.method === "GET") {
        const denied = await pointStatsPageDeniedResponse(request, env, url.origin, corsHeaders);
        if (denied) return denied;
        return pointStatsHtml(corsHeaders);
      }

      if (url.pathname === "/admin/points/stats-data" && request.method === "GET") {
        await assertPointStatsAdminAuth(request, env);
        const data = await listPointDailyStats(env, url);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/smart-monitor" && (request.method === "GET" || request.method === "HEAD")) {
        return serveFrontendHtml("index.html", corsHeaders, { smartMonitorDashboard: true });
      }

      if (url.pathname === "/admin/smart-monitor-data" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await listSmartMonitorData(env, url);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }
      if (url.pathname === "/admin/points/binding-codes" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const result = await createBindingCode(request, env);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/observations" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const observations = await listPointObservations(env, url);
        return jsonResponse({ success: true, status: "success", observations }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/member-links" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const links = await listPointMemberLinks(env, url);
        return jsonResponse({ success: true, status: "success", links }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/bind-line-user" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request);
        const result = await bindPointLineUser(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/balance" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const result = await listPointBalances(env, url);
        const balances = Array.isArray(result) ? result : result.balances;
        const resolved = Array.isArray(result) ? null : result.resolved;
        const alternatives = Array.isArray(result) ? [] : (result.alternatives || []);
        return jsonResponse({ success: true, status: "success", balances, resolved, alternatives }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/ledger" && request.method === "GET") {
        await assertPointAdminAuth(request, env);
        const ledger = await listPointLedger(env, url);
        return jsonResponse({ success: true, status: "success", ledger }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/backfill-auto-rewards" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const queryBody = Object.fromEntries(url.searchParams.entries());
        const result = await backfillMissingAutoRewards(env, { ...queryBody, ...body });
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/repair-daily-keyword-balances" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const queryBody = Object.fromEntries(url.searchParams.entries());
        const result = await repairDailyKeywordBalances(env, { ...queryBody, ...body });
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/repair-local-balances" && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const queryBody = Object.fromEntries(url.searchParams.entries());
        const result = await repairLocalGiftMoneyBalances(env, { ...queryBody, ...body });
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if ((url.pathname === "/admin/points/grant" || url.pathname === "/admin/points/deduct" || url.pathname === "/admin/points/redeem") && request.method === "POST") {
        await assertPointAdminAuth(request, env);
        const action = url.pathname.endsWith("/grant") ? "grant" : url.pathname.endsWith("/deduct") ? "deduct" : "redeem";
        const body = await safeJson(request);
        const result = await pointMutation(env, body, action);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      const internalGatewayMatch = url.pathname.match(/^\/internal\/line-webhook\/([^/]+)$/);
      if (internalGatewayMatch && request.method === "POST") {
        const channelKey = internalGatewayMatch[1];
        if (!POINT_CHANNELS.has(channelKey)) return jsonResponse({ success: false, status: "error", message: `Unknown LINE point channel: ${channelKey}` }, 404, corsHeaders);
        const result = await handleGatewayForwardedWebhook(request, env, ctx, channelKey, corsHeaders);
        return result;
      }

      if (url.pathname === "/api/migrate-gas-to-d1" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        if (!env.DB) return jsonResponse({ status: "error", message: "DB is not configured" }, 500, corsHeaders);
        const result = await migrateGasToD1(env, floor);
        return jsonResponse(result, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/threads" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await fetchDashboardData(env, floor);
        return jsonResponse({ success: true, status: "success", data: data.data.threads || [] }, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/thread" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const id = stringValue(url.searchParams.get("id"));
        if (!id) return jsonResponse({ success: false, status: "error", message: "id is required" }, 400, corsHeaders);
        const thread = await fetchThread(env, floor, id);
        if (!thread) return jsonResponse({ success: false, status: "error", message: "thread not found" }, 404, corsHeaders);
        return jsonResponse({ success: true, status: "success", data: thread }, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/thread" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId || body.id).replace(/^user:/, "");
        if (!userId) return jsonResponse({ success: false, status: "error", message: "userId or id is required" }, 400, corsHeaders);
        const meta = await updateConversationMeta(env, {
          floor,
          userId,
          userName: stringValue(body.name || body.userName),
          pictureUrl: stringValue(body.pictureUrl),
          status: body.status === undefined ? undefined : stringValue(body.status),
          tags: body.tags,
          note: body.note === undefined ? undefined : String(body.note || ""),
        });
        ctx.waitUntil(backupGas(env, { type: "UPDATE_CONVERSATION_META", data: metaToGasPayload(meta) }));
        return jsonResponse({ success: true, status: "success", data: meta }, 200, corsHeaders);
      }

      if (url.pathname === "/api/profile-debug" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const userId = stringValue(url.searchParams.get("userId") || url.searchParams.get("uid"));
        if (!userId) return jsonResponse({ status: "error", message: "userId is required" }, 400, corsHeaders);
        const channelKey = stringValue(url.searchParams.get("channel") || url.searchParams.get("channel_key"));
        const pointConfig = POINT_CHANNELS.has(channelKey) ? getPointChannelConfig(env, channelKey) : null;
        const profileFloor = pointConfig ? pointConfig.floor : floor;
        const profileProvider = pointConfig
          ? { floor: pointConfig.floor, id: channelKey, label: pointConfig.label, channelSecret: pointConfig.channelSecret, accessToken: pointConfig.accessToken }
          : provider;
        const stored = await getProfile(env, profileFloor, userId);
        const direct = await fetchLineProfileWithDetail(profileProvider, userId);
        return jsonResponse({
          status: "success",
          userId,
          stored,
          placeholderDetected: isPlaceholderName(stored && stored.display_name, userId),
          missingPicture: !(stored && stored.picture_url),
          profileChecks: { direct },
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-bot-info" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const channelKey = stringValue(url.searchParams.get("channel") || url.searchParams.get("channel_key"));
        const pointConfig = POINT_CHANNELS.has(channelKey) ? getPointChannelConfig(env, channelKey) : null;
        const botProvider = pointConfig
          ? { floor: pointConfig.floor, id: channelKey, label: pointConfig.label, channelSecret: pointConfig.channelSecret, accessToken: pointConfig.accessToken }
          : provider;
        const info = await fetchLineBotInfo(botProvider);
        return jsonResponse({ status: info.ok ? "success" : "error", data: info }, info.ok ? 200 : 502, corsHeaders);
      }

      if (url.pathname === "/api/backfill-profiles" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const limit = clampNumber(body.limit || 100, 1, 300);
        const channelKey = stringValue(body.channel || body.channel_key || url.searchParams.get("channel") || url.searchParams.get("channel_key"));
        const pointConfig = POINT_CHANNELS.has(channelKey) ? getPointChannelConfig(env, channelKey) : null;
        const forceBackfill = body.force !== false && body.force !== "false" && body.force !== 0 && body.force !== "0";
        const staleMs = Number(body.staleMs || body.stale_ms || 86400000);
        const results = pointConfig
          ? await backfillPointChannelProfiles(env, channelKey, { floor: pointConfig.floor, id: channelKey, label: pointConfig.label, channelSecret: pointConfig.channelSecret, accessToken: pointConfig.channelAccessToken || pointConfig.accessToken }, limit, { force: forceBackfill, staleMs })
          : await backfillProfiles(env, floor, provider, limit, { force: forceBackfill, staleMs });
        return jsonResponse({ status: "success", scanned: results.length, results }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        if (!body.knowledge) return jsonResponse({ status: "error", message: "knowledge is required" }, 400, corsHeaders);
        const result = await importKnowledge(env, floor, body.knowledge, stringValue(body.fileName || "dashboard-upload.json"));
        ctx.waitUntil(backupGas(env, {
          type: "IMPORT_KNOWLEDGE_BASE",
          data: { knowledge: body.knowledge, fileName: body.fileName || "dashboard-upload.json", source: "dashboard-upload" },
        }));
        return jsonResponse(result, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge/manifest" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await getKnowledgeManifest(env, floor);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge/file" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const path = stringValue(url.searchParams.get("path"));
        if (!path) return jsonResponse({ success: false, status: "error", message: "path is required" }, 400, corsHeaders);
        const data = await getKnowledgeFile(env, floor, path);
        if (!data) return jsonResponse({ success: false, status: "error", message: "KNOWLEDGE_FILE_NOT_FOUND" }, 404, corsHeaders);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge/file" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const path = stringValue(url.searchParams.get("path"));
        if (!path) return jsonResponse({ success: false, status: "error", message: "path is required" }, 400, corsHeaders);
        const body = await safeJson(request);
        const result = await upsertKnowledgeFile(env, floor, body, path);
        ctx.waitUntil(backupGas(env, {
          type: "IMPORT_KNOWLEDGE_BASE",
          data: { knowledge: body, fileName: path, source: "knowledge-file" },
        }));
        return jsonResponse({ success: true, status: "success", data: result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge/file" && request.method === "DELETE") {
        await assertDashboardAuth(request, env);
        const path = stringValue(url.searchParams.get("path"));
        if (!path) return jsonResponse({ success: false, status: "error", message: "path is required" }, 400, corsHeaders);
        const result = await deleteKnowledgeFile(env, floor, path);
        return jsonResponse({ success: true, status: "success", data: result }, 200, corsHeaders);
      }
      if (url.pathname === "/api/floor-whitelist" && request.method === "GET") {
        await assertAccessManager(request, env);
        const data = await fetchFloorWhitelist(env);
        return jsonResponse({ status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/floor-whitelist" && request.method === "POST") {
        await assertAccessManager(request, env);
        const body = await safeJson(request);
        const requestedFloor = stringValue(body.floor || body.floor_id);
        const targetFloor = ACCESS_LIST_IDS.has(requestedFloor) ? requestedFloor : floor;
        const result = await saveFloorWhitelist(env, targetFloor, body.entries || parseWhitelistLines(body.lines || body.text || ""));
        return jsonResponse({ status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/api/reply-learning" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const limit = clampNumber(url.searchParams.get("limit") || 50, 1, 200);
        const learning = await fetchReplyLearning(env, floor, limit);
        return jsonResponse({ status: "success", ...learning }, 200, corsHeaders);
      }

      if (url.pathname === "/api/reply-learning/rebuild" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const limit = clampNumber(body.limit || 500, 1, 2000);
        const result = await rebuildReplyLearning(env, floor, limit);
        return jsonResponse({ status: "success", ...result }, 200, corsHeaders);
      }


      if (url.pathname === "/api/ai-wear-settings" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await getAiWearSettings(env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-settings" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const data = await saveAiWearSettings(env, body);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-diagnose" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await diagnoseAiWearOpenAi(env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }
      if (url.pathname === "/api/ai-wear-gallery" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await listAiWearReferences(env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-gallery" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const data = await uploadAiWearReference(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-gallery" && request.method === "DELETE") {
        await assertDashboardAuth(request, env);
        const data = await deleteAiWearReference(env, url.searchParams.get("id"));
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-results" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await listAiWearResults(env, url.searchParams);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/ai-wear-results" && request.method === "POST") {
        const data = await saveAiWearResult(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/checkin-template" && request.method === "GET") {
        await assertDashboardAuth(request, env);
        const data = await getCheckinTemplate(env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/checkin-template" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const data = await saveCheckinTemplate(env, body);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }
      if (url.pathname === "/api/checkin-template/upload-image" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const data = await uploadCheckinTemplateImage(request, env);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/api/conversation-meta" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId);
        if (!userId) return jsonResponse({ status: "error", message: "userId is required" }, 400, corsHeaders);
        const meta = await updateConversationMeta(env, {
          floor,
          userId,
          userName: stringValue(body.userName),
          pictureUrl: stringValue(body.pictureUrl),
          status: body.status === undefined ? undefined : stringValue(body.status),
          tags: body.tags,
          note: body.note === undefined ? undefined : String(body.note || ""),
        });
        ctx.waitUntil(backupGas(env, { type: "UPDATE_CONVERSATION_META", data: metaToGasPayload(meta) }));
        return jsonResponse({ status: "success", meta }, 200, corsHeaders);
      }

      if (url.pathname === "/api/send" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId);
        const text = stringValue(body.text);
        if (!userId || !text) return jsonResponse({ status: "error", message: "userId and text are required" }, 400, corsHeaders);

        const lineResult = await pushLineMessage(provider, userId, text);
        if (!lineResult.ok) {
          return jsonResponse({ status: "error", message: "LINE push failed", detail: lineResult.detail }, lineResult.status || 502, corsHeaders);
        }

        const now = Date.now();
        await saveAdminMessage(env, { floor, userId, userName: stringValue(body.userName), text, createdAt: now, status: STATUS_DONE });
        ctx.waitUntil(backupGas(env, {
          type: "SAVE_ADMIN_REPLY",
          data: { userId, userName: stringValue(body.userName), text, time: now, category: "\u4eba\u5de5\u56de\u8986", status: STATUS_DONE },
        }));
        return jsonResponse({ status: "success" }, 200, corsHeaders);
      }

      if (url.pathname === "/api/log-reply" && request.method === "POST") {
        await assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId);
        const lineMessages = Array.isArray(body.lineMessages) ? body.lineMessages : (Array.isArray(body.messages) ? body.messages : null);
        const text = stringValue(body.text) || (lineMessages ? lineMessagesDisplayText(lineMessages) : "");
        if (!userId || !text) return jsonResponse({ status: "error", message: "userId and text or lineMessages are required" }, 400, corsHeaders);

        const now = Date.now();
        await saveAdminMessage(env, { floor, userId, userName: stringValue(body.userName), text, messageType: stringValue(body.messageType || (lineMessages ? "line" : "text")), lineMessages, rawJson: body.rawJson || (lineMessages ? { direction: "outgoing", source: "log-reply", lineMessages } : {}), createdAt: now, status: STATUS_DONE, category: "\u88dc\u8a18\u4e0d\u63a8\u9001" });
        ctx.waitUntil(backupGas(env, {
          type: "SAVE_ADMIN_REPLY",
          data: { userId, userName: stringValue(body.userName), text, time: now, category: "\u88dc\u8a18\u4e0d\u63a8\u9001", status: STATUS_DONE },
        }));
        return jsonResponse({ status: "success" }, 200, corsHeaders);
      }

      const pointWebhookMatch = url.pathname.match(/^\/line-webhook\/([^/]+)$/);
      if (pointWebhookMatch && request.method === "POST") {
        const channelKey = pointWebhookMatch[1];
        if (!POINT_CHANNELS.has(channelKey)) return jsonResponse({ success: false, status: "error", message: `Unknown LINE point channel: ${channelKey}` }, 404, corsHeaders);
        const result = await handlePointWebhook(request, env, ctx, channelKey, corsHeaders);
        return result;
      }

      if ((url.pathname === "/" || url.pathname === "/webhook/line" || url.pathname === "/webhook/line/main" || url.pathname === "/webhook/line/admin") && request.method === "POST") {
        const webhookFloor = url.pathname.endsWith("/admin") ? FLOOR_ADMIN : FLOOR_MAIN;
        const webhookProvider = getProvider(env, webhookFloor);
        const rawBody = await request.text();
        const signature = request.headers.get("x-line-signature") || "";
        const validLine = await verifyLineSignature(rawBody, signature, webhookProvider.channelSecret);
        if (!validLine) return new Response("Invalid LINE signature", { status: 401, headers: corsHeaders });

        const payload = JSON.parse(rawBody);
        if (Array.isArray(payload.events) && payload.events.length > 0) {
          ctx.waitUntil(processLineWebhook(env, webhookFloor, webhookProvider, payload));
        }
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      return jsonResponse({
        status: "active",
        service: "line-oa-ai-suggestion-worker",
        routes: ["/console", "/console/calendar", "/console/events", "/console/ai-wear", "/ai-wear", "/checkin-template", "/calendar", "/dashboard?floor=main", "/dashboard?floor=admin", "/health", "/api/console/summary", "/api/calendar/import-image", "/api/calendar/events", "/api/data?floor=main", "/api/data?floor=admin", "/admin/crm", "/admin/crm/members", "/admin/crm/sync-members", "/admin/crm/sync-points", "/admin/points/balance", "/admin/points/ledger", "/admin/points/stats", "/admin/points/stats-data", "/admin/smart-monitor", "/admin/smart-monitor-data", "/admin/points/backfill-auto-rewards", "/admin/points/repair-daily-keyword-balances", "/admin/points/grant", "/admin/points/deduct", "/admin/points/redeem", "/internal/line-webhook/oa1", "/internal/line-webhook/oa2", "/line-webhook/oa1", "/line-webhook/oa2", "/api/migrate-gas-to-d1", "/api/line-oa/threads", "/api/line-oa/thread", "/api/profile-debug", "/api/backfill-profiles", "/api/knowledge", "/api/knowledge/manifest", "/api/knowledge/file", "/api/floor-whitelist", "/api/reply-learning", "/api/reply-learning/rebuild", "/api/checkin-template", "/api/conversation-meta", "/api/send", "/api/log-reply", "/webhook/line/main", "/webhook/line/admin"],
      }, 200, corsHeaders);
    } catch (err) {
      const payload = { status: "error", message: err && err.message ? err.message : String(err) };
      if (err && err.code) payload.code = err.code;
      if (err && err.detail) payload.detail = err.detail;
      return jsonResponse(payload, err.status || 500, corsHeaders);
    }
  },
};

async function serveFrontendHtml(fileName, corsHeaders, options = {}) {
  const htmlText = await fetchFrontendHtmlSource(fileName);
  if (htmlText === null) {
    return new Response(`Frontend source unavailable: ${fileName}`, {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let html = rewriteFrontendLinks(htmlText)
    .replaceAll("point_type=all&limit=200", "point_type=gift_money&limit=200")
    .replaceAll("<label>K點類型<select id=\"pointType\"><option value=\"gift_money\">購物金</option><option value=\"system_point\">原始點數</option></select></label>", "<input id=\"pointType\" type=\"hidden\" value=\"gift_money\" />")
    .replaceAll("可用K點合計", "K點餘額")
    .replaceAll("扣除後可用K點", "K點餘額");
  if (options && options.smartMonitorDashboard) html = rewriteSmartMonitorDashboardHtml(html);
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

async function fetchFrontendHtmlSource(fileName) {
  if (fileName === "console.html") {
    const apiResponse = await fetch(`https://api.github.com/repos/fangwl591021/MLM/contents/${fileName}?ref=main`, {
      headers: { "User-Agent": "mlm-worker", "Accept": "application/vnd.github+json" },
      cf: { cacheEverything: false, cacheTtl: 0 },
    });
    if (apiResponse.ok) {
      const payload = await apiResponse.json().catch(() => null);
      const content = stringValue(payload && payload.content).replace(/\s+/g, "");
      if (content) return new TextDecoder().decode(base64ToUint8Array(content));
    }
  }
  const response = await fetch(`${FRONTEND_RAW_BASE}/${fileName}?v=${FRONTEND_BUILD_ID}-${Date.now()}`, {
    headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
    cf: { cacheEverything: false, cacheTtl: 0 },
  });
  if (!response.ok) return null;
  return response.text();
}
async function serveFrontendAsset(pathname, corsHeaders) {
  const safePath = String(pathname || "").replace(/^\/+/, "");
  if (!safePath || safePath.includes("..")) {
    return new Response("Invalid asset path", {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const response = await fetch(`${FRONTEND_RAW_BASE}/${safePath}`, {
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!response.ok) {
    return new Response("Asset not found", {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const contentType = safePath.endsWith(".md")
    ? "text/plain; charset=utf-8"
    : (response.headers.get("Content-Type") || "application/octet-stream");
  return new Response(response.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
    },
  });
}

function rewriteSmartMonitorDashboardHtml(html) {
  const initialFloorBlock = `function initialFloor() {
      const requested = new URLSearchParams(window.location.search).get("floor");
      if (requested && FLOORS[requested]) {
        localStorage.setItem("line_ai_floor", requested);
        return requested;
      }
      return localStorage.getItem("line_ai_floor") || "main";
    }`;
  const smartInitialFloorBlock = `function initialFloor() {
      localStorage.setItem("line_ai_floor", "smart");
      return "smart";
    }`;
  return String(html || "")
    .replaceAll("<title>KLINK 客服系統</title>", "<title>康立智能監控</title>")
    .replaceAll("apiUrlForFloor(\"/api/data\", floorAtStart)", "apiUrlForFloor(\"/api/data\", 'smart') + '&smart=1'")
    .replaceAll(initialFloorBlock, smartInitialFloorBlock)
    .replaceAll('const FLOORS = { main: "產品客服", admin: "行政客服" };', 'const FLOORS = { smart: "康立智能" };')
    .replaceAll('const FLOORS = { main: "\u7522\u54c1\u5ba2\u670d", admin: "\u884c\u653f\u5ba2\u670d", smart: "\u5eb7\u7acb\u667a\u80fd" };', 'const FLOORS = { smart: "\u5eb7\u7acb\u667a\u80fd" };')
    .replaceAll('.smartMonitorBtn:hover{background:#effcf4}', '.smartMonitorBtn.active{background:#e7f8ef;color:#067a35;box-shadow:inset 0 0 0 1px #067a35}.smartMonitorBtn:hover{background:#effcf4}')
    .replaceAll('class="smartMonitorBtn" href="/admin/smart-monitor"', 'class="smartMonitorBtn active" href="/admin/smart-monitor"')
    .replaceAll('<a class="smartMonitorBtn active" href="/admin/smart-monitor">康立智能監控</a>', '')
    .replaceAll('<button type="button" class="floorTab active" data-floor="main">\u7522\u54c1\u5ba2\u670d</button><button type="button" class="floorTab" data-floor="admin">\u884c\u653f\u5ba2\u670d</button>', '<a class="floorTab" href="/dashboard?floor=main">\u7522\u54c1\u5ba2\u670d</a><a class="floorTab" href="/dashboard?floor=admin">\u884c\u653f\u5ba2\u670d</a><a class="smartMonitorBtn active" href="/admin/smart-monitor">\u5eb7\u7acb\u667a\u80fd\u76e3\u63a7</a>');
}
function rewriteFrontendLinks(html) {
  let rewritten = String(html || "")
    .replace(/<button type="button" class="floorTab(?: active)?" data-floor="smart">[^<]*<\/button>/g, "")
    .replaceAll('href="console.html"', 'href="/console"')
    .replaceAll("href='console.html'", "href='/console'")
    .replaceAll('href="index.html?floor=main"', 'href="/dashboard?floor=main"')
    .replaceAll("href='index.html?floor=main'", "href='/dashboard?floor=main'")
    .replaceAll('href="index.html?floor=admin"', 'href="/dashboard?floor=admin"')
    .replaceAll("href='index.html?floor=admin'", "href='/dashboard?floor=admin'")
    .replaceAll('href="index.html"', 'href="/dashboard"')
    .replaceAll("href='index.html'", "href='/dashboard'")
    .replaceAll('location.href = "console.html"', 'location.href = "/console"')
    .replaceAll("location.href = 'console.html'", "location.href = '/console'")
    .replaceAll('location.href = "index.html?floor=main"', 'location.href = "/dashboard?floor=main"')
    .replaceAll("location.href = 'index.html?floor=main'", "location.href = '/dashboard?floor=main'")
    .replaceAll('location.href = "index.html?floor=admin"', 'location.href = "/dashboard?floor=admin"')
    .replaceAll("location.href = 'index.html?floor=admin'", "location.href = '/dashboard?floor=admin'")
    .replaceAll('href="knowledge-base.html"', 'href="/knowledge-base"')
    .replaceAll("href='knowledge-base.html'", "href='/knowledge-base'");
  if (!rewritten.includes('.smartMonitorBtn{')) {
    rewritten = rewritten.replaceAll('.motherSyncBtn{margin-left:auto;', '.smartMonitorBtn{height:36px;border:1px solid #b6ecc8;border-radius:999px;background:#fff;color:#067a35;padding:0 14px;font-weight:760;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.smartMonitorBtn:hover{background:#effcf4}.motherSyncBtn{margin-left:auto;');
  }
  if (!rewritten.includes('href="/admin/smart-monitor"')) {
    rewritten = rewritten.replaceAll('<button type="button" id="syncMotherButton" class="motherSyncBtn">同步母站</button>', '<a class="smartMonitorBtn" href="/admin/smart-monitor">康立智能監控</a><button type="button" id="syncMotherButton" class="motherSyncBtn">同步母站</button>');
  }
  return rewritten;
}

function resolveFloor(request) {
  const url = new URL(request.url);
  const raw = stringValue(url.searchParams.get("floor") || request.headers.get("x-floor-id") || FLOOR_MAIN).toLowerCase();
  return FLOOR_IDS.has(raw) ? raw : FLOOR_MAIN;
}

function getProvider(env, floor) {
  if (floor === FLOOR_ADMIN) {
    return {
      floor,
      id: FLOOR_ADMIN,
      label: "行政客服",
      channelSecret: env.LINE_OA2_CHANNEL_SECRET || env.LINE_GLOBAL_CHANNEL_SECRET || env.LINE_ADMIN_CHANNEL_SECRET || "",
      accessToken: env.LINE_OA2_CHANNEL_ACCESS_TOKEN || env.LINE_GLOBAL_CHANNEL_ACCESS_TOKEN || env.LINE_ADMIN_CHANNEL_ACCESS_TOKEN || "",
    };
  }
  if (floor === FLOOR_SMART) {
    return {
      floor,
      id: FLOOR_SMART,
      label: "康立智能",
      channelSecret: env.LINE_OA1_CHANNEL_SECRET || env.LINE_SMART_CHANNEL_SECRET || env.LINE_MAIN_CHANNEL_SECRET || env.LINE_CHANNEL_SECRET || "",
      accessToken: env.LINE_OA1_CHANNEL_ACCESS_TOKEN || env.LINE_SMART_CHANNEL_ACCESS_TOKEN || env.LINE_MAIN_CHANNEL_ACCESS_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN || "",
    };
  }
  return {
    floor: FLOOR_MAIN,
    id: FLOOR_MAIN,
    label: "產品客服",
    channelSecret: env.LINE_MAIN_CHANNEL_SECRET || env.LINE_CHANNEL_SECRET || "",
    accessToken: env.LINE_MAIN_CHANNEL_ACCESS_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN || "",
  };
}

function threadIdFor(floor, userId) {
  return floor === FLOOR_MAIN ? `user:${userId}` : `${floor}:user:${userId}`;
}

async function fetchConsoleSummary(env) {
  const now = Date.now();
  const todayStart = taipeiStartOfDay(now);
  const floorNames = { [FLOOR_MAIN]: "\u7522\u54c1\u5ba2\u670d", [FLOOR_ADMIN]: "\u884c\u653f\u5ba2\u670d", [FLOOR_SMART]: "康立智能" };
  const floors = [];
  await ensureCalendarEventSchema(env);

  for (const floor of [FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART]) {
    const [threadStats, todayMessages, todayReplies, aiAlerts, latestThread] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN risk = 'high' THEN 1 ELSE 0 END) AS high_risk
        FROM threads
        WHERE floor_id = ?
      `).bind(STATUS_PENDING, STATUS_IMPORTANT, STATUS_DONE, floor).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?").bind(floor, USER_ROLE, todayStart).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?").bind(floor, ADMIN_ROLE, todayStart).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM ai_logs WHERE floor_id = ? AND created_at >= ?").bind(floor, todayStart).first(),
      env.DB.prepare("SELECT display_name, user_id, summary, last_message_at FROM threads WHERE floor_id = ? ORDER BY last_message_at DESC LIMIT 1").bind(floor).first(),
    ]);

    floors.push({
      id: floor,
      name: floorNames[floor] || floor,
      threads: numberOrZero(threadStats && threadStats.total),
      pending: numberOrZero(threadStats && threadStats.pending),
      done: numberOrZero(threadStats && threadStats.done),
      highRisk: numberOrZero(threadStats && threadStats.high_risk),
      todayMessages: numberOrZero(todayMessages && todayMessages.count),
      todayReplies: numberOrZero(todayReplies && todayReplies.count),
      aiAlerts: numberOrZero(aiAlerts && aiAlerts.count),
      latestThread: latestThread ? {
        name: stringValue(latestThread.display_name) || stringValue(latestThread.user_id),
        summary: stringValue(latestThread.summary),
        at: numberOrZero(latestThread.last_message_at),
      } : null,
    });
  }

  const [calendarCount, calendarUpcomingList, upcomingEvents, registrations, checkins, recentCheckins, attendanceByEvent, crmMembers, pointAccounts, pointLedgerToday] = await Promise.all([
    countIfTableExists(env, "calendar_events", "starts_at >= ? AND starts_at < ?", [todayStart, todayStart + 86400000]),
    fetchUpcomingCalendarEvents(env, todayStart, 24),
    countIfTableExists(env, "calendar_events", "starts_at >= ?", [todayStart]),
    countIfTableExists(env, "event_registrations", "registered_at >= ?", [todayStart]),
    countIfTableExists(env, "reward_claims", "status = 'success' AND created_at >= datetime(?, 'unixepoch')", [Math.floor(todayStart / 1000)]),
    fetchRecentRewardCheckins(env, 12),
    fetchAttendanceByEvent(env, 20),
    countIfTableExists(env, "crm_members", "", []),
    countIfTableExists(env, "point_accounts", "", []),
    countIfTableExists(env, "point_ledger", "created_at >= datetime(?, 'unixepoch')", [Math.floor(todayStart / 1000)]),
  ]);

  const totals = floors.reduce((acc, item) => ({
    threads: acc.threads + item.threads,
    pending: acc.pending + item.pending,
    done: acc.done + item.done,
    highRisk: acc.highRisk + item.highRisk,
    todayMessages: acc.todayMessages + item.todayMessages,
    todayReplies: acc.todayReplies + item.todayReplies,
    aiAlerts: acc.aiAlerts + item.aiAlerts,
  }), { threads: 0, pending: 0, done: 0, highRisk: 0, todayMessages: 0, todayReplies: 0, aiAlerts: 0 });

  return {
    generatedAt: now,
    todayStart,
    totals,
    floors,
    calendar: { today: calendarCount, upcoming: calendarUpcomingList },
    events: { upcoming: upcomingEvents, registrationsToday: registrations, checkinsToday: checkins, recentCheckins, upcomingCourses: calendarUpcomingList.slice(0, 8), attendanceByEvent },
    pointCrm: { members: crmMembers, pointAccounts, ledgerToday: pointLedgerToday },
  };
}

async function fetchAttendanceByEvent(env, limit = 20) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(`
      SELECT rc.event_uid, rc.campaign, rc.line_user_id, rc.points, rc.event_title, rc.location_name, rc.created_at,
             p.display_name AS profile_name,
             cm.name AS crm_name
      FROM reward_claims rc
      LEFT JOIN profiles p ON p.user_id = rc.line_user_id
      LEFT JOIN crm_members cm ON json_extract(cm.source_json, '$.LINE_user_id') = rc.line_user_id
                              OR json_extract(cm.source_json, '$.user_login') = rc.line_user_id
      WHERE rc.status = 'success'
        AND (rc.campaign LIKE 'calendar_%' OR rc.event_uid LIKE 'cal_%')
      ORDER BY rc.created_at DESC
      LIMIT 600
    `).all();
    const groups = new Map();
    for (const row of results || []) {
      const key = stringValue(row.event_uid || row.campaign || row.event_title || 'calendar');
      if (!groups.has(key)) {
        groups.set(key, {
          eventUid: stringValue(row.event_uid),
          campaign: stringValue(row.campaign),
          eventTitle: stringValue(row.event_title) || stringValue(row.campaign) || '課程活動',
          location: stringValue(row.location_name),
          latestAt: stringValue(row.created_at),
          attendeeCount: 0,
          attendees: [],
          _seen: new Set(),
        });
      }
      const group = groups.get(key);
      const userId = stringValue(row.line_user_id);
      if (!userId || group._seen.has(userId)) continue;
      group._seen.add(userId);
      group.attendees.push({
        userId,
        name: stringValue(row.crm_name || row.profile_name) || shortUid(userId),
        points: numberOrZero(row.points),
        checkedAt: stringValue(row.created_at),
      });
      group.attendeeCount = group.attendees.length;
      if (!group.location && row.location_name) group.location = stringValue(row.location_name);
    }
    return Array.from(groups.values()).slice(0, Math.max(1, Math.min(50, Number(limit) || 20))).map((group) => {
      delete group._seen;
      return group;
    });
  } catch (_) {
    return [];
  }
}
async function fetchRecentRewardCheckins(env, limit = 12) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(`
      SELECT campaign, line_user_id, channel_key, points, event_title, location_name, distance_meters, created_at
      FROM reward_claims
      WHERE status = 'success'
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(Math.max(1, Math.min(50, Number(limit) || 12))).all();
    return (results || []).map((row) => ({
      campaign: stringValue(row.campaign),
      userId: stringValue(row.line_user_id),
      channelKey: stringValue(row.channel_key),
      points: numberOrZero(row.points),
      eventTitle: stringValue(row.event_title),
      location: stringValue(row.location_name),
      distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
      createdAt: stringValue(row.created_at),
    }));
  } catch (_) {
    return [];
  }
}

async function ensureCalendarEventSchema(env) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL DEFAULT '*',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starts_at INTEGER NOT NULL,
      ends_at INTEGER,
      location TEXT NOT NULL DEFAULT '',
      owner_user_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'internal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await ensureColumn(env, "calendar_events", "checkin_starts_at", "INTEGER");
  await ensureColumn(env, "calendar_events", "checkin_ends_at", "INTEGER");
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_calendar_events_floor_starts ON calendar_events(floor_id, starts_at)").run();
}

async function fetchUpcomingCalendarEvents(env, fromMs = Date.now(), limit = 50) {
  await ensureCalendarEventSchema(env);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = await env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, visibility
    FROM calendar_events
    WHERE starts_at >= ?
    ORDER BY starts_at ASC
    LIMIT ?
  `).bind(Number(fromMs) || Date.now(), safeLimit).all();
  return (rows.results || []).map((row) => ({
    id: stringValue(row.id),
    title: stringValue(row.title),
    description: stringValue(row.description),
    startsAt: numberOrZero(row.starts_at),
    endsAt: numberOrZero(row.ends_at),
    checkinStartsAt: numberOrZero(row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row.checkin_ends_at),
    location: stringValue(row.location),
    visibility: stringValue(row.visibility || "internal"),
  }));
}

async function ensureColumn(env, tableName, columnName, definition) {
  try {
    await env.DB.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  } catch (err) {
    const message = String(err && err.message || err).toLowerCase();
    if (!message.includes("duplicate column") && !message.includes("already exists")) throw err;
  }
}

async function listCalendarEvents(env, url) {
  await ensureCalendarEventSchema(env);
  const from = Number(url.searchParams.get("from")) || taipeiStartOfDay(Date.now()) - 30 * 86400000;
  const to = Number(url.searchParams.get("to")) || 0;
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  const where = to > from ? "starts_at >= ? AND starts_at < ?" : "starts_at >= ?";
  const statement = env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, visibility, updated_at
    FROM calendar_events
    WHERE ${where}
    ORDER BY starts_at ASC
    LIMIT ?
  `);
  const rows = to > from ? await statement.bind(from, to, limit).all() : await statement.bind(from, limit).all();
  return (rows.results || []).map(calendarEventRowToConsoleEvent);
}

async function saveCalendarEvent(env, body) {
  await ensureCalendarEventSchema(env);
  const title = stringValue(body.title || body.summary).trim();
  if (!title) throw httpError("活動名稱必填", 400);
  const startsAt = numberOrZero(body.startsAt || body.starts_at);
  let endsAt = numberOrZero(body.endsAt || body.ends_at);
  if (!startsAt || !endsAt) throw httpError("活動開始與結束時間必填", 400);
  if (endsAt <= startsAt) throw httpError("活動結束時間必須晚於開始時間", 400);
  let checkinStartsAt = numberOrZero(body.checkinStartsAt || body.checkin_starts_at);
  const checkinEndsAt = numberOrZero(body.checkinEndsAt || body.checkin_ends_at);
  if (!checkinStartsAt || checkinStartsAt >= startsAt) checkinStartsAt = startsAt - 60 * 60 * 1000;
  if (!checkinStartsAt || !checkinEndsAt) throw httpError("報名開始與結束時間必填", 400);
  if (checkinEndsAt <= checkinStartsAt) throw httpError("報名結束時間必須晚於報名開始時間", 400);
  const id = normalizeCalendarEventId(body.id) || `cal_manual_${shortHash(`${title}|${startsAt}|${stringValue(body.location)}`)}`;
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO calendar_events (id, floor_id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, owner_user_id, visibility, created_at, updated_at)
    VALUES (?, '*', ?, ?, ?, ?, ?, ?, ?, '', 'public', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      checkin_starts_at = excluded.checkin_starts_at,
      checkin_ends_at = excluded.checkin_ends_at,
      location = excluded.location,
      visibility = excluded.visibility,
      updated_at = excluded.updated_at
  `).bind(id, title, stringValue(body.description), startsAt, endsAt, checkinStartsAt, checkinEndsAt, stringValue(body.location), now, now).run();
  const row = await env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, visibility, updated_at
    FROM calendar_events
    WHERE id = ?
  `).bind(id).first();
  return calendarEventRowToConsoleEvent(row);
}

async function deleteCalendarEvent(env, idValue) {
  await ensureCalendarEventSchema(env);
  const id = normalizeCalendarEventId(idValue);
  if (!id) throw httpError("活動 ID 必填", 400);
  const result = await env.DB.prepare("DELETE FROM calendar_events WHERE id = ?").bind(id).run();
  return Number(result && result.meta && result.meta.changes || 0);
}

function normalizeCalendarEventId(value) {
  return stringValue(value).trim().replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 80);
}

function calendarEventRowToConsoleEvent(row) {
  return {
    id: stringValue(row && row.id),
    title: stringValue(row && row.title),
    description: stringValue(row && row.description),
    startsAt: numberOrZero(row && row.starts_at),
    endsAt: numberOrZero(row && row.ends_at),
    checkinStartsAt: numberOrZero(row && row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row && row.checkin_ends_at),
    location: stringValue(row && row.location),
    visibility: stringValue(row && row.visibility || "internal"),
    updatedAt: numberOrZero(row && row.updated_at),
  };
}

function requiresFloorAccess(pathname) {
  const path = stringValue(pathname);
  if (path === "/api/floor-whitelist" || path === "/api/ai-wear-public" || path === "/api/ai-wear/upload-selfie" || path === "/api/ai-wear/member-points" || path === "/api/ai-wear/preflight" || path === "/api/ai-wear/generate" || path === "/api/ai-wear-results") return false;
  if (path === "/api/data") return true;
  if (path === "/api/send" || path === "/api/log-reply" || path === "/api/conversation-meta") return true;
  if (path === "/api/knowledge" || path === "/api/knowledge/manifest" || path === "/api/knowledge/file" || path === "/api/reply-learning" || path === "/api/reply-learning/rebuild" || path === "/api/checkin-template" || path === "/api/ai-wear-settings" || path === "/api/ai-wear-gallery" || path === "/api/ai-wear-results") return true;
  if (path === "/api/backfill-profiles" || path === "/api/profile-debug") return true;
  if (path === "/admin/points/stats" || path === "/admin/points/stats-data") return false;
  if (path.startsWith("/admin/points/")) return true;
  return false;
}

async function assertFloorAccess(request, env, floor) {
  const auth = await assertDashboardAuth(request, env);
  const targetFloor = FLOOR_IDS.has(floor) ? floor : FLOOR_MAIN;
  if (auth.adminToken || auth.admin) return;
  const sessionFloors = Array.isArray(auth.floors) ? auth.floors : [];
  if (sessionFloors.includes(FLOOR_SUPER_ADMIN) || sessionFloors.includes(targetFloor)) return;
  if (!env.DB) return;
  await ensureFloorAccessSchema(env);
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM floor_access_whitelist WHERE floor_id = ? AND active = 1").bind(targetFloor).first();
  if (Number(countRow && countRow.count || 0) <= 0) return;
  const operator = requestOperatorIdentity(request, auth);
  if (!operator.ids.length && !operator.names.length) throw httpError(`此樓層已啟用白名單，請先填寫操作人代號`, 403);
  if (isBuiltinAdminOperator(operator)) return;
  const adminAllowed = await findFloorAccessEntry(env, FLOOR_SUPER_ADMIN, operator);
  if (adminAllowed) return;
  const allowed = await findFloorAccessEntry(env, targetFloor, operator);
  if (!allowed) throw httpError(`操作人 ${operator.label || "未填"} 不在 ${floorLabel(targetFloor)} 白名單`, 403);
}

function floorLabel(floor) {
  if (floor === FLOOR_SMART) return "康立智能";
  return floor === FLOOR_ADMIN ? "\u884c\u653f\u5ba2\u670d" : "\u7522\u54c1\u5ba2\u670d";
}

function normalizedOperatorId(value) {
  return stringValue(value).trim();
}

function requestOperatorIdentity(request, auth = {}) {
  const idHeaders = [
    auth.userId,
    request.headers.get("X-Operator-Id"),
    request.headers.get("X-User-Id"),
    request.headers.get("X-Admin-User"),
  ];
  const nameHeaders = [
    auth.displayName,
    request.headers.get("X-Operator-Name"),
    request.headers.get("X-Admin-Name"),
  ];
  const ids = uniqueSuggestions(idHeaders.map(normalizedOperatorId).filter(Boolean));
  const names = uniqueSuggestions([...nameHeaders, ...idHeaders].map((value) => stringValue(value).trim()).filter(Boolean));
  return {
    ids,
    names,
    label: ids[0] || names[0] || "",
  };
}

function isBuiltinAdminOperator(operator) {
  const ids = Array.isArray(operator && operator.ids) ? operator.ids : [];
  return ids.some((id) => BUILTIN_ADMIN_UIDS.has(normalizedOperatorId(id)));
}

function isBuiltinAdminProfile(profile) {
  return BUILTIN_ADMIN_UIDS.has(normalizedOperatorId(profile && profile.userId));
}

async function findFloorAccessEntry(env, floor, operator) {
  const ids = Array.isArray(operator && operator.ids) ? operator.ids.filter(Boolean) : [];
  const names = Array.isArray(operator && operator.names) ? operator.names.filter(Boolean) : [];
  if (!ids.length && !names.length) return null;
  const clauses = [];
  const bindings = [floor];
  if (ids.length) {
    clauses.push(`operator_id IN (${ids.map(() => "?").join(",")})`);
    bindings.push(...ids);
  }
  if (names.length) {
    clauses.push(`operator_name IN (${names.map(() => "?").join(",")})`);
    bindings.push(...names);
  }
  const sql = `
    SELECT operator_id, operator_name
    FROM floor_access_whitelist
    WHERE floor_id = ? AND active = 1 AND (${clauses.join(" OR ")})
    LIMIT 1
  `;
  return env.DB.prepare(sql).bind(...bindings).first();
}

function isAdminRequest(request, env) {
  const adminToken = String(env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return false;
  const auth = String(request.headers.get("Authorization") || "").trim();
  const directToken = String(request.headers.get("X-Admin-Token") || request.headers.get("X-Dashboard-Token") || "").trim();
  const bearerToken = auth.replace(/^Bearer\s+/i, "").trim();
  return bearerToken === adminToken || directToken === adminToken;
}

async function ensureFloorAccessSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS floor_access_whitelist (
        floor_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        operator_name TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(floor_id, operator_id)
      )
    `),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_floor_access_whitelist_floor_active ON floor_access_whitelist(floor_id, active)"),
  ]);
}

async function fetchFloorWhitelist(env) {
  if (!env.DB) return { floors: {} };
  await ensureFloorAccessSchema(env);
  const rows = await env.DB.prepare(`
    SELECT floor_id, operator_id, operator_name, active, updated_at
    FROM floor_access_whitelist
    ORDER BY floor_id ASC, operator_id ASC
  `).all();
  const floors = { [FLOOR_MAIN]: [], [FLOOR_ADMIN]: [], adminAll: [] };
  for (const row of rows.results || []) {
    const floorId = row.floor_id === FLOOR_SUPER_ADMIN ? FLOOR_SUPER_ADMIN : (FLOOR_IDS.has(row.floor_id) ? row.floor_id : FLOOR_MAIN);
    const listKey = floorId === FLOOR_SUPER_ADMIN ? "adminAll" : floorId;
    floors[listKey].push({
      floorId,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      active: Number(row.active || 0) === 1,
      updatedAt: row.updated_at,
    });
  }
  return { floors };
}

async function saveFloorWhitelist(env, floor, entries) {
  if (!env.DB) return { floor, count: 0 };
  await ensureFloorAccessSchema(env);
  const targetFloor = ACCESS_LIST_IDS.has(floor) ? floor : FLOOR_MAIN;
  const now = Date.now();
  const normalized = normalizeWhitelistEntries(entries);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM floor_access_whitelist WHERE floor_id = ?").bind(targetFloor),
    ...normalized.map((entry) => env.DB.prepare(`
      INSERT INTO floor_access_whitelist (floor_id, operator_id, operator_name, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).bind(targetFloor, entry.operatorId, entry.operatorName, now, now)),
  ]);
  return { floor: targetFloor, count: normalized.length, entries: normalized };
}

function parseWhitelistLines(value) {
  return stringValue(value).split(/\r?\n/).map((line) => {
    const clean = line.trim();
    if (!clean) return null;
    const parts = clean.split(/[,，\t]/).map((part) => part.trim()).filter(Boolean);
    return { operatorId: parts[0] || "", operatorName: parts.slice(1).join(" ") || "" };
  }).filter(Boolean);
}

function normalizeWhitelistEntries(entries) {
  const output = [];
  const seen = new Set();
  for (const item of Array.isArray(entries) ? entries : []) {
    const operatorId = normalizedOperatorId(item.operatorId || item.operator_id || item.id || item.uid);
    if (!operatorId || seen.has(operatorId)) continue;
    seen.add(operatorId);
    output.push({ operatorId, operatorName: stringValue(item.operatorName || item.operator_name || item.name).trim() });
  }
  return output;
}

function getPointChannelConfig(env, channelKey) {
  let channelConfig = {};
  try {
    channelConfig = JSON.parse(env.CHANNEL_CONFIG_JSON || "{}")[channelKey] || {};
  } catch (_err) {
    channelConfig = {};
  }

  const configuredFloor = FLOOR_IDS.has(channelConfig.floor) ? channelConfig.floor : "";
  const floor = channelKey === POINT_OA1 ? FLOOR_SMART : (configuredFloor || POINT_CHANNEL_FLOORS[channelKey] || FLOOR_MAIN);
  const provider = getProvider(env, floor);
  return {
    channelKey,
    floor,
    label: stringValue(channelConfig.label || (channelKey === POINT_OA2 ? "OA2 行政客服" : "康立智能")),
    channelSecret: stringValue(pointChannelEnv(env, channelKey, "SECRET") || channelConfig.channelSecret || provider.channelSecret),
    accessToken: stringValue(pointChannelEnv(env, channelKey, "ACCESS_TOKEN") || channelConfig.channelAccessToken || provider.accessToken),
    forwardUrl: stringValue(channelConfig.forwardUrl),
    monitor: channelKey === POINT_OA1 || channelConfig.monitor === true,
  };
}

function pointChannelEnv(env, channelKey, suffix) {
  if (channelKey === POINT_OA1) return env[`LINE_OA1_CHANNEL_${suffix}`] || env[`LINE_SMART_CHANNEL_${suffix}`] || "";
  if (channelKey === POINT_OA2) return env[`LINE_OA2_CHANNEL_${suffix}`] || env[`LINE_GLOBAL_CHANNEL_${suffix}`] || "";
  return "";
}

async function handlePointWebhook(request, env, ctx, channelKey, corsHeaders) {
  const config = getPointChannelConfig(env, channelKey);
  if (!config.channelSecret) {
    return jsonResponse({ success: false, status: "error", message: `${channelKey} channelSecret is not configured` }, 500, corsHeaders);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") || "";
  const validLine = await verifyLineSignature(rawBody, signature, config.channelSecret);
  if (!validLine) return jsonResponse({ success: false, status: "error", message: "Invalid LINE signature" }, 401, corsHeaders);

  const payload = JSON.parse(rawBody);
  const provider = {
    floor: config.floor,
    id: config.floor,
    label: config.label,
    channelSecret: config.channelSecret,
    accessToken: config.accessToken,
  };
  const fastTemplateReplies = await replyCheckinTemplateForPayload(env, config.floor, provider, payload).catch((error) => {
    console.error("fast checkin template reply failed", error && error.stack ? error.stack : error);
    return 0;
  });
  ctx.waitUntil(processPointWebhook(env, channelKey, config, payload, rawBody, signature, { skipCheckinTemplateReply: fastTemplateReplies > 0 }).catch((error) => {
    console.error("processPointWebhook failed", error && error.stack ? error.stack : error);
  }));

  return jsonResponse({
    success: true,
    status: "success",
    channel_key: channelKey,
    floor: config.floor,
    queued_events: Array.isArray(payload.events) ? payload.events.length : 0,
    fast_template_replies: fastTemplateReplies,
  }, 200, corsHeaders);
}

async function handleGatewayForwardedWebhook(request, env, ctx, channelKey, corsHeaders) {
  const token = stringValue(env.GATEWAY_FORWARD_TOKEN || env.MLM_FORWARD_TOKEN);
  if (!token) {
    return jsonResponse({ success: false, status: "error", message: "GATEWAY_FORWARD_TOKEN is not configured" }, 500, corsHeaders);
  }
  const rawBody = await request.text();
  const signature = request.headers.get("x-gateway-signature") || "";
  const validGateway = await verifyGatewaySignature(rawBody, signature, token);
  if (!validGateway) return jsonResponse({ success: false, status: "error", message: "Invalid gateway signature" }, 401, corsHeaders);

  const config = getPointChannelConfig(env, channelKey);
  const payload = JSON.parse(rawBody);
  ctx.waitUntil(processGatewayForwardedWebhook(env, channelKey, config, payload).catch((error) => {
    console.error("processGatewayForwardedWebhook failed", error && error.stack ? error.stack : error);
  }));

  return jsonResponse({
    success: true,
    status: "success",
    channel_key: channelKey,
    floor: config.floor,
    queued_events: Array.isArray(payload.events) ? payload.events.length : 0,
    source: "gateway-forward",
  }, 200, corsHeaders);
}

async function processGatewayForwardedWebhook(env, channelKey, config, payload) {
  await upsertPointChannel(env, config);
  const provider = {
    floor: config.floor,
    id: config.floor,
    label: config.label,
    channelSecret: config.channelSecret,
    accessToken: config.accessToken,
  };

  const monitorEvents = [];
  for (const event of payload.events || []) {
    const userId = event.source && event.source.userId ? event.source.userId : "";
    if (isSmartDailyRewardEvent(channelKey, event)) {
      if (userId) await handleSmartDailyReward(env, channelKey, provider, event, userId);
      await recordPointEvent(env, channelKey, event);
      await mirrorPointMessageToMonitor(env, config, provider, event, userId);
    } else if (isSmartPointQueryEvent(channelKey, event)) {
      if (userId) await handlePointQueryKeyword(env, provider, event, userId);
      await recordPointEvent(env, channelKey, event);
      await mirrorPointMessageToMonitor(env, config, provider, event, userId);
    } else {
      await recordPointEvent(env, channelKey, event);
      await tryApplyBindingCode(env, channelKey, userId, event.message && event.message.text);
      if (userId && await handleNfcTestConversation(env, channelKey, provider, event, userId)) {
        // consumed by the ad hoc NFC testing setup flow
      } else {
        monitorEvents.push(event);
      }
    }
  }

  if (config.monitor && monitorEvents.length) await processLineWebhook(env, config.floor, provider, { ...payload, events: monitorEvents });
}

async function mirrorPointMessageToMonitor(env, config, provider, event, userId) {
  if (!config || !event || event.type !== "message" || !event.message || event.message.type !== "text" || !userId) return;
  try {
    await saveIncomingMessage(env, config.floor, provider, event, userId, stringValue(event.message.text));
  } catch (error) {
    console.error("mirrorPointMessageToMonitor failed", error && error.stack ? error.stack : error);
  }
}

function isSmartDailyRewardEvent(channelKey, event) {
  if (channelKey !== POINT_OA1 || !event || event.type !== "message" || !event.message || event.message.type !== "text") return false;
  const text = normalizeTextKeyword(event.message.text);
  return ["簽到贈點", "簽到贈K點", "會員打卡", "每日簽到贈點"].map(normalizeTextKeyword).includes(text);
}

function isSmartPointQueryEvent(channelKey, event) {
  if (channelKey !== POINT_OA1 || !event || event.type !== "message" || !event.message || event.message.type !== "text") return false;
  const text = normalizeTextKeyword(event.message.text);
  return ["k點查詢", "K點查詢", "點數查詢", "查詢k點", "查詢K點", "查詢點數"].map(normalizeTextKeyword).includes(text);
}

async function handleNfcTestConversation(env, channelKey, provider, event, userId) {
  if (channelKey !== POINT_OA1 || !env.DB || !event || event.type !== "message" || !event.message) return false;
  const message = event.message || {};
  const messageType = stringValue(message.type);
  const text = messageType === "text" ? stringValue(message.text).trim() : "";
  await ensureNfcTestTables(env);

  const isTempCheckinKeyword = normalizeTextKeyword(text) === normalizeTextKeyword("報到點");
  const isTestKeyword = normalizeTextKeyword(text) === normalizeTextKeyword("簽到測試");
  if (isTempCheckinKeyword || isTestKeyword) {
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO nfc_test_flows (token, channel_key, user_id, stage, address, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(token, channelKey, userId, "address", "", calendarDefaultPoints(env), now, now).run();
    await replyOrPushLineMessage(provider, event.replyToken, userId, isTempCheckinKeyword ? "請輸入臨時報到點地址，或直接傳送 LINE 位置（較準）" : "請輸入地址，或直接傳送 LINE 位置（較準）");
    return true;
  }

  const flow = await latestOpenNfcTestFlow(env, channelKey, userId);
  if (!flow) return false;
  const now = Date.now();
  if (flow.stage === "address") {
    const address = nfcFlowAddressFromMessage(message);
    if (!address) {
      await replyOrPushLineMessage(provider, event.replyToken, userId, "請輸入地址，或使用 LINE 的位置功能傳送目前地點。");
      return true;
    }
    await env.DB.prepare(`
      UPDATE nfc_test_flows
      SET stage = ?, address = ?, updated_at = ?
      WHERE token = ?
    `).bind("time", address.slice(0, 300), now, flow.token).run();
    await replyOrPushLineMessage(provider, event.replyToken, userId, "請輸入簽到時間\n例：今天 18:00-21:00\n也可輸入：明天 13:00-16:00、2026-05-20 18:00-21:00");
    return true;
  }

  if (flow.stage === "time") {
    if (!text) {
      await replyOrPushLineMessage(provider, event.replyToken, userId, "請輸入簽到時間\n例：今天 18:00-21:00");
      return true;
    }
    const parsed = parseNfcTestTimeInput(text, now);
    if (!parsed) {
      await replyOrPushLineMessage(provider, event.replyToken, userId, "時間格式看不懂，請改用：今天 18:00-21:00 或 2026-05-20 18:00-21:00");
      return true;
    }
    await env.DB.prepare(`
      UPDATE nfc_test_flows
      SET stage = ?, starts_at = ?, ends_at = ?, updated_at = ?
      WHERE token = ?
    `).bind("complete", parsed.startsAt, parsed.endsAt, now, flow.token).run();
    const campaign = `${NFC_TEST_CAMPAIGN_PREFIX}${flow.token}`;
    const nfcAppUrl = buildRewardLineAppUrl(env, campaign, "nfc");
    const tempCheckinUrl = buildRewardLiffUrl(env, campaign, "checkin");
    const liffUrl = buildRewardLiffUrl(env, campaign, "nfc");
    const backupUrl = `${publicBaseUrl(env)}/r/nfc-test?token=${encodeURIComponent(flow.token)}`;
    await replyOrPushLineMessage(provider, event.replyToken, userId, [
      "報到點已建立：",
      tempCheckinUrl,
      "",
      `地址：${flow.address}`,
      `時間：${formatNfcTestTimeRange(parsed.startsAt, parsed.endsAt)}`,
      `點數：${calendarDefaultPoints(env)}點`,
      "",
      "使用者也可在課程報到選「其他」後依定位報到。",
      `LINE App備用：${nfcAppUrl}`,
      `LIFF備用：${liffUrl}`,
      `短網址備用：${backupUrl}`,
    ].join("\n"));
    return true;
  }

  return false;
}

function nfcFlowAddressFromMessage(message) {
  if (!message) return "";
  if (message.type === "location") {
    const lat = Number(message.latitude);
    const lng = Number(message.longitude);
    const label = [message.title, message.address].map(stringValue).filter(Boolean).join(" ");
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng} ${label}`.trim();
    return label;
  }
  if (message.type === "text") return stringValue(message.text).trim();
  return "";
}

async function ensureNfcTestTables(env) {
  if (!env.DB) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS nfc_test_flows (
      token TEXT PRIMARY KEY,
      channel_key TEXT NOT NULL DEFAULT 'oa1',
      user_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      starts_at INTEGER,
      ends_at INTEGER,
      points INTEGER NOT NULL DEFAULT 10,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_nfc_test_flows_user
    ON nfc_test_flows(channel_key, user_id, updated_at)
  `).run();
}

async function latestOpenNfcTestFlow(env, channelKey, userId) {
  if (!env.DB) return null;
  return env.DB.prepare(`
    SELECT token, channel_key, user_id, stage, address, starts_at, ends_at, points, created_at, updated_at
    FROM nfc_test_flows
    WHERE channel_key = ? AND user_id = ? AND stage IN ('address', 'time') AND updated_at >= ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(channelKey, userId, Date.now() - 24 * 60 * 60 * 1000).first();
}

function parseNfcTestTimeInput(input, now = Date.now()) {
  const text = stringValue(input)
    .replace(/[－—–]/g, "-")
    .replace(/[～~]/g, "-")
    .replace(/\s*(至|到)\s*/g, "-")
    .trim();
  if (!text) return null;
  const base = taipeiDateParts(now);
  let year = base.year;
  let month = base.month;
  let day = base.day;
  let rest = text;
  const isoDate = rest.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  const slashDate = rest.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if (/明天/.test(rest)) {
    const tomorrow = taipeiDateParts(now + 24 * 60 * 60 * 1000);
    year = tomorrow.year; month = tomorrow.month; day = tomorrow.day;
  } else if (isoDate) {
    year = Number(isoDate[1]); month = Number(isoDate[2]); day = Number(isoDate[3]);
    rest = rest.replace(isoDate[0], " ");
  } else if (slashDate) {
    month = Number(slashDate[1]); day = Number(slashDate[2]);
  }
  const times = [...rest.matchAll(/(\d{1,2})[:：](\d{2})/g)].map((match) => ({ hour: Number(match[1]), minute: Number(match[2]) }));
  if (!times.length) return null;
  if (times.some((time) => time.hour > 23 || time.minute > 59)) return null;
  const startsAt = taipeiLocalTimestamp(year, month, day, times[0].hour, times[0].minute);
  let endsAt = times[1]
    ? taipeiLocalTimestamp(year, month, day, times[1].hour, times[1].minute)
    : startsAt + 3 * 60 * 60 * 1000;
  if (endsAt <= startsAt) endsAt += 24 * 60 * 60 * 1000;
  return { startsAt, endsAt };
}

function taipeiDateParts(value = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function taipeiLocalTimestamp(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute, 0) - 8 * 60 * 60 * 1000;
}

function formatNfcTestTimeRange(startsAt, endsAt) {
  return `${formatTaipeiDateTime(new Date(startsAt).toISOString())}-${formatTaipeiDateTime(new Date(endsAt).toISOString()).slice(6)}`;
}

function publicBaseUrl(env) {
  return stringValue(env.PUBLIC_BASE_URL || env.WORKER_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
}

function normalizeNfcTestToken(value) {
  return stringValue(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

async function handlePointQueryKeyword(env, provider, event, userId) {
  const liffId = stringValue(env.POINTS_LIFF_ID) || POINTS_LIFF_ID;
  const replyText = `請點選以下連結查看您的點數列表：\nhttps://liff.line.me/${liffId}`;
  return replyOrPushLineMessage(provider, event.replyToken, userId, replyText);
}

async function handleSmartRewardBalanceDisplay(env, provider, event, userId) {
  try {
    const snapshot = await fetchWetwPointSnapshot(env, POINT_OA1, userId, "gift_money", 5, {
      shop_id: memberCheckinShopId(env),
    });
    const items = (snapshot.rows || []).map((row) => wetwPointListItem(row));
    const lines = [
      `目前累積 ${formatPoint(snapshot.balance)} K點。`,
      "",
      "最近K點紀錄：",
    ];
    if (!items.length) {
      lines.push("目前母站沒有K點紀錄。");
    } else {
      items.slice(0, 5).forEach((item) => {
        const amount = Number(item.amount || 0);
        const sign = amount >= 0 ? "+" : "";
        lines.push(`${item.datetime || "-"} ${item.eventName || "K點紀錄"} ${sign}${formatPoint(amount)}點｜${item.eventContent || "無備註"}`);
      });
    }
    return replyOrPushLineMessage(provider, event.replyToken, userId, lines.join("\n"));
  } catch (_error) {
    return replyOrPushLineMessage(provider, event.replyToken, userId, "目前無法讀取母站K點資料，請稍後再試。");
  }
}

function smartDailyRewardPoints(env) {
  const points = Number(env.SMART_DAILY_REWARD_POINTS || env.DAILY_REWARD_POINTS || 5);
  return Number.isFinite(points) && points > 0 ? Math.round(points) : 5;
}

async function handleSmartDailyReward(env, channelKey, provider, event, userId) {
  const rawKeyword = stringValue(event && event.message && event.message.text) || "會員打卡";
  const keyword = "簽到贈點";
  const rewardDate = taipeiDate();
  const pointType = "gift_money";
  const points = smartDailyRewardPoints(env);
  const existing = await env.DB.prepare(
    "SELECT id, points, balance_after, status " +
    "FROM daily_keyword_rewards " +
    "WHERE line_user_id = ? AND channel_key = ? AND point_type = ? AND reward_date = ? AND status != 'failed' " +
    "ORDER BY id ASC LIMIT 1"
  ).bind(userId, channelKey, pointType, rewardDate).first();
  if (existing) {
    const balance = await getLiveFirstPointAccountBalance(env, channelKey, userId, pointType).catch(() => getPointAccountBalance(env, channelKey, userId, pointType)).catch(() => 0);
    await env.DB.prepare(
      "UPDATE daily_keyword_rewards " +
      "SET balance_after = ?, message = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE id = ?"
    ).bind(balance, "duplicate_smart_daily_reward", existing.id).run();
    return replySmartDailyReward(env, channelKey, provider, event, userId, { duplicate: true, points: Number(existing.points || points), balance_after: balance });
  }

  const inserted = await env.DB.prepare(
    "INSERT INTO daily_keyword_rewards (rule_id, keyword, line_user_id, channel_key, point_type, points, reward_date, status, created_at, updated_at) " +
    "VALUES (0, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
  ).bind(keyword, userId, channelKey, pointType, points, rewardDate).run();
  const rewardId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  try {
    const mutation = await pointMutation(env, {
      channel_key: channelKey,
      line_user_id: userId,
      chat_line_user_id: userId,
      point_type: pointType,
      points,
      operator_id: "smart-daily-reward",
      operator_name: "\u6bcf\u65e5\u6253\u5361\u81ea\u52d5\u8d08\u9ede",
      event_name: "\u6253\u5361\u8d08\u9ede",
      event_content: "\u6bcf\u65e5\u6253\u5361\u8d08K\u9ede" + points + "\u9ede",
      note: rawKeyword + " 每日打卡贈K點",
      business_key: "smart-daily:" + channelKey + ":" + userId + ":" + rewardDate,
      shop_id: memberCheckinShopId(env),
      shop_remark: "每日打卡自動贈點；日期:" + rewardDate + "；關鍵字:" + rawKeyword,
    }, "grant");
    const localBalance = Number(mutation && mutation.balance_after);
    const balance = Number.isFinite(localBalance)
      ? localBalance
      : await getPointAccountBalance(env, channelKey, userId, pointType).catch(() => 0);
    if (rewardId) {
      await env.DB.prepare(
        "UPDATE daily_keyword_rewards " +
        "SET balance_after = ?, status = 'claimed', message = ?, updated_at = CURRENT_TIMESTAMP " +
        "WHERE id = ?"
      ).bind(balance, "gift_money_granted", rewardId).run();
    }
    return replySmartDailyReward(env, channelKey, provider, event, userId, { duplicate: false, points, balance_after: balance });
  } catch (error) {
    if (rewardId) {
      await env.DB.prepare(
        "UPDATE daily_keyword_rewards " +
        "SET status = 'failed', message = ?, updated_at = CURRENT_TIMESTAMP " +
        "WHERE id = ?"
      ).bind(error && error.message ? error.message.slice(0, 240) : String(error).slice(0, 240), rewardId).run();
    }
    return replyOrPushLineMessage(provider, event.replyToken, userId, "\u7c3d\u5230\u66ab\u6642\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002");
  }
}

async function replySmartDailyReward(env, channelKey, provider, event, userId, result) {
  const balance = formatPoint(result && result.balance_after);
  const points = formatPoint(result && result.points);
  const replyText = result && result.duplicate
    ? "您今天已經簽到過，目前點數餘額 " + balance + " K點。"
    : "簽到成功，已贈送 " + points + " K點。點數餘額 " + balance + " K點。";
  const delivery = await replyLineMessage(provider, event && event.replyToken, replyText);
  await saveSmartAutoReplyMessage(env, provider, userId, replyText, delivery, {
    channelKey,
    points: result && result.points,
    balanceAfter: result && result.balance_after,
    duplicate: Boolean(result && result.duplicate),
  });
  return delivery;
}

async function saveSmartAutoReplyMessage(env, provider, userId, text, delivery, meta = {}) {
  if (!env.DB || !userId || !text) return;
  if (delivery && delivery.ok === false) return;
  await saveAdminMessage(env, {
    floor: provider && provider.floor ? provider.floor : FLOOR_MAIN,
    userId,
    text,
    messageType: "text",
    rawJson: {
      direction: "outgoing",
      source: "smart-daily-reward",
      lineMessages: [{ type: "text", text }],
      delivery: delivery || null,
      meta,
    },
    createdAt: Date.now(),
    status: STATUS_DONE,
    category: "\u7c3d\u5230\u8d08\u9ede\u81ea\u52d5\u56de\u8986",
  });
}

function memberCheckinShopId(env) {
  const configured = Number(env.WETW_MEMBER_CHECKIN_SHOP_ID || 0);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return wetwShopId(env);
}

async function recentPointLedger(env, channelKey, userId, pointType, limit = 5) {
  const rows = await env.DB.prepare(`
    SELECT action, point_delta, balance_after, operator_name, note, created_at
    FROM point_ledger
    WHERE channel_key = ? AND line_user_id = ? AND point_type = ?
    ORDER BY id DESC
    LIMIT ?
  `).bind(channelKey, userId, pointType, limit).all();
  return rows.results || [];
}

function buildPointQueryReply(balance, ledger) {
  const lines = [
    `您目前累積 ${formatPoint(balance)} K點。`,
    "",
    "最近使用紀錄：",
  ];
  if (!ledger.length) {
    lines.push("目前沒有贈扣紀錄。");
    return lines.join("\n");
  }
  ledger.forEach((row) => {
    const delta = Number(row.point_delta || 0);
    const sign = delta >= 0 ? "+" : "";
    const actionLabel = delta >= 0 ? "贈點" : "扣點";
    const reason = stringValue(row.note || row.operator_name || row.action || "無備註");
    lines.push(`${formatTaipeiDateTime(row.created_at)} ${actionLabel} ${sign}${formatPoint(delta)} K點｜${reason}｜餘額 ${formatPoint(row.balance_after)} K點`);
  });
  return lines.join("\n");
}

async function processPointWebhook(env, channelKey, config, payload, rawBody, signature, options = {}) {
  await upsertPointChannel(env, config);
  let checkinEvents = 0;
  const monitorEvents = [];
  const provider = {
    floor: config.floor,
    id: config.floor,
    label: config.label,
    channelSecret: config.channelSecret,
    accessToken: config.accessToken,
  };

  for (const event of payload.events || []) {
    const userId = event.source && event.source.userId ? event.source.userId : "";
    if (isSmartDailyRewardEvent(channelKey, event)) {
      if (userId) await handleSmartDailyReward(env, channelKey, provider, event, userId);
      await recordPointEvent(env, channelKey, event);
      await mirrorPointMessageToMonitor(env, config, provider, event, userId);
      continue;
    }
    if (isSmartPointQueryEvent(channelKey, event)) {
      if (userId) await handlePointQueryKeyword(env, provider, event, userId);
      await recordPointEvent(env, channelKey, event);
      await mirrorPointMessageToMonitor(env, config, provider, event, userId);
      continue;
    }
    await recordPointEvent(env, channelKey, event);
    await tryApplyBindingCode(env, channelKey, userId, event.message && event.message.text);
    if (userId && await handleNfcTestConversation(env, channelKey, provider, event, userId)) {
      continue;
    }
    const delta = detectCheckinPointDelta(channelKey, event.message && event.message.text);
    if (event.source && event.source.userId && delta !== null) {
      await applyPointMutation(env, {
        channelKey,
        lineUserId: event.source.userId,
        pointType: "checkin_point",
        pointDelta: delta,
        action: "checkin",
        source: "webhook",
        sourceEventId: event.replyToken,
        businessKey: `checkin:${channelKey}:${event.source.userId}:${taipeiDate()}`,
      }).catch((error) => {
        if (!String(error && error.message || error).includes("UNIQUE")) throw error;
      });
      checkinEvents += 1;
    }
    monitorEvents.push(event);
  }

  if (config.monitor && monitorEvents.length) await processLineWebhook(env, config.floor, provider, { ...payload, events: monitorEvents }, { skipCheckinTemplateReply: options.skipCheckinTemplateReply === true });

  let forwarded = null;
  if (config.forwardUrl) {
    const forwardResponse = await fetch(config.forwardUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signature || "",
      },
      body: rawBody,
    });
    forwarded = { url: config.forwardUrl, status: forwardResponse.status, ok: forwardResponse.ok };
  }

  return { checkinEvents, forwarded };
}

async function upsertPointChannel(env, config) {
  await env.DB.prepare(`
    INSERT INTO line_channels (channel_key, label, forward_url)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_key) DO UPDATE SET
      label = excluded.label,
      forward_url = excluded.forward_url
  `).bind(config.channelKey, config.label, config.forwardUrl || "").run();
}

async function recordPointEvent(env, channelKey, event) {
  const lineUserId = stringValue(event && event.source && event.source.userId);
  const message = event && event.message ? event.message : {};
  const messageType = stringValue(message.type);
  const messageText = messageType === "text" ? stringValue(message.text) : "";

  await env.DB.prepare(`
    INSERT INTO webhook_events (channel_key, line_user_id, event_type, message_type, message_text, reply_token, line_timestamp, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    channelKey,
    lineUserId || null,
    stringValue(event && event.type) || null,
    messageType || null,
    messageText || null,
    stringValue(event && event.replyToken) || null,
    Number(event && event.timestamp) || null,
    JSON.stringify(event || {}),
  ).run();

  if (lineUserId) {
    await env.DB.prepare(`
      INSERT INTO line_identity_observations (channel_key, line_user_id)
      VALUES (?, ?)
      ON CONFLICT(channel_key, line_user_id)
      DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, event_count = event_count + 1
    `).bind(channelKey, lineUserId).run();
  }
}

async function tryApplyBindingCode(env, channelKey, lineUserId, text) {
  if (!lineUserId || !text) return null;
  const match = String(text).trim().match(/^(\u7d81\u5b9a|bind)\s+([A-Za-z0-9_-]{4,32})$/i);
  if (!match) return null;

  const code = match[2];
  const row = await env.DB.prepare(`
    SELECT code, master_member_ref
    FROM binding_codes
    WHERE code = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
  `).bind(code).first();
  if (!row) return null;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO member_line_links (master_member_ref, channel_key, line_user_id, binding_code)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(master_member_ref, channel_key)
      DO UPDATE SET line_user_id = excluded.line_user_id, binding_code = excluded.binding_code, linked_at = CURRENT_TIMESTAMP
    `).bind(row.master_member_ref, channelKey, lineUserId, code),
    env.DB.prepare("UPDATE binding_codes SET used_at = CURRENT_TIMESTAMP WHERE code = ?").bind(code),
  ]);
  return { code, masterMemberRef: row.master_member_ref };
}

function detectCheckinPointDelta(channelKey, text) {
  if (!text) return null;
  if (channelKey === POINT_OA1) return null;
  if (normalizeTextKeyword(text) === normalizeTextKeyword("簽到贈K點")) return null;
  if (!/\u6703\u54e1\u6253\u5361|\u6253\u5361|\u7c3d\u5230|checkin/i.test(text)) return null;
  return channelKey === POINT_OA2 ? 5 : 10;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatTaipeiDateTime(value) {
  const raw = stringValue(value);
  const parsed = Date.parse(raw.includes("T") || /Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(parsed)) return raw || "-";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(parsed)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
function formatWetwLocalDateTime(value) {
  const raw = stringValue(value).trim();
  if (!raw) return "-";
  if (/Z|[+-]\d{2}:?\d{2}$/.test(raw)) return formatTaipeiDateTime(raw);
  const match = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (match) {
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    const hour = (match[4] || "00").padStart(2, "0");
    const minute = (match[5] || "00").padStart(2, "0");
    return `${month}/${day} ${hour}:${minute}`;
  }
  return raw;
}

async function createBindingCode(request, env) {
  const body = await safeJson(request);
  const masterMemberRef = stringValue(body.master_member_ref || body.memberRef || body.member_ref);
  if (!masterMemberRef) throw httpError("master_member_ref is required", 400);
  const code = stringValue(body.code) || crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const ttlMinutes = clampNumber(body.ttl_minutes || body.ttlMinutes || 60, 1, 10080);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT OR REPLACE INTO binding_codes (code, master_member_ref, expires_at)
    VALUES (?, ?, ?)
  `).bind(code, masterMemberRef, expiresAt).run();

  return {
    code,
    master_member_ref: masterMemberRef,
    expires_at: expiresAt,
    instructions: [`\u7d81\u5b9a ${code}`, `bind ${code}`],
  };
}

async function listPointObservations(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const limit = clampNumber(url.searchParams.get("limit") || 50, 1, 200);
  if (channelKey) {
    const rows = await env.DB.prepare(`
      SELECT channel_key, line_user_id, first_seen_at, last_seen_at, event_count
      FROM line_identity_observations
      WHERE channel_key = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).bind(channelKey, limit).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT channel_key, line_user_id, first_seen_at, last_seen_at, event_count
    FROM line_identity_observations
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
}

async function listPointMemberLinks(env, url) {
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 50, 1, 200);
  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT master_member_ref, channel_key, line_user_id, binding_code, linked_at
      FROM member_line_links
      WHERE master_member_ref = ?
      ORDER BY linked_at DESC
    `).bind(masterMemberRef).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT master_member_ref, channel_key, line_user_id, binding_code, linked_at
    FROM member_line_links
    ORDER BY linked_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
}

async function bindPointLineUser(env, body) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const chatLineUserId = stringValue(body.chat_line_user_id || body.chatLineUserId || body.chat_user_id || body.chatUserId);
  let pointLineUserId = stringValue(body.point_line_user_id || body.pointLineUserId || body.line_user_id || body.lineUserId);
  const channelKey = stringValue(body.channel_key || body.channelKey || POINT_OA1);
  const userName = stringValue(body.user_name || body.userName || body.name);
  let masterMemberRef = stringValue(body.master_member_ref || body.masterMemberRef);
  if (!chatLineUserId) throw httpError("chat_line_user_id is required", 400);
  if (!POINT_CHANNELS.has(channelKey)) throw httpError("Unsupported point source", 400);

  let member = null;
  if (masterMemberRef) {
    member = await env.DB.prepare(`
      SELECT member_ref, name, source_json
      FROM crm_members
      WHERE member_ref = ?
      LIMIT 1
    `).bind(masterMemberRef).first();
    if (!member) throw httpError("找不到指定母站會員，請先同步會員或重新搜尋。", 404);
    pointLineUserId = pointLineUserId || crmLineUserId(member);
  }
  if (!pointLineUserId) throw httpError("找不到此會員的母站 LINE ID，請先同步母站會員資料。", 400);

  const existingSource = await env.DB.prepare(`
    SELECT master_member_ref
    FROM member_line_links
    WHERE channel_key = ? AND line_user_id = ?
    LIMIT 1
  `).bind(channelKey, pointLineUserId).first();

  masterMemberRef = existingSource && existingSource.master_member_ref
    ? stringValue(existingSource.master_member_ref)
    : masterMemberRef;

  let snapshot = null;
  if (!masterMemberRef) {
    try {
      snapshot = await fetchWetwPointSnapshot(env, channelKey, pointLineUserId, "gift_money", 5);
      const first = Array.isArray(snapshot.rows) ? snapshot.rows.find((row) => row && (row.user_id || row.member_ref || row.master_member_ref)) : null;
      masterMemberRef = stringValue(first && (first.user_id || first.member_ref || first.master_member_ref));
    } catch (_err) {
      // Manual binding is still allowed. Some valid members have no point rows yet.
    }
  }
  if (!masterMemberRef) masterMemberRef = `manual:${shortHash(`${channelKey}:${pointLineUserId}`)}`;

  await env.DB.prepare(`
    DELETE FROM member_line_links
    WHERE channel_key = 'chat' AND line_user_id = ? AND master_member_ref <> ?
  `).bind(chatLineUserId, masterMemberRef).run();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO member_line_links (master_member_ref, channel_key, line_user_id, binding_code, linked_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(master_member_ref, channel_key) DO UPDATE SET
        line_user_id = excluded.line_user_id,
        binding_code = excluded.binding_code,
        linked_at = CURRENT_TIMESTAMP
    `).bind(masterMemberRef, "chat", chatLineUserId, `manual-chat:${channelKey}`),
    env.DB.prepare(`
      INSERT INTO member_line_links (master_member_ref, channel_key, line_user_id, binding_code, linked_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(master_member_ref, channel_key) DO UPDATE SET
        line_user_id = excluded.line_user_id,
        binding_code = excluded.binding_code,
        linked_at = CURRENT_TIMESTAMP
    `).bind(masterMemberRef, channelKey, pointLineUserId, `manual-point:${chatLineUserId}`),
  ]);

  if (userName) {
    await env.DB.prepare(`
      INSERT INTO crm_members (member_ref, name, source, source_json, created_at, updated_at)
      VALUES (?, ?, 'manual-bind', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(member_ref) DO UPDATE SET
        name = CASE WHEN crm_members.name IS NULL OR crm_members.name = '' THEN excluded.name ELSE crm_members.name END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(masterMemberRef, userName, JSON.stringify({ LINE_user_id: pointLineUserId, chat_line_user_id: chatLineUserId, channel_key: channelKey })).run();
  }

  return {
    master_member_ref: masterMemberRef,
    chat_line_user_id: chatLineUserId,
    point_line_user_id: pointLineUserId,
    channel_key: channelKey,
    checked_rows: snapshot && Array.isArray(snapshot.rows) ? snapshot.rows.length : null,
  };
}

async function hasLocalGiftMoneyPointAccount(env, channelKey, lineUserId) {
  if (!env.DB || !channelKey || !lineUserId) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM point_accounts WHERE channel_key = ? AND line_user_id = ? AND point_type = 'gift_money' LIMIT 1"
  ).bind(channelKey, lineUserId).first();
  return Boolean(row && row.ok);
}
async function pointMutation(env, body, action) {
  const channelKey = stringValue(body.channel_key || body.channelKey);
  let lineUserId = stringValue(body.line_user_id || body.lineUserId || body.userId);
  const chatLineUserId = stringValue(body.chat_line_user_id || body.chatLineUserId);
  const userName = stringValue(body.user_name || body.userName || body.name);
  const points = Math.abs(Number(body.points || body.point_delta || body.pointDelta));
  if (!channelKey || !lineUserId || !points) throw httpError("channel_key, line_user_id, and points are required", 400);
  if (!POINT_CHANNELS.has(channelKey)) throw httpError("Unsupported point source", 400);
  let resolvedIdentity = null;
  if (chatLineUserId && chatLineUserId === lineUserId) {
    const resolvedName = userName || await pointUserNameFromChatUserId(env, chatLineUserId);
    resolvedIdentity = await resolvePointIdentity(env, { chatLineUserId, userName: resolvedName }).catch(() => null);
    const sourceLineUserId = resolvedIdentity && resolvedIdentity.channelLineUserIds ? stringValue(resolvedIdentity.channelLineUserIds[channelKey]) : "";
    if (sourceLineUserId) lineUserId = sourceLineUserId;
  }
  if (chatLineUserId && chatLineUserId === lineUserId) {
    const exactSnapshot = await fetchWetwPointSnapshot(env, channelKey, lineUserId, "gift_money", 1, body).catch(() => null);
    const hasWetwRows = exactSnapshot && Array.isArray(exactSnapshot.rows) && exactSnapshot.rows.length;
    const hasLocalAccount = hasWetwRows ? true : await hasLocalGiftMoneyPointAccount(env, channelKey, lineUserId);
    const hasResolvedMember = Boolean(resolvedIdentity && (resolvedIdentity.memberRef || resolvedIdentity.pointLineUserId));
    if (!hasLocalAccount && !hasResolvedMember) {
      throw httpError(`此聊天室 UID 不是${pointSourceMeta(channelKey)?.label || channelKey} 的母站 UID，請先綁定後再贈扣。`, 400);
    }
  }
  const sourceMeta = pointSourceMeta(channelKey);
  if (action === "grant" && sourceMeta && sourceMeta.canGrant === false) {
    throw httpError(`${sourceMeta.label} 來源只允許扣K點，不允許贈K點`, 400);
  }
  const operatorName = stringValue(body.operator_name || body.operatorName || body.operator || body.admin_name || body.adminName) || "dashboard";
  const operatorId = stringValue(body.operator_id || body.operatorId || body.admin_id || body.adminId) || `dashboard:${operatorName}`;
  const delta = action === "grant" ? points : -points;
  const input = {
    channelKey,
    lineUserId,
    pointType: "gift_money",
    pointDelta: delta,
    action,
    source: "admin",
    businessKey: stringValue(body.business_key || body.businessKey),
    note: stringValue(body.note),
    operatorId,
    operatorName,
  };
  return applyWetwPointMutation(env, input, body);
}

async function applyWetwPointMutation(env, input, body = {}) {
  const wetwBalanceBefore = await fetchWetwLatestPointBalance(env, input, body).catch(() => null);
  const wetw = await insertWetwPointMutation(env, input, body);
  const queriedWetwBalanceAfter = await fetchWetwLatestPointBalance(env, input, body).catch(() => null);
  const expectedWetwBalanceAfter = Number.isFinite(wetwBalanceBefore)
    ? wetwBalanceBefore + Number(input.pointDelta || 0)
    : null;
  const wetwBalanceAfter = chooseMutationBalanceAfter(input.pointDelta, queriedWetwBalanceAfter, expectedWetwBalanceAfter);
  const local = await applyPointMutation(env, {
    ...input,
    source: "wetw",
    businessKey: input.businessKey || (wetw && wetw.data && wetw.data.insert_id ? `wetw:${wetw.data.insert_id}` : ""),
    balanceAfter: wetwBalanceAfter,
    note: input.note || (wetw && wetw.message) || "",
    operatorId: input.operatorId,
    operatorName: input.operatorName,
  });
  return { ...local, wetw, wetw_balance_before: wetwBalanceBefore, wetw_balance_after: wetwBalanceAfter };
}

async function backfillMissingAutoRewards(env, body = {}) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const dryValue = body.dry_run !== undefined ? body.dry_run : body.dryRun;
  const dryRun = dryValue === undefined
    ? true
    : !(dryValue === false || ["false", "0", "no"].includes(String(dryValue).toLowerCase()));
  const limit = clampNumber(body.limit || 80, 1, 300);
  const date = stringValue(body.date || body.reward_date || body.rewardDate).slice(0, 10);
  const lineUserId = stringValue(body.line_user_id || body.lineUserId || body.userId);

  const where = [
    "channel_key = ?",
    "point_type = 'gift_money'",
    "point_delta > 0",
    "(business_key LIKE 'keyword:%' OR business_key LIKE 'qr-reward:%' OR business_key LIKE 'nfc-reward:%')",
    "business_key NOT LIKE 'backfill:%'",
  ];
  const bindings = [POINT_OA1];
  if (date) {
    where.push("date(created_at) = ?");
    bindings.push(date);
  }
  if (lineUserId) {
    where.push("line_user_id = ?");
    bindings.push(lineUserId);
  }
  bindings.push(limit);

  const rows = await env.DB.prepare(`
    SELECT id, account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, operator_id, operator_name, note, created_at
    FROM point_ledger
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...bindings).all();
  const candidates = rows.results || [];
  const checkedByUser = new Map();
  const report = {
    dry_run: dryRun,
    scanned: candidates.length,
    already_exists: 0,
    missing: 0,
    inserted: 0,
    failed: 0,
    details: [],
  };

  for (const row of candidates) {
    const marker = autoRewardMarker(row);
    const detail = {
      id: row.id,
      line_user_id: row.line_user_id,
      points: Number(row.point_delta || 0),
      business_key: row.business_key,
      note: row.note,
      marker,
      status: "",
      wetw_id: "",
      error: "",
    };
    try {
      const rows = await cachedWetwRowsForBackfill(env, checkedByUser, row.line_user_id);
      const match = findAutoRewardWetwMatch(row, rows);
      if (match) {
        report.already_exists += 1;
        detail.status = "already_exists";
        detail.wetw_id = stringValue(match.id || match.point_id || match.ledger_id);
      } else {
        report.missing += 1;
        detail.status = "missing";
        if (!dryRun) {
          const mutation = await pointMutation(env, {
            channel_key: POINT_OA1,
            line_user_id: row.line_user_id,
            point_type: "gift_money",
            points: Number(row.point_delta || 0),
            operator_id: `backfill:${row.id}`,
            operator_name: "補登K點",
            event_name: autoRewardEventName(row),
            event_content: `${marker}；補登查詢表`,
            note: `${marker}；補登查詢表`,
            business_key: `backfill:${row.business_key}`,
            shop_remark: `補登查詢表；原始紀錄ID:${row.id}；原始識別:${row.business_key}`,
          }, "grant");
          checkedByUser.delete(row.line_user_id);
          await markAutoRewardBackfilled(env, row, mutation);
          report.inserted += 1;
          detail.status = "inserted";
          detail.wetw_id = stringValue(mutation && mutation.wetw && mutation.wetw.data && mutation.wetw.data.insert_id);
        }
      }
    } catch (error) {
      report.failed += 1;
      detail.status = "failed";
      detail.error = error && error.message ? error.message : String(error);
    }
    report.details.push(detail);
  }
  return report;
}

async function markAutoRewardBackfilled(env, row, mutation) {
  const businessKey = stringValue(row && row.business_key);
  if (!businessKey.startsWith("keyword:")) return;
  const parts = businessKey.split(":");
  const keyword = stringValue(parts[1]);
  const userId = stringValue(row && row.line_user_id);
  const rewardDate = stringValue(parts[3] || row.created_at).slice(0, 10);
  if (!keyword || !userId || !rewardDate) return;
  await env.DB.prepare(`
    UPDATE daily_keyword_rewards
    SET point_ledger_id = ?, balance_after = ?, message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE keyword = ? AND line_user_id = ? AND reward_date = ?
  `).bind(
    mutation && mutation.ledger_id ? mutation.ledger_id : null,
    mutation && mutation.balance_after !== undefined ? mutation.balance_after : null,
    "backfilled_to_oa1_1086",
    keyword,
    userId,
    rewardDate,
  ).run();
}

async function repairDailyKeywordBalances(env, body = {}) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const dryValue = body.dry_run !== undefined ? body.dry_run : body.dryRun;
  const dryRun = dryValue === undefined
    ? true
    : !(dryValue === false || ["false", "0", "no"].includes(String(dryValue).toLowerCase()));
  const date = stringValue(body.date || body.reward_date || body.rewardDate || taipeiDate()).slice(0, 10);
  const lineUserId = stringValue(body.line_user_id || body.lineUserId || body.userId);
  const limit = clampNumber(body.limit || 30, 1, 100);
  const bindings = [date];
  const where = [
    "channel_key = 'oa1'",
    "point_type = 'gift_money'",
    "point_delta > 0",
    "business_key LIKE 'keyword:%'",
    "business_key NOT LIKE 'backfill:%'",
    "business_key NOT LIKE 'repair-balance:%'",
    "date(created_at) = ?",
  ];
  if (lineUserId) {
    where.push("line_user_id = ?");
    bindings.push(lineUserId);
  }
  bindings.push(limit);
  const rows = await env.DB.prepare(`
    SELECT id, line_user_id, point_delta, balance_after, business_key, note, created_at
    FROM point_ledger
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...bindings).all();
  const report = {
    dry_run: dryRun,
    date,
    scanned: 0,
    already_correct: 0,
    repaired: 0,
    failed: 0,
    details: [],
  };
  for (const row of rows.results || []) {
    const base = Number(row.balance_after || 0);
    const points = Number(row.point_delta || 0);
    const target = base + points;
    const detail = {
      id: row.id,
      line_user_id: row.line_user_id,
      base,
      points,
      target,
      current: null,
      delta: null,
      status: "",
      wetw_id: "",
      error: "",
    };
    report.scanned += 1;
    try {
      const snapshot = await fetchWetwPointSnapshot(env, POINT_OA1, row.line_user_id, "gift_money", 20);
      const current = Number(snapshot.balance || 0);
      const delta = target - current;
      detail.current = current;
      detail.delta = delta;
      if (Math.abs(delta) < 0.0001) {
        detail.status = "already_correct";
        report.already_correct += 1;
      } else if (dryRun) {
        detail.status = "needs_repair";
      } else {
        const action = delta > 0 ? "grant" : "deduct";
        const mutation = await pointMutation(env, {
          channel_key: POINT_OA1,
          line_user_id: row.line_user_id,
          point_type: "gift_money",
          points: Math.abs(delta),
          operator_id: `repair:${row.id}`,
          operator_name: "簽到K點餘額修正",
          event_name: "簽到K點餘額修正",
          event_content: `回溯當下K點 ${formatPoint(base)} + ${formatPoint(points)} = ${formatPoint(target)}`,
          note: `回溯當下K點 ${formatPoint(base)} + ${formatPoint(points)} = ${formatPoint(target)}`,
          business_key: `repair-balance:${row.business_key}`,
          shop_remark: `簽到餘額修正；原始紀錄ID:${row.id}；目標餘額:${formatPoint(target)}`,
        }, action);
        await markKeywordBalanceRepaired(env, row, target, mutation);
        detail.status = "repaired";
        detail.wetw_id = stringValue(mutation && mutation.wetw && mutation.wetw.data && mutation.wetw.data.insert_id);
        report.repaired += 1;
      }
    } catch (error) {
      detail.status = "failed";
      detail.error = error && error.message ? error.message : String(error);
      report.failed += 1;
    }
    report.details.push(detail);
  }
  return report;
}

async function markKeywordBalanceRepaired(env, row, target, mutation) {
  const businessKey = stringValue(row && row.business_key);
  const parts = businessKey.split(":");
  const keyword = stringValue(parts[1]);
  const userId = stringValue(row && row.line_user_id);
  const rewardDate = stringValue(parts[3] || row.created_at).slice(0, 10);
  if (!keyword || !userId || !rewardDate) return;
  await env.DB.prepare(`
    UPDATE daily_keyword_rewards
    SET point_ledger_id = ?, balance_after = ?, message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE keyword = ? AND line_user_id = ? AND reward_date = ?
  `).bind(
    mutation && mutation.ledger_id ? mutation.ledger_id : null,
    target,
    "repaired_to_event_base_plus_points",
    keyword,
    userId,
    rewardDate,
  ).run();
}

async function cachedWetwRowsForBackfill(env, cache, lineUserId) {
  const key = stringValue(lineUserId);
  if (!cache.has(key)) {
    const snapshot = await fetchWetwPointSnapshot(env, POINT_OA1, key, "gift_money", 100);
    cache.set(key, snapshot.rows || []);
  }
  return cache.get(key) || [];
}

function autoRewardMarker(row) {
  const note = stringValue(row && row.note);
  if (note) return note;
  const key = stringValue(row && row.business_key);
  if (key.startsWith("keyword:")) {
    const parts = key.split(":");
    return parts[3] ? `每日簽到 ${parts[3]}` : "每日簽到";
  }
  if (key.startsWith("qr-reward:")) return `QR掃碼活動 ${key.split(":")[1] || ""}`.trim();
  if (key.startsWith("nfc-reward:")) return `NFC感應活動 ${key.split(":")[1] || ""}`.trim();
  return key;
}

function autoRewardEventName(row) {
  const key = stringValue(row && row.business_key);
  if (key.startsWith("keyword:")) return "簽到贈K點補登";
  if (key.startsWith("nfc-reward:")) return "NFC感應贈K點補登";
  return "QR掃碼贈K點補登";
}

function findAutoRewardWetwMatch(row, wetwRows) {
  const marker = kPointDisplayText(autoRewardMarker(row));
  const businessKey = stringValue(row && row.business_key);
  const amount = Number(row && row.point_delta || 0);
  const createdDay = stringValue(row && row.created_at).slice(0, 10);
  return (wetwRows || []).find((item) => {
    const delta = Number(item.get_point ?? item.point_delta ?? 0);
    if (Number.isFinite(amount) && Number.isFinite(delta) && Math.abs(delta - amount) > 0.0001) return false;
    const text = kPointDisplayText([
      item.event_name,
      item.event_content,
      item.shop_remark,
      item.note,
    ].map(stringValue).filter(Boolean).join("｜"));
    const itemDay = stringValue(item.created_at || item.createdAt || item.date || item.datetime).slice(0, 10);
    if (businessKey && text.includes(businessKey)) return true;
    if (marker && text.includes(marker)) return true;
    if (businessKey.startsWith("keyword:") && text.includes("每日簽到") && createdDay && itemDay === createdDay) return true;
    const campaign = businessKey.match(/^(?:qr|nfc)-reward:([^:]+)/);
    if (campaign && text.includes(campaign[1])) return true;
    return false;
  }) || null;
}

function chooseMutationBalanceAfter(delta, queriedBalance, expectedBalance) {
  const queried = Number(queriedBalance);
  const expected = Number(expectedBalance);
  const hasQueried = Number.isFinite(queried);
  const hasExpected = Number.isFinite(expected);
  if (!hasQueried) return hasExpected ? expected : null;
  if (!hasExpected) return queried;
  const change = Number(delta || 0);
  if (change > 0 && queried < expected) return expected;
  if (change < 0 && queried > expected) return expected;
  return queried;
}

async function claimQrReward(env, body) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  let campaign = normalizeCampaign(body.campaign || "smart_202605");
  const entryMethod = normalizeRewardEntry(body.entry || body.entry_method || body.source || "qr");
  const idToken = stringValue(body.idToken || body.id_token);
  if (!idToken) throw httpError("LINE 授權資訊不足，請用 LINE 重新開啟領取頁面", 400);

  const lineProfile = await verifyLineIdToken(env, idToken);
  const lineUserId = stringValue(lineProfile.sub || lineProfile.userId);
  if (!lineUserId) throw httpError("無法取得 LINE UID", 400);

  const calendarContext = campaign === REWARD_CALENDAR_AUTO
    ? await resolveCalendarRewardContext(env, body)
    : (isNfcTestCampaign(campaign) ? await resolveNfcTestRewardContext(env, campaign, body) : null);
  if (calendarContext) campaign = calendarContext.campaign;
  const points = calendarContext ? calendarContext.points : rewardPointsForCampaign(campaign);
  const existing = await env.DB.prepare(`
    SELECT id, status, points, created_at
    FROM reward_claims
    WHERE campaign = ? AND line_user_id = ?
  `).bind(campaign, lineUserId).first();
  if (existing) {
    const snapshot = await fetchWetwPointSnapshot(env, POINT_OA1, lineUserId, "gift_money", 10);
    return {
      claimed: false,
      duplicate: true,
      campaign,
      line_user_id: lineUserId,
      points: Number(existing.points || points),
      balance_after: snapshot.balance,
      message: "這個活動已經領取過",
      event: calendarContext ? publicCalendarEvent(calendarContext.event, Date.now(), null, env) : null,
    };
  }

  const insert = await env.DB.prepare(`
    INSERT INTO reward_claims (campaign, line_user_id, channel_key, points, status, event_uid, event_title, location_name, user_lat, user_lng, distance_meters, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    campaign,
    lineUserId,
    POINT_OA1,
    points,
    "pending",
    calendarContext ? calendarContext.event.uid : "",
    calendarContext ? calendarContext.event.summary : "",
    calendarContext ? calendarContext.event.location : "",
    calendarContext ? calendarContext.userLat : null,
    calendarContext ? calendarContext.userLng : null,
    calendarContext ? calendarContext.distanceMeters : null,
  ).run();
  const claimId = insert && insert.meta && insert.meta.last_row_id ? insert.meta.last_row_id : null;

  try {
    const entryLabel = rewardEntryLabel(entryMethod);
    const eventNote = calendarContext
      ? `${entryLabel}；內建行事曆活動：${calendarContext.event.summary}；地點：${calendarContext.event.location || "未填"}`
      : `${entryLabel} ${campaign}`;
    const mutation = await pointMutation(env, {
      channel_key: POINT_OA1,
      line_user_id: lineUserId,
      point_type: "gift_money",
      points,
      operator_id: `${entryMethod}:${campaign}`,
      operator_name: `${entryLabel}自動贈K點`,
      event_name: `${entryLabel}贈K點`,
      event_content: eventNote,
      note: eventNote,
      business_key: `${entryMethod}-reward:${campaign}:${lineUserId}`,
    }, "grant");
    await env.DB.prepare(`
      UPDATE reward_claims
      SET status = ?, point_ledger_id = ?, balance_after = ?, message = ?
      WHERE id = ?
    `).bind("success", mutation.ledger_id || null, mutation.balance_after || null, "claimed", claimId).run();
    return {
      claimed: true,
      duplicate: false,
      campaign,
      line_user_id: lineUserId,
      display_name: stringValue(lineProfile.name),
      picture_url: stringValue(lineProfile.picture),
      points,
      balance_after: mutation.balance_after,
      message: `已領取 ${points} K點`,
      event: calendarContext ? publicCalendarEvent(calendarContext.event, Date.now(), calendarContext, env) : null,
    };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE reward_claims
      SET status = ?, message = ?
      WHERE id = ?
    `).bind("failed", error.message || String(error), claimId).run();
    throw error;
  }
}

async function recordRewardClientLog(env, request, body) {
  if (!env.DB) return { recorded: false };
  const campaign = normalizeCampaign(body.campaign || "");
  const entry = normalizeRewardEntry(body.entry || "");
  const stage = stringValue(body.stage).slice(0, 80);
  const lineUserId = stringValue(body.line_user_id || body.lineUserId).slice(0, 96);
  const isInClient = body.is_in_client || body.isInClient ? 1 : 0;
  const message = stringValue(body.message || body.error).slice(0, 500);
  const userAgent = stringValue(request.headers.get("User-Agent")).slice(0, 500);
  await env.DB.prepare(`
    INSERT INTO reward_client_logs (campaign, entry, stage, line_user_id, is_in_client, message, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(campaign, entry, stage, lineUserId, isInClient, message, userAgent).run();
  return { recorded: true };
}

function redirectToRewardLiff(env, campaign, entry, extraParams = {}) {
  return Response.redirect(buildRewardLiffUrl(env, campaign, entry, extraParams), 302);
}

function buildRewardLiffUrl(env, campaign, entry, extraParams = {}) {
  const normalizedEntry = normalizeRewardEntry(entry || "qr");
  const liffId = normalizedEntry === "nfc" || normalizedEntry === "checkin"
    ? (stringValue(env.REWARD_NFC_LIFF_ID) || REWARD_NFC_LIFF_ID)
    : (stringValue(env.REWARD_LIFF_ID) || REWARD_LIFF_ID);
  const target = new URL(`https://liff.line.me/${encodeURIComponent(liffId)}`);
  target.searchParams.set("campaign", normalizeCampaign(campaign));
  target.searchParams.set("entry", normalizedEntry);
  for (const [key, value] of Object.entries(extraParams || {})) {
    if (["event", "eventUid", "location", "site"].includes(key) && stringValue(value)) target.searchParams.set(key, stringValue(value));
  }
  return target.toString();
}

function buildRewardLineAppUrl(env, campaign, entry) {
  const normalizedEntry = normalizeRewardEntry(entry || "qr");
  const liffId = normalizedEntry === "nfc" || normalizedEntry === "checkin"
    ? (stringValue(env.REWARD_NFC_LIFF_ID) || REWARD_NFC_LIFF_ID)
    : (stringValue(env.REWARD_LIFF_ID) || REWARD_LIFF_ID);
  const target = new URL(`line://app/${encodeURIComponent(liffId)}`);
  target.searchParams.set("campaign", normalizeCampaign(campaign));
  target.searchParams.set("entry", normalizedEntry);
  return target.toString();
}

function normalizeRewardEntry(value) {
  const text = stringValue(value || "qr").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return text || "qr";
}

function rewardEntryLabel(value) {
  const entry = normalizeRewardEntry(value);
  if (entry === "nfc") return "NFC感應";
  if (entry === "checkin") return "課程報到";
  if (entry === "calendar") return "日曆定位";
  return "QR掃碼";
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function rewardNfcInstructionsHtml(request, env, corsHeaders) {
  const origin = new URL(request.url).origin;
  const nfcUrl = `${origin}/r/nfc`;
  const fixedUrl = `${origin}/r/nfc5`;
  const liffUrl = buildRewardLiffUrl(env, "calendar_auto", "nfc");
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>康立智能 NFC 感應贈K點</title>
  <style>
    :root{--line:#06c755;--ink:#101828;--sub:#667085;--border:#d8e0eb}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f6faf8;color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif}
    main{width:min(820px,100%);margin:0 auto;padding:32px 18px}.hero,.card{border:1px solid var(--border);border-radius:22px;background:#fff;padding:24px;box-shadow:0 18px 50px rgba(16,24,40,.08)}
    .brand{display:flex;align-items:center;gap:14px}.mark{width:58px;height:58px;border-radius:18px;background:var(--line);display:grid;place-items:center;color:#fff;font-weight:900;font-size:22px}
    h1{margin:0;font-size:28px}h2{margin:0 0 10px;font-size:18px}p{color:var(--sub);line-height:1.7}.urlBox{margin:18px 0;border:1px solid #b7ebc7;background:#f2fff7;border-radius:16px;padding:16px}
    code{display:block;word-break:break-all;color:#064e2a;font-weight:900;font-size:16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}
    ol{margin:0;padding-left:20px;color:#344054;line-height:1.8}a.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:14px;border-radius:999px;background:var(--line);color:#fff;text-decoration:none;font-weight:900;padding:0 18px}
    .muted{font-size:14px;color:#8a95a6}.warn{border-color:#ffd9a8;background:#fffaf2}@media(max-width:720px){.grid{grid-template-columns:1fr}main{padding:18px 12px}.hero,.card{padding:20px}h1{font-size:24px}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="brand"><div class="mark">KL</div><div><h1>康立智能 NFC 感應贈K點</h1><p>把短網址寫入 NFC Tag。會員手機感應後會開啟 LINE LIFF，系統依內建行事曆活動時間、地點與手機定位自動判定是否發放 K點。</p></div></div>
      <div class="urlBox"><strong>NFC Tag 建議寫入網址</strong><code>${escapeHtml(nfcUrl)}</code></div>
      <a class="button" href="${escapeHtml(nfcUrl)}">測試 NFC 入口</a>
      <p class="muted">實際會轉到 LIFF：<br>${escapeHtml(liffUrl)}</p>
    </section>
    <section class="grid">
      <div class="card"><h2>NFC 寫入流程</h2><ol><li>手機安裝 NFC Tools 或同類型 NFC 寫入工具。</li><li>選擇 Write / Add a record / URL。</li><li>貼上上方短網址。</li><li>靠近 NFC Tag 寫入。</li><li>用另一支手機感應測試。</li></ol></div>
      <div class="card"><h2>發點判定流程</h2><ol><li>會員感應 NFC。</li><li>LINE LIFF 驗證會員 UID。</li><li>系統讀取內建行事曆目前進行中的活動。</li><li>手機定位在活動地點範圍內才發放 K點。</li><li>同一活動同一會員只可領取一次。</li></ol></div>
      <div class="card warn"><h2>備用固定 10 K點入口</h2><p>如果某場活動暫時不使用日曆定位，可寫入固定活動入口。</p><code>${escapeHtml(fixedUrl)}</code></div>
    </section>
  </main>
</body>
</html>`, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function rewardCompactNfcLiffHtml(env, corsHeaders) {
  const liffId = stringValue(env.REWARD_NFC_LIFF_ID) || REWARD_NFC_LIFF_ID;
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>課程報到</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root{--line:#06c755;--ink:#111827;--muted:#667085;--red:#e11d48}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fff;color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif}
    body{display:grid;place-items:center;padding:22px;padding-top:calc(22px + env(safe-area-inset-top));padding-bottom:calc(22px + env(safe-area-inset-bottom))}
    main{width:min(300px,100%);text-align:center}.spinner{width:34px;height:34px;margin:0 auto 16px;border:4px solid #dff7e9;border-top-color:var(--line);border-radius:50%;animation:spin .8s linear infinite}
    h1{margin:0;font-size:22px;line-height:1.35;font-weight:900}p{margin:10px 0 0;color:var(--muted);font-size:15px;line-height:1.6}
    .packet{width:92px;height:112px;margin:0 auto 18px;border-radius:18px 18px 26px 26px;background:linear-gradient(180deg,#ff3b30,#c1121f);position:relative;box-shadow:0 18px 42px rgba(225,29,72,.25)}
    .packet:before{content:"";position:absolute;left:50%;top:40px;width:42px;height:42px;border-radius:50%;background:#ffd166;transform:translateX(-50%)}.packet:after{content:"5";position:absolute;left:50%;top:44px;transform:translateX(-50%);font-weight:900;font-size:24px;color:#8a1c13}
    .mark{width:62px;height:62px;margin:0 auto 18px;border-radius:18px;background:var(--red);display:grid;place-items:center;color:#fff;font-size:24px;font-weight:900;box-shadow:0 16px 38px rgba(225,29,72,.18)}
    .locations{display:none;margin-top:18px;gap:10px;grid-template-columns:1fr 1fr}.locations.active{display:grid}.choice{appearance:none;border:1px solid #d6e2ef;background:#fff;color:#111827;border-radius:16px;min-height:52px;font-size:17px;font-weight:900;box-shadow:0 8px 24px rgba(16,24,40,.06)}
    .choice.primary{background:var(--line);border-color:var(--line);color:#fff}.choice.other{grid-column:1 / -1}
    .hidden{display:none}.error h1{color:var(--red)}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main id="app">
    <div id="loadingIcon" class="spinner"></div>
    <div id="successIcon" class="packet hidden"></div>
    <div id="plainIcon" class="mark hidden">KL</div>
    <h1 id="title">請稍後，系統處理中</h1>
    <p id="message">正在確認課程時間</p>
    <div id="locationPanel" class="locations">
      <button class="choice primary" data-location="taipei" type="button">台北</button>
      <button class="choice primary" data-location="taichung" type="button">台中</button>
      <button class="choice primary" data-location="kaohsiung" type="button">高雄</button>
      <button class="choice other" data-location="other" type="button">其他</button>
    </div>
  </main>
  <script>
    const API_BASE = "https://mlm.fangwl591021.workers.dev";
    const LIFF_ID = ${JSON.stringify(liffId)};
    const CLOSE_DELAY_MS = 2400;
    const params = mergedParams();
    const campaign = params.get("campaign") || "calendar_auto";
    const entry = params.get("entry") || "nfc";
    const eventUid = params.get("event") || params.get("eventUid") || "";
    const isCourseCheckin = entry === "checkin" || entry === "calendar";
    let selectedLocation = params.get("location") || params.get("site") || "";
    const appEl = document.getElementById("app");
    const titleEl = document.getElementById("title");
    const messageEl = document.getElementById("message");
    const loadingIconEl = document.getElementById("loadingIcon");
    const successIconEl = document.getElementById("successIcon");
    const plainIconEl = document.getElementById("plainIcon");
    const locationPanelEl = document.getElementById("locationPanel");
    locationPanelEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-location]");
      if(!button) return;
      selectedLocation = button.dataset.location || "";
      claim();
    });
    boot();
    function mergedParams(){
      const params = new URLSearchParams(location.search);
      const state = params.get("liff.state");
      if(state){
        const stateParams = new URLSearchParams(state.charAt(0) === "?" ? state.slice(1) : state);
        stateParams.forEach((value, key) => params.set(key, value));
      }
      return params;
    }
    async function boot(){
      try{
        await logStage("page_loaded", "");
        await liff.init({ liffId: LIFF_ID });
        await logStage("liff_ready", "isInClient=" + liff.isInClient());
        if(!liff.isInClient()){
          await logStage("not_in_line_client", "Opened outside LINE app");
          showOutsideLine();
          return;
        }
        if(!liff.isLoggedIn()){
          await logStage("login_redirect", "");
          liff.login({ redirectUri: location.href });
          return;
        }
        // Fixed calendar check-in no longer asks for branch/location selection.
        await claim();
      }catch(error){
        await logStage("boot_error", error && error.message ? error.message : String(error));
        showClosed();
      }
    }
    async function claim(){
      showLoading();
      const idToken = liff.getIDToken();
      if(!idToken) throw new Error("missing token");
      let claimBody = { campaign, entry, eventUid, event:eventUid, idToken };
      if(!(isCourseCheckin && campaign === "calendar_auto")){
        await logStage("before_geolocation", "");
        const position = await getCurrentPosition();
        await logStage("geolocation_ok", "accuracy=" + position.coords.accuracy);
        claimBody = { ...claimBody, location:selectedLocation, checkinLocation:selectedLocation, lat:position.coords.latitude, lng:position.coords.longitude, accuracy:position.coords.accuracy };
      } else {
        await logStage("calendar_checkin_no_location", "");
      }
      const response = await fetch(API_BASE + "/api/reward/claim", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify(claimBody)
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || data.status !== "success"){
        await logStage("claim_failed", data.message || response.status);
        showClosed(data.message || "");
        return;
      }
      await logStage("claim_success", data.duplicate ? "duplicate" : "claimed", data.line_user_id);
      showSuccess(data);
    }
    function showLoading(){
      appEl.classList.remove("error");
      locationPanelEl.classList.remove("active");
      loadingIconEl.classList.remove("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.add("hidden");
      titleEl.textContent = "請稍後，系統處理中"; messageEl.textContent = isCourseCheckin ? "正在確認課程與報名時間" : "正在確認課程時間";
    }
    function showLocationPicker(){
      appEl.classList.remove("error");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.remove("hidden");
      locationPanelEl.classList.add("active");
      titleEl.textContent = "選擇報到地點"; messageEl.textContent = "台北、台中、高雄使用公司定位；其他請先在聊天室輸入報到點並傳送 LINE 位置";
    }
    function showSuccess(data){
      const duplicate = data && data.duplicate;
      const eventTitle = data && data.event && data.event.title ? data.event.title : "";
      const points = data && data.points ? data.points : 10;
      appEl.classList.remove("error");
      locationPanelEl.classList.remove("active");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.remove("hidden"); plainIconEl.classList.add("hidden");
      if(isCourseCheckin){
        titleEl.textContent = duplicate ? "本課程已完成報到" : "課程報到成功";
        messageEl.textContent = duplicate ? (eventTitle || "您已完成本課程報到") : ((eventTitle ? eventTitle + "｜" : "") + "已發送 " + points + "點");
      }else{
        titleEl.textContent = duplicate ? "已領取過本課程紅包" : "紅包已送出";
        messageEl.textContent = duplicate ? "本課程已完成領取" : "已發送 " + points + " K點";
      }
      closeSoon();
    }
    function showClosed(reason){
      appEl.classList.add("error");
      locationPanelEl.classList.remove("active");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.remove("hidden");
      titleEl.textContent = reason || "目前非課程時間，請查看行事曆"; messageEl.textContent = reason ? "請確認測試網址、時間或定位設定" : ""; closeSoon();
    }
    function showOutsideLine(){
      appEl.classList.add("error");
      locationPanelEl.classList.remove("active");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.remove("hidden");
      titleEl.textContent = "請使用 LINE 開啟"; messageEl.textContent = isCourseCheckin ? "請從官方帳號內點選課程報到" : "NFC 請寫入 LIFF 網址，不要寫入一般網頁短網址";
    }
    function closeSoon(){ setTimeout(() => { if(window.liff && liff.isInClient()) liff.closeWindow(); else window.close(); }, CLOSE_DELAY_MS); }
    function getCurrentPosition(){
      if(!navigator.geolocation) return Promise.reject(new Error("no geolocation"));
      return new Promise((resolve,reject) => navigator.geolocation.getCurrentPosition(resolve, async (error) => {
        await logStage("geolocation_failed", error && error.message ? error.message : String(error));
        reject(error);
      },{ enableHighAccuracy:true, timeout:12000, maximumAge:0 }));
    }
    function logStage(stage, message, lineUserId){
      return fetch(API_BASE + "/api/reward/client-log", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ campaign, entry, stage, message, line_user_id: lineUserId || "", is_in_client: Boolean(window.liff && liff.isInClient && liff.isInClient()) })
      }).catch(() => null);
    }
  </script>
</body>
</html>`, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function pointsTallLiffHtml(env, corsHeaders) {
  const liffId = stringValue(env.POINTS_LIFF_ID || env.REWARD_LIFF_ID) || POINTS_LIFF_ID;
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>會員點數列表</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root{--ink:#20252d;--muted:#667085;--line:#06c755;--border:#d9dee7;--head:#f5f5f6;--row:#fbfbfc}
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;background:#fff;color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif}
    body{padding:22px 18px calc(22px + env(safe-area-inset-bottom))}
    .wrap{max-width:1180px;margin:0 auto}
    h1{font-size:26px;line-height:1.25;margin:0 0 34px;font-weight:900;letter-spacing:0}
    .member{font-size:20px;font-weight:800;margin:0 0 20px}
    .summary{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 18px}
    .pill{border:1px solid #ccefd9;background:#f0fff6;color:#04783a;border-radius:999px;padding:8px 13px;font-size:14px;font-weight:800}
    .tableWrap{border:1px solid var(--border);overflow:auto;max-height:calc(100vh - 172px);background:#fff}
    table{width:100%;min-width:980px;border-collapse:collapse;table-layout:fixed;font-size:16px}
    th,td{border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:14px 12px;text-align:center;vertical-align:middle;line-height:1.35}
    th{position:sticky;top:0;background:var(--head);font-weight:900;z-index:1}
    tr:nth-child(even) td{background:var(--row)}
    th:nth-child(1),td:nth-child(1){width:130px}
    th:nth-child(2),td:nth-child(2){width:220px}
    th:nth-child(3),td:nth-child(3){width:190px}
    th:nth-child(4),td:nth-child(4){width:280px}
    th:nth-child(5),td:nth-child(5){width:130px}
    .amount{font-weight:900}.pos{color:#087a3a}.neg{color:#be123c}
    .state{min-height:240px;display:grid;place-items:center;text-align:center;color:var(--muted);font-size:16px}
    .spinner{width:34px;height:34px;border-radius:50%;border:4px solid #dff7e9;border-top-color:var(--line);animation:spin .8s linear infinite;margin:0 auto 14px}
    .hidden{display:none}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:720px){
      body{padding:18px 14px calc(18px + env(safe-area-inset-bottom))}
      h1{font-size:24px;margin-bottom:24px}.member{font-size:18px}
      .tableWrap{max-height:calc(100vh - 154px)}
      table{font-size:15px;min-width:900px}
      th,td{padding:12px 10px}
    }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>會員點數列表</h1>
    <p class="member">會員名稱：<span id="memberName">讀取中</span></p>
    <div class="summary"><span class="pill">目前點數 <span id="balance">0點</span></span><span class="pill">最近紀錄 <span id="count">0筆</span></span></div>
    <section id="loading" class="state"><div><div class="spinner"></div><div>正在讀取點數紀錄</div></div></section>
    <section id="empty" class="state hidden">目前沒有點數紀錄</section>
    <section id="tableWrap" class="tableWrap hidden">
      <table>
        <thead><tr><th>本次異動</th><th>活動名稱</th><th>日期時間</th><th>活動內容</th><th>消費店家</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
  <script>
    const API_BASE = "https://mlm.fangwl591021.workers.dev";
    const LIFF_ID = ${JSON.stringify(liffId)};
    const TOKEN_REFRESH_KEY = "klink_points_token_refresh:" + LIFF_ID;
    const memberNameEl = document.getElementById("memberName");
    const balanceEl = document.getElementById("balance");
    const countEl = document.getElementById("count");
    const loadingEl = document.getElementById("loading");
    const emptyEl = document.getElementById("empty");
    const tableWrapEl = document.getElementById("tableWrap");
    const rowsEl = document.getElementById("rows");
    boot();
    async function boot(){
      try{
        await liff.init({ liffId: LIFF_ID });
        if(!liff.isLoggedIn()){ liff.login({ redirectUri: location.href }); return; }
        const profile = await liff.getProfile().catch(() => null);
        const idToken = liff.getIDToken();
        if(!idToken) throw new Error("missing id token");
        const response = await fetch(API_BASE + "/api/points/member-ledger", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ idToken, displayName: profile && profile.displayName ? profile.displayName : "" })
        });
        const data = await response.json();
        if(!response.ok || data.status !== "success"){
          const apiError = new Error(data.message || "讀取失敗");
          apiError.code = data.code || "";
          apiError.httpStatus = response.status;
          throw apiError;
        }
        sessionStorage.removeItem(TOKEN_REFRESH_KEY);
        render(data);
      }catch(error){
        if(isExpiredTokenError(error) && !sessionStorage.getItem(TOKEN_REFRESH_KEY)){
          sessionStorage.setItem(TOKEN_REFRESH_KEY, "1");
          loadingEl.classList.remove("hidden");
          emptyEl.classList.add("hidden");
          loadingEl.innerHTML = "<div><div class='spinner'></div><div>LINE 登入逾時，正在重新驗證</div></div>";
          try{ if(window.liff && liff.isLoggedIn()) liff.logout(); }catch(_err){}
          liff.login({ redirectUri: cleanRedirectUrl() });
          return;
        }
        loadingEl.classList.add("hidden");
        emptyEl.classList.remove("hidden");
        emptyEl.textContent = error && error.message ? error.message : "點數紀錄讀取失敗";
      }
    }
    function render(data){
      loadingEl.classList.add("hidden");
      memberNameEl.textContent = data.memberName || "會員";
      balanceEl.textContent = formatPoint(data.balance || 0);
      countEl.textContent = (data.items || []).length + "筆";
      if(!data.items || !data.items.length){ emptyEl.classList.remove("hidden"); return; }
      rowsEl.innerHTML = data.items.map((item, index) => {
        const amountClass = Number(item.amount || 0) >= 0 ? "pos" : "neg";
        return "<tr>" +
          "<td class='amount " + amountClass + "'>" + esc(formatMovement(item.amount)) + "</td>" +
          "<td>" + esc(item.eventName) + "</td>" +
          "<td>" + esc(item.datetime) + "</td>" +
          "<td>" + esc(item.eventContent) + "</td>" +
          "<td>" + esc(item.storeName) + "</td>" +
        "</tr>";
      }).join("");
      tableWrapEl.classList.remove("hidden");
    }
    function formatPoint(value){
      const number = Number(value || 0);
      const text = Number.isInteger(number) ? String(number) : number.toFixed(2);
      return text + "點";
    }
    function formatMovement(value){
      const number = Number(value || 0);
      const abs = Math.abs(number);
      const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
      if(number < 0) return "扣 " + text + "點";
      if(number > 0) return "增 " + text + "點";
      return "0點";
    }    function isExpiredTokenError(error){
      const message = String(error && error.message ? error.message : "");
      const code = String(error && error.code ? error.code : "");
      return code === "line_id_token_expired" || /IdToken expired|token expired|登入逾時|驗證失敗/.test(message);
    }
    function cleanRedirectUrl(){
      const url = new URL(location.href);
      url.hash = "";
      return url.toString();
    }
    function esc(value){return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));}
  </script>
</body>
</html>`, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function verifyLineIdToken(env, idToken) {
  const clientId = stringValue(env.REWARD_LINE_LOGIN_CHANNEL_ID || env.LINE_LOGIN_CHANNEL_ID || env.LINE_CHANNEL_ID);
  if (!clientId) throw httpError("尚未設定 LINE Login Channel ID，請管理員設定 REWARD_LINE_LOGIN_CHANNEL_ID", 500);
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(data.error_description || data.error || response.statusText);
    const code = /expired/i.test(message) ? "line_id_token_expired" : "line_id_token_invalid";
    throw httpError(`LINE ID Token 驗證失敗：${message}`, 401, code);
  }
  return data;
}

async function fetchMemberPointLedger(env, body) {
  const idToken = stringValue(body.idToken || body.id_token);
  if (!idToken) throw httpError("LINE 授權資訊不足，請用 LINE 重新開啟頁面", 400);
  const profile = await verifyLineIdToken(env, idToken);
  const lineUserId = stringValue(profile.sub || profile.userId);
  if (!lineUserId) throw httpError("無法取得 LINE UID", 400);
  const displayName = stringValue(body.displayName || profile.name || profile.displayName) || "會員";
  const snapshot = await fetchWetwPointSnapshot(env, POINT_OA1, lineUserId, "gift_money", 80);
  return {
    lineUserId,
    memberName: displayName,
    balance: snapshot.balance,
    items: snapshot.rows.map((row) => wetwPointListItem(row)),
  };
}

function wetwPointListItem(row) {
  const delta = Number(row.get_point ?? row.point_delta ?? 0);
  return {
    datetime: formatWetwLocalDateTime(row.created_at || row.createdAt || row.date || row.datetime),
    eventName: kPointDisplayText(stringValue(row.event_name || row.eventName) || pointEventName({ point_delta: delta }, stringValue(row.event_content || row.shop_remark))),
    eventContent: kPointDisplayText(stringValue(row.event_content || row.eventContent || row.shop_remark) || "由 KLINK 系統記錄"),
    storeName: kPointDisplayText(stringValue(row.child_shop_name || row.shop_user_lineid || row.shop_name) || "系統"),
    pointType: "K點",
    amount: delta,
    balanceAfter: Number(row.point_balance ?? row.balance ?? 0),
  };
}

function pointLedgerListItem(row) {
  const delta = Number(row.point_delta || 0);
  const note = stringValue(row.note);
  const operator = stringValue(row.operator_name);
  return {
    datetime: formatTaipeiDateTime(row.created_at),
    eventName: pointEventName(row, note),
    eventContent: note || "由 KLINK 客服系統操作",
    storeName: operator && /客服|系統|自動|關鍵字|QR/.test(operator) ? "系統" : (operator || "系統"),
    pointType: "K點",
    amount: delta,
    balanceAfter: Number(row.balance_after || 0),
  };
}

function pointEventName(row, note) {
  const delta = Number(row.point_delta || 0);
  if (/每日簽到/.test(note)) return "簽到贈點";
  if (/QR|掃碼/.test(note)) return "QR掃碼贈點";
  if (/NFC/.test(note)) return "NFC感應贈點";
  if (delta >= 0) return "康立智能贈點";
  return "康立智能扣點";
}

async function getPointAccountBalance(env, channelKey, lineUserId, pointType) {
  const accountKey = `${channelKey}:${lineUserId}:${pointType}`;
  const row = await env.DB.prepare("SELECT balance FROM point_accounts WHERE account_key = ?").bind(accountKey).first();
  return Number(row && row.balance || 0);
}

async function getLiveFirstPointAccountBalance(env, channelKey, lineUserId, pointType) {
  try {
    const live = await livePointBalanceRow(env, channelKey, lineUserId, pointType);
    const balance = Number(live && live.balance);
    if (Number.isFinite(balance)) return balance;
  } catch (_err) {
    // Fall back to the local cache only when the mother-site lookup is unavailable.
  }
  return getPointAccountBalance(env, channelKey, lineUserId, pointType);
}

async function resolveCalendarRewardContext(env, body) {
  const now = Date.now();
  const allEvents = await fetchRewardCalendarEvents(env);
  const requestedEventUid = stringValue(body.eventUid || body.event_uid || body.event).trim();
  const todayEvents = allEvents
    .filter((event) => isSameTaipeiDate(event.startsAt, now))
    .filter((event) => !requestedEventUid || calendarEventPublicId(event) === requestedEventUid || stringValue(event.uid) === requestedEventUid);
  if (!todayEvents.length) throw httpError("今天沒有行事曆活動", 400);
  const events = todayEvents.filter((event) => {
    const window = calendarEventCheckinWindow(env, event);
    return window.startsAt <= now && window.endsAt >= now;
  });
  if (!events.length) throw httpError(`今天有活動，但目前不在報名時間：${todayEvents.map((event) => formatCalendarEventBrief(event)).join("；")}`, 400);

  events.sort((a, b) => Number(a.startsAt || 0) - Number(b.startsAt || 0));
  const event = events[0];
  const points = rewardPointsFromEvent(env, event);
  return {
    campaign: `calendar_${calendarEventPublicId(event)}`,
    event,
    points,
    userLat: null,
    userLng: null,
    userAccuracy: null,
    distanceMeters: null,
    eventLat: null,
    eventLng: null,
  };
}

async function resolveTemporaryCheckinRewardContext(env, body) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const userLat = Number(body.lat || body.latitude);
  const userLng = Number(body.lng || body.longitude);
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    throw httpError("請允許定位，系統才能確認是否在臨時報到點", 400);
  }
  await ensureNfcTestTables(env);
  const now = Date.now();
  const earlyMs = rewardCheckinEarlyMinutes(env) * 60 * 1000;
  const rows = await env.DB.prepare(`
    SELECT token, address, starts_at, ends_at, points
    FROM nfc_test_flows
    WHERE channel_key = ? AND stage = 'complete' AND starts_at - ? <= ? AND ends_at >= ?
    ORDER BY updated_at DESC
    LIMIT 20
  `).bind(POINT_OA1, earlyMs, now, now).all();
  const flows = rows.results || [];
  if (!flows.length) throw httpError("目前沒有可用的臨時報到點，請先在聊天室輸入報到點建立", 400);
  const checked = [];
  for (const flow of flows) {
    const geo = await geocodeRewardLocation(env, flow.address);
    if (!geo) continue;
    checked.push({ flow, geo, distanceMeters: haversineMeters(userLat, userLng, geo.lat, geo.lng) });
  }
  checked.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const best = checked[0];
  if (!best) throw httpError("臨時報到點地址無法判定位置，請重新建立較簡短地址", 400);
  const radius = rewardGeofenceMeters(env);
  if (best.distanceMeters > radius) {
    throw httpError(`您目前距離臨時報到點約 ${Math.round(best.distanceMeters)} 公尺，超過允許範圍 ${radius} 公尺`, 403);
  }
  const points = Number(best.flow.points || calendarDefaultPoints(env));
  return {
    campaign: `${NFC_TEST_CAMPAIGN_PREFIX}${best.flow.token}`,
    event: {
      uid: `temp-checkin:${best.flow.token}`,
      summary: "臨時報到點",
      description: `臨時報到贈點 ${points} K點`,
      location: best.flow.address,
      startsAt: Number(best.flow.starts_at || 0),
      endsAt: Number(best.flow.ends_at || 0),
    },
    points: Number.isFinite(points) && points > 0 ? points : calendarDefaultPoints(env),
    userLat,
    userLng,
    userAccuracy: Number(body.accuracy || 0) || null,
    distanceMeters: best.distanceMeters,
    eventLat: best.geo.lat,
    eventLng: best.geo.lng,
  };
}

function normalizeCheckinLocation(value) {
  const text = stringValue(value).toLowerCase().trim();
  if (!text) return "";
  if (["taipei", "台北", "臺北"].includes(text)) return "taipei";
  if (["taichung", "台中", "臺中"].includes(text)) return "taichung";
  if (["kaohsiung", "高雄"].includes(text)) return "kaohsiung";
  if (["other", "其他"].includes(text)) return "other";
  return "";
}

function calendarEventMatchesCheckinLocation(event, locationKey) {
  const meta = CHECKIN_LOCATION_META[locationKey];
  if (!meta) return true;
  const text = normalizeLocationText(`${event.summary || ""} ${event.description || ""} ${event.location || ""}`);
  return meta.keywords.some((keyword) => text.includes(normalizeLocationText(keyword)));
}

function normalizeLocationText(value) {
  return stringValue(value).replace(/臺/g, "台").replace(/\s+/g, "");
}

function isSameTaipeiDate(a, b) {
  return taipeiDateKey(a) === taipeiDateKey(b);
}

function taipeiDateKey(value) {
  const parts = taipeiDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatCalendarEventBrief(event) {
  return `${event.summary || "未命名活動"} ${formatTaipeiDateTime(new Date(event.startsAt).toISOString())}-${formatTaipeiDateTime(new Date(event.endsAt).toISOString()).slice(6)} ${event.location || "未填地點"}`;
}

async function resolveNfcTestRewardContext(env, campaign, body) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const userLat = Number(body.lat || body.latitude);
  const userLng = Number(body.lng || body.longitude);
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    throw httpError("請允許定位，系統才能確認是否在測試地點", 400);
  }
  await ensureNfcTestTables(env);
  const token = normalizeNfcTestToken(campaign.replace(NFC_TEST_CAMPAIGN_PREFIX, ""));
  const flow = token ? await env.DB.prepare(`
    SELECT token, address, starts_at, ends_at, points
    FROM nfc_test_flows
    WHERE token = ? AND channel_key = ? AND stage = 'complete'
  `).bind(token, POINT_OA1).first() : null;
  if (!flow) throw httpError("找不到 NFC 測試設定，請重新在聊天室輸入簽到測試", 404);
  const now = Date.now();
  const startsAt = Number(flow.starts_at || 0);
  const endsAt = Number(flow.ends_at || 0);
  const earlyMs = rewardCheckinEarlyMinutes(env) * 60 * 1000;
  if (!startsAt || !endsAt || startsAt - earlyMs > now || endsAt < now) {
    throw httpError(`目前非測試簽到時間：${formatNfcTestTimeRange(startsAt, endsAt)}`, 400);
  }
  const geo = await geocodeRewardLocation(env, flow.address);
  if (!geo) throw httpError("測試地址無法判定位置，請改用較簡短地址，例如：台北市南京東路五段108號", 400);
  const distanceMeters = haversineMeters(userLat, userLng, geo.lat, geo.lng);
  const radius = rewardGeofenceMeters(env);
  if (distanceMeters > radius) {
    throw httpError(`您目前距離測試地點約 ${Math.round(distanceMeters)} 公尺，超過允許範圍 ${radius} 公尺`, 403);
  }
  const points = Number(flow.points || calendarDefaultPoints(env));
  const entry = normalizeRewardEntry(body.entry || body.entry_method || body.source || "nfc");
  const eventTitle = entry === "checkin" ? "臨時報到點" : "NFC測試簽到";
  return {
    campaign,
    event: {
      uid: `nfc-test:${token}`,
      summary: eventTitle,
      description: `${eventTitle}贈點 ${points} K點`,
      location: flow.address,
      startsAt,
      endsAt,
    },
    points: Number.isFinite(points) && points > 0 ? points : calendarDefaultPoints(env),
    userLat,
    userLng,
    userAccuracy: Number(body.accuracy || 0) || null,
    distanceMeters,
    eventLat: geo.lat,
    eventLng: geo.lng,
  };
}

async function fetchRewardCalendarEvents(env) {
  await ensureCalendarEventSchema(env);
  const from = taipeiStartOfDay(Date.now()) - 86400000;
  const rows = await env.DB.prepare(`
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location
    FROM calendar_events
    WHERE starts_at >= ?
    ORDER BY starts_at ASC
    LIMIT 300
  `).bind(from).all();
  return (rows.results || [])
    .map(calendarEventRowToRewardEvent)
    .filter((event) => event.startsAt && event.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt);
}

function calendarEventRowToRewardEvent(row) {
  const startsAt = numberOrZero(row && row.starts_at);
  const endsAt = numberOrZero(row && row.ends_at) || (startsAt ? startsAt + 90 * 60 * 1000 : 0);
  return {
    uid: stringValue(row && row.id),
    summary: stringValue(row && row.title),
    description: stringValue(row && row.description),
    location: stringValue(row && row.location),
    startsAt,
    endsAt,
    checkinStartsAt: numberOrZero(row && row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row && row.checkin_ends_at),
  };
}

async function importCalendarImageToD1(env, request) {
  const missing = [];
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!env.DB) missing.push("DB");
  if (missing.length) throw httpError(`Missing required config: ${missing.join(", ")}`, 500);
  await ensureCalendarEventSchema(env);

  const form = await request.formData();
  const file = form.get("image");
  if (!file || typeof file.arrayBuffer !== "function") throw httpError("image file is required", 400);
  const mimeType = stringValue(file.type || "image/jpeg").toLowerCase();
  const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  if (!supportedImageTypes.has(mimeType)) {
    throw httpError("Unsupported image type. Please upload JPG, PNG, GIF, or WEBP; AVIF must be converted before upload.", 400);
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > 10 * 1024 * 1024) throw httpError("Image is too large; max 10MB", 400);

  const fileName = stringValue(form.get("fileName") || file.name || "calendar-image");
  const imageDataUrl = `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
  const extracted = await extractCalendarEventsFromImage(env, imageDataUrl, fileName);
  const normalized = normalizeCalendarImportEvents(extracted.events || extracted, fileName);
  if (!normalized.length) {
    return { imported: 0, skipped: 0, events: [], message: "No timed calendar events were found in the image." };
  }

  const results = [];
  let imported = 0;
  let skipped = 0;
  const now = Date.now();
  for (const event of normalized) {
    try {
      const startsAt = calendarImportEpoch(event.date, event.startTime);
      let endsAt = calendarImportEpoch(event.date, event.endTime);
      if (!startsAt || !endsAt) throw new Error("invalid date/time");
      if (endsAt <= startsAt) endsAt += 86400000;
      const id = `cal_${event.sourceHash || shortHash(`${event.date}|${event.startTime}|${event.endTime}|${event.summary}|${event.location}`)}`;
      const existing = await env.DB.prepare("SELECT id FROM calendar_events WHERE id = ?").bind(id).first();
      const checkinStartsAt = startsAt - 60 * 60 * 1000;
      const checkinEndsAt = endsAt;
      await env.DB.prepare(`
        INSERT INTO calendar_events (id, floor_id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location, owner_user_id, visibility, created_at, updated_at)
        VALUES (?, '*', ?, ?, ?, ?, ?, ?, ?, '', 'public', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          checkin_starts_at = excluded.checkin_starts_at,
          checkin_ends_at = excluded.checkin_ends_at,
          location = excluded.location,
          visibility = excluded.visibility,
          updated_at = excluded.updated_at
      `).bind(id, event.summary, event.description, startsAt, endsAt, checkinStartsAt, checkinEndsAt, event.location, now, now).run();
      imported += 1;
      results.push({ ...event, id, startsAt, endsAt, status: existing ? "updated" : "imported" });
    } catch (err) {
      skipped += 1;
      results.push({ ...event, status: "skipped", reason: err && err.message ? err.message : String(err) });
    }
  }
  return { imported, skipped, events: results };
}

function calendarImportEpoch(date, clock) {
  const isoDate = normalizeIsoDate(date);
  const time = normalizeClockTime(clock);
  if (!isoDate || !time) return 0;
  const ms = Date.parse(`${isoDate}T${time}:00+08:00`);
  return Number.isFinite(ms) ? ms : 0;
}
async function extractCalendarEventsFromImage(env, imageDataUrl, fileName) {
  const apiUrl = env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
  const model = env.OPENAI_VISION_MODEL || env.OPENAI_MODEL || "gpt-5-mini";
  const prompt = [
    "你是行事曆圖片資料擷取工具。請從康立 K-LINK 月曆圖片擷取可報到的活動。",
    "只輸出 JSON，不要說明。格式：",
    "{\"events\":[{\"date\":\"YYYY-MM-DD\",\"startTime\":\"HH:mm\",\"endTime\":\"HH:mm\",\"summary\":\"活動名稱\",\"speaker\":\"講師或負責人\",\"locationName\":\"台北總公司|台中營業處|高雄營業處|其他\",\"location\":\"完整地址\",\"description\":\"補充資訊\"}]}",
    "規則：",
    "1. 只保留有明確日期與時間的活動；沒有時間的假日、旅遊、空白格不要輸出。",
    "2. 年份與月份請從圖片標題判斷，例如 MAY 2026 或 5月份行事曆。",
    "3. 台北總公司地址固定為：台北市南京東路五段108號8樓。",
    "4. 台中營業處地址固定為：台中市西屯區市政路500號4樓之6。",
    "5. 高雄營業處地址固定為：高雄市苓雅區光華一路206號24樓之1。",
    "6. description 請放講師、地點、報名限制、K點等文字；若圖片沒有 K點，系統會用預設 10 K點。",
    `fileName: ${fileName}`,
  ].join("\n");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl },
        ],
      }],
      text: { format: { type: "json_object" } },
      max_output_tokens: 8000,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw httpError(`OpenAI image parse failed ${response.status}: ${body}`, 502);
  const outputText = extractOpenAIText(JSON.parse(body));
  return await parseCalendarJsonObjectWithRepair(env, outputText);
}

async function parseCalendarJsonObjectWithRepair(env, text) {
  try {
    return parseCalendarJsonPayload(text);
  } catch (err) {
    const originalMessage = err && err.message ? err.message : String(err);
    const repairedText = await repairCalendarJsonWithOpenAI(env, text, originalMessage);
    try {
      return parseCalendarJsonPayload(repairedText);
    } catch (repairErr) {
      const repairMessage = repairErr && repairErr.message ? repairErr.message : String(repairErr);
      throw httpError(`OpenAI calendar JSON parse failed: ${originalMessage}; repair failed: ${repairMessage}`, 502);
    }
  }
}

async function repairCalendarJsonWithOpenAI(env, brokenJsonText, parseError) {
  const apiUrl = env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
  const model = env.OPENAI_MODEL || "gpt-5-mini";
  const repairPrompt = [
    "你是 JSON 修復工具。請把輸入內容修成合法 JSON。",
    "只輸出 JSON，不要 markdown，不要說明。",
    "目標格式只能是：{\"events\":[{\"date\":\"YYYY-MM-DD\",\"startTime\":\"HH:mm\",\"endTime\":\"HH:mm\",\"summary\":\"\",\"speaker\":\"\",\"locationName\":\"\",\"location\":\"\",\"description\":\"\"}]}",
    `parseError: ${parseError}`,
    "brokenJson:",
    String(brokenJsonText || "").slice(0, 12000),
  ].join("\n");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: repairPrompt }] }],
      text: { format: { type: "json_object" } },
      max_output_tokens: 8000,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw httpError(`OpenAI JSON repair failed ${response.status}: ${body}`, 502);
  return extractOpenAIText(JSON.parse(body));
}

function normalizeCalendarImportEvents(payload, fileName) {
  const rawEvents = Array.isArray(payload) ? payload : [];
  const events = [];
  for (const raw of rawEvents) {
    const date = normalizeIsoDate(raw && raw.date);
    const startTime = normalizeClockTime(raw && (raw.startTime || raw.start_time));
    const endTime = normalizeClockTime(raw && (raw.endTime || raw.end_time)) || addMinutesToClock(startTime, 90);
    const summary = stringValue(raw && (raw.summary || raw.title || raw.name)).trim();
    if (!date || !startTime || !endTime || !summary) continue;
    const locationName = normalizeCalendarLocationName(raw && (raw.locationName || raw.location_name || raw.venue));
    const location = normalizeCalendarLocation(raw && raw.location, locationName);
    const speaker = stringValue(raw && raw.speaker).trim();
    const descriptionParts = [
      stringValue(raw && raw.description).trim(),
      speaker ? `講師/負責人：${speaker}` : "",
      locationName ? `地點：${locationName}` : "",
      `匯入來源：${fileName}`,
      `K點：10`,
    ].filter(Boolean);
    events.push({
      date,
      startTime,
      endTime,
      summary,
      speaker,
      locationName,
      location,
      description: uniqueSuggestions(descriptionParts).join("\n"),
      sourceHash: shortHash(`${date}|${startTime}|${endTime}|${summary}|${location}`),
    });
  }
  const seen = new Set();
  return events
    .filter((event) => {
      const key = event.sourceHash || `${event.date}|${event.startTime}|${event.endTime}|${event.summary}|${event.location}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

function normalizeCalendarLocationName(value) {
  const text = stringValue(value).replace(/臺/g, "台");
  if (text.includes("台北") || text.includes("南京東路")) return "台北總公司";
  if (text.includes("台中") || text.includes("市政路")) return "台中營業處";
  if (text.includes("高雄") || text.includes("光華一路")) return "高雄營業處";
  return text || "其他";
}

function normalizeCalendarLocation(value, locationName) {
  const text = stringValue(value).trim();
  if (text.includes("南京東路五段108") || locationName === "台北總公司") return "台北市南京東路五段108號8樓";
  if (text.includes("市政路500") || locationName === "台中營業處") return "台中市西屯區市政路500號4樓之6";
  if (text.includes("光華一路206") || locationName === "高雄營業處") return "高雄市苓雅區光華一路206號24樓之1";
  return text || locationName || "";
}

function normalizeIsoDate(value) {
  const text = stringValue(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeClockTime(value) {
  const text = stringValue(value).trim().replace(/[：]/g, ":");
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutesToClock(clock, minutes) {
  const normalized = normalizeClockTime(clock);
  if (!normalized) return "";
  const [h, m] = normalized.split(":").map(Number);
  const total = h * 60 + m + Number(minutes || 0);
  const next = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function parseCalendarJsonPayload(text) {
  const objects = extractBalancedJsonObjects(text).map((chunk) => JSON.parse(chunk));
  if (!objects.length) return parseStrictJsonObject(text);
  if (objects.length === 1) return objects[0];
  const events = [];
  for (const obj of objects) {
    if (Array.isArray(obj && obj.events)) events.push(...obj.events);
    else if (Array.isArray(obj)) events.push(...obj);
  }
  if (events.length) return { events };
  return objects[0];
}

function parseStrictJsonObject(text) {
  const raw = stringValue(text).trim();
  try { return JSON.parse(raw); } catch (_err) { /* fallback below */ }
  const firstObject = extractBalancedJsonObjects(raw)[0];
  if (firstObject) return JSON.parse(firstObject);
  throw new Error("Unable to parse JSON object");
}

function extractBalancedJsonObjects(text) {
  const raw = stringValue(text);
  const chunks = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(output);
}

async function geocodeRewardLocation(env, location) {
  const text = stringValue(location);
  if (!text) return null;
  const direct = parseLatLng(text);
  if (direct) return direct;
  const known = knownRewardLocationLatLng(text);
  if (known) return known;
  const candidates = normalizeRewardLocationQueries(text);
  for (const query of candidates) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "KLINK-reward-geofence/1.0",
      },
    });
    if (!response.ok) continue;
    const data = await response.json().catch(() => []);
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) continue;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function knownRewardLocationLatLng(location) {
  const text = normalizeLocationText(location);
  if (!text) return null;
  const knownLocations = [
    { keywords: ["南京東路五段108", "台北總公司"], lat: CHECKIN_LOCATION_META.taipei.lat, lng: CHECKIN_LOCATION_META.taipei.lng },
    { keywords: ["市政路500", "台中營業處"], lat: CHECKIN_LOCATION_META.taichung.lat, lng: CHECKIN_LOCATION_META.taichung.lng },
    { keywords: ["光華一路206", "高雄營業處"], lat: CHECKIN_LOCATION_META.kaohsiung.lat, lng: CHECKIN_LOCATION_META.kaohsiung.lng },
  ];
  const matched = knownLocations.find((item) => item.keywords.some((keyword) => text.includes(normalizeLocationText(keyword))));
  return matched ? { lat: matched.lat, lng: matched.lng } : null;
}

function normalizeRewardLocationQueries(location) {
  const original = stringValue(location).trim();
  const simplified = original
    .replace(/臺/g, "台")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .replace(/[\(（].*?[\)）]/g, "");
  const withoutFloor = simplified.replace(/\d+樓(?:之\d+)?(?:號)?/g, "");
  const withoutVillage = withoutFloor.replace(/[\u4e00-\u9fa5]{1,6}里/g, "");
  const roadAddress = withoutVillage.match(/(.+?[路街道段])(.+)/);
  const candidates = [original, simplified, withoutFloor, withoutVillage];
  if (roadAddress) candidates.push(`${roadAddress[1]}${roadAddress[2]}`);
  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
}

function parseLatLng(text) {
  const match = stringValue(text).match(/(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rewardPointsFromEvent(env, event) {
  const text = `${event.summary || ""}\n${event.description || ""}`;
  const match = text.match(/(?:K點|點數|贈點|points?)\s*[:：]?\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)\s*(?:K點|點)/i);
  const points = match ? Number(match[1]) : calendarDefaultPoints(env);
  return Number.isFinite(points) && points > 0 ? points : calendarDefaultPoints(env);
}

function calendarDefaultPoints(env) {
  const points = Number(env.REWARD_CALENDAR_DEFAULT_POINTS || DEFAULT_REWARD_CALENDAR_POINTS);
  return Number.isFinite(points) && points > 0 ? points : DEFAULT_REWARD_CALENDAR_POINTS;
}

function rewardGeofenceMeters(env) {
  const meters = Number(env.REWARD_GEOFENCE_METERS || DEFAULT_REWARD_GEOFENCE_METERS);
  return Number.isFinite(meters) && meters > 0 ? Math.round(meters) : DEFAULT_REWARD_GEOFENCE_METERS;
}

function rewardCheckinEarlyMinutes(env) {
  const minutes = Number(env.REWARD_CHECKIN_EARLY_MINUTES || DEFAULT_REWARD_CHECKIN_EARLY_MINUTES);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : DEFAULT_REWARD_CHECKIN_EARLY_MINUTES;
}

function calendarEventCheckinWindow(_env, event) {
  const startsAt = Number(event && event.checkinStartsAt || 0) || Number(event && event.startsAt || 0);
  const endsAt = Number(event && event.checkinEndsAt || 0) || Number(event && event.endsAt || 0);
  return { startsAt, endsAt };
}

function publicCalendarEvent(event, now = Date.now(), context = null, env = {}) {
  const checkinWindow = calendarEventCheckinWindow(env, event);
  return {
    uid: event.uid,
    title: event.summary,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    checkinStartsAt: checkinWindow.startsAt,
    checkinEndsAt: checkinWindow.endsAt,
    active: checkinWindow.startsAt <= now && checkinWindow.endsAt >= now,
    points: context && Number(context.points) > 0 ? Number(context.points) : rewardPointsFromEvent(env, event),
    distanceMeters: context && Number.isFinite(context.distanceMeters) ? Math.round(context.distanceMeters) : null,
  };
}

function calendarEventPublicId(event) {
  return shortHash(stringValue(event && event.uid) || `${stringValue(event && event.summary)}:${Number(event && event.startsAt || 0)}:${stringValue(event && event.location)}`);
}

function shortHash(value) {
  let hash = 5381;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function normalizeCampaign(value) {
  const text = stringValue(value || "smart_202605").trim();
  const safe = text.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return safe || "smart_202605";
}

function isNfcTestCampaign(campaign) {
  return normalizeCampaign(campaign).startsWith(NFC_TEST_CAMPAIGN_PREFIX);
}

function rewardPointsForCampaign(campaign) {
  const key = normalizeCampaign(campaign);
  return Number(REWARD_CAMPAIGN_POINTS[key] || DEFAULT_REWARD_POINTS);
}

async function insertWetwPointMutation(env, input, body = {}) {
  if (!env.POINT_API_KEY) throw httpError("POINT_API_KEY is not configured", 400);
  const sourceMeta = pointSourceMeta(input.channelKey);
  const shopId = pointApiShopId(env, input.channelKey, body.shop_id || body.shopId);
  const url = stringValue(env.WETW_POINT_INSERT_URL) || DEFAULT_WETW_POINT_INSERT_URL;
  const eventName = stringValue(body.event_name || body.eventName) || (input.pointDelta >= 0 ? "\u5ba2\u670d\u8d08\u9ede" : "\u5ba2\u670d\u6263\u9ede");
  const eventContent = stringValue(body.event_content || body.eventContent) || input.note || "\u7531 KLINK \u5ba2\u670d\u7cfb\u7d71\u64cd\u4f5c";
  const payload = {
    api_key: env.POINT_API_KEY,
    LINE_user_id: input.lineUserId,
    shop_id: shopId,
    event_name: eventName,
    event_content: eventContent,
    point_type: input.pointType || "gift_money",
    get_point: Number(input.pointDelta || 0),
    shop_user_lineid: stringValue(body.shop_user_lineid || body.shopUserLineId || input.operatorId),
    child_shop_name: stringValue(body.child_shop_name || body.childShopName),
    child_shop_renew: Number(body.child_shop_renew || body.childShopRenew || 0),
    shop_remark: stringValue(body.shop_remark || body.shopRemark || `操作人UID：${input.operatorId}${input.operatorName && input.operatorName !== input.operatorId ? `；操作人：${input.operatorName}` : ""}${input.note ? `；${input.note}` : ""}`),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const code = stringValue(data.code);
    const message = stringValue(data.message);
    throw httpError(`WETW point insert failed: ${response.status}${code ? ` ${code}` : ""}${message ? ` - ${message}` : ""}`, response.ok ? 502 : response.status);
  }
  return data;
}

async function fetchWetwLatestPointBalance(env, input, body = {}) {
  const snapshot = await fetchWetwPointSnapshot(env, input.channelKey, input.lineUserId, input.pointType || "gift_money", 10, body);
  return snapshot.balance;
}

async function fetchWetwPointSnapshot(env, channelKey, lineUserId, pointType = "gift_money", limit = 80, body = {}) {
  const url = stringValue(env.WETW_POINTS_URL) || DEFAULT_WETW_POINT_QUERY_URL;
  const useGlobal = body.global_points === true || body.globalPoints === true || body.shop_id === 0 || body.shopId === 0;
  const shopId = useGlobal ? 0 : pointApiShopId(env, channelKey, body.shop_id || body.shopId);
  const query = {
    LINE_user_id: lineUserId,
    point_type: pointType,
    page: 1,
    per_page: limit,
    max_pages: 1,
  };
  if (shopId > 0) query.shop_id = shopId;
  const rows = await fetchWetwPointListFromWordPress(env, url, query);
  const matchedRows = rows
    .filter((row) => wetwPointRowMatchesType(row, pointType))
    .sort((a, b) => wetwPointRowRank(b) - wetwPointRowRank(a));
  const fallbackRows = rows
    .filter((row) => !wetwPointRowIsSystemPoint(row))
    .sort((a, b) => wetwPointRowRank(b) - wetwPointRowRank(a));
  const effectiveRows = matchedRows.length ? matchedRows : fallbackRows;
  for (const row of effectiveRows) {
    const balance = Number(row.point_balance ?? row.balance ?? row.points);
    if (Number.isFinite(balance)) return { balance, rows: effectiveRows, shop_id: shopId };
  }
  return { balance: 0, rows: effectiveRows, shop_id: shopId };
}

async function applyPointMutation(env, input) {
  const pointType = input.pointType || "gift_money";
  const accountKey = `${input.channelKey}:${input.lineUserId}:${pointType}`;
  const businessKey = input.businessKey || `${input.source}:${input.action}:${crypto.randomUUID()}`;
  const link = await env.DB.prepare(`
    SELECT master_member_ref
    FROM member_line_links
    WHERE channel_key = ? AND line_user_id = ?
  `).bind(input.channelKey, input.lineUserId).first();
  let masterMemberRef = link && link.master_member_ref ? link.master_member_ref : null;
  if (!masterMemberRef) {
    const member = await env.DB.prepare(`
      SELECT member_ref
      FROM crm_members
      WHERE json_extract(source_json, '$.LINE_user_id') = ?
         OR json_extract(source_json, '$.user_login') = ?
         OR json_extract(source_json, '$.line_user_id') = ?
         OR json_extract(source_json, '$.lineUserId') = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(input.lineUserId, input.lineUserId, input.lineUserId, input.lineUserId).first();
    masterMemberRef = member && member.member_ref ? stringValue(member.member_ref) : null;
  }

  const existingAccount = await env.DB.prepare(`
    SELECT balance
    FROM point_accounts
    WHERE account_key = ?
    LIMIT 1
  `).bind(accountKey).first();
  const existingBalance = existingAccount ? Number(existingAccount.balance || 0) : null;
  const explicitBalanceAfter = Number(input.balanceAfter ?? input.balance_after);
  const delta = Number(input.pointDelta || 0);
  const balanceAfter = Number.isFinite(explicitBalanceAfter)
    ? explicitBalanceAfter
    : (Number.isFinite(existingBalance) ? existingBalance + delta : delta);

  await env.DB.prepare(`
    INSERT INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_key) DO UPDATE SET
      master_member_ref = COALESCE(excluded.master_member_ref, point_accounts.master_member_ref),
      balance = excluded.balance,
      updated_at = CURRENT_TIMESTAMP
  `).bind(accountKey, masterMemberRef, input.channelKey, input.lineUserId, pointType, balanceAfter).run();

  await env.DB.prepare(`
    INSERT INTO point_ledger (account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, source_event_id, business_key, operator_id, operator_name, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(accountKey, masterMemberRef, input.channelKey, input.lineUserId, input.action, pointType, Number(input.pointDelta || 0), balanceAfter, input.source, input.sourceEventId || null, businessKey, input.operatorId || "", input.operatorName || "", input.note || null).run();

  return { account_key: accountKey, master_member_ref: masterMemberRef, balance_after: balanceAfter };
}

async function listPointBalances(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  let userName = stringValue(url.searchParams.get("user_name") || url.searchParams.get("userName") || url.searchParams.get("name"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);
  const pointTypes = pointBalanceQueryTypes(url.searchParams.get("point_type") || url.searchParams.get("pointType"));
  if (lineUserId) {
    if (channelKey) {
      try {
        const rows = await livePointBalanceRows(env, channelKey, lineUserId, pointTypes);
        if (pointBalanceRowsHaveData(rows)) return { balances: rows, resolved: { chat_line_user_id: lineUserId, point_line_user_id: lineUserId, source: "exact_chat_uid" }, alternatives: [] };
      } catch (_err) {
        // Continue to an explicit chat->mother-site binding when the clicked chat UID is not a mother-site UID.
      }
    }
    const exactBalances = await livePointBalancesForUser(env, lineUserId, pointTypes);
    if (pointBalanceRowsHaveData(exactBalances)) {
      return { balances: exactBalances, resolved: { chat_line_user_id: lineUserId, point_line_user_id: lineUserId, source: "exact_chat_uid" }, alternatives: [] };
    }
    if (!userName) userName = await pointUserNameFromChatUserId(env, lineUserId);
    const resolved = await resolvePointIdentity(env, { chatLineUserId: lineUserId, userName });
    if (resolved && hasPointSourceLineUsers(resolved.channelLineUserIds)) {
      const resolvedRows = channelKey
        ? await livePointBalancesForSourceUsers(env, { [channelKey]: resolved.channelLineUserIds[channelKey] }, pointTypes)
        : await livePointBalancesForSourceUsers(env, resolved.channelLineUserIds, pointTypes);
      return {
        balances: resolvedRows.map((row) => ({
          ...row,
          chat_line_user_id: lineUserId,
          resolved_from_name: resolved.name,
          resolved_member_ref: resolved.memberRef,
        })),
        resolved: {
          chat_line_user_id: lineUserId,
          point_line_user_id: resolved.channelLineUserIds[POINT_OA1] || resolved.channelLineUserIds[POINT_OA2] || "",
          channel_line_user_ids: resolved.channelLineUserIds,
          member_ref: resolved.memberRef,
          name: resolved.name,
          source: `chat_uid_${resolved.source}`,
        },
        alternatives: [],
      };
    }
    return { balances: [], resolved: { chat_line_user_id: lineUserId, point_line_user_id: lineUserId, source: "exact_chat_uid_not_found" }, alternatives: [] };
  }
  if (masterMemberRef) {
    const resolved = await resolvePointIdentity(env, { masterMemberRef });
    if (resolved && hasPointSourceLineUsers(resolved.channelLineUserIds)) {
      const rows = channelKey
        ? await livePointBalancesForSourceUsers(env, { [channelKey]: resolved.channelLineUserIds[channelKey] }, pointTypes)
        : await livePointBalancesForSourceUsers(env, resolved.channelLineUserIds, pointTypes);
      return {
        balances: rows.map((row) => ({ ...row, resolved_member_ref: resolved.memberRef, resolved_from_name: resolved.name })),
        resolved: { member_ref: resolved.memberRef, name: resolved.name, channel_line_user_ids: resolved.channelLineUserIds, source: resolved.source },
      };
    }
    return { balances: [], resolved: { member_ref: masterMemberRef, channel_line_user_ids: {}, source: "not_found" } };
  }
  return {
    balances: [],
    resolved: { source: "missing_line_user_id", message: "K點餘額只允許依明確聊天室或母站 LINE UID 即時查詢母站。" },
    alternatives: [],
  };
}

function pointBalanceRowsHaveData(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => Boolean(row && row.local_account) || Number(row && row.live_rows || 0) > 0 || Number(row && row.balance || 0) !== 0);
}
function pointBalanceQueryTypes(_value) {
  return ["gift_money"];
}

async function livePointBalanceRows(env, channelKey, lineUserId, pointTypes) {
  const balances = [];
  const types = Array.isArray(pointTypes) && pointTypes.length ? pointTypes : pointBalanceQueryTypes("all");
  for (const pointType of types) {
    try {
      balances.push(await livePointBalanceRow(env, channelKey, lineUserId, pointType));
    } catch (_err) {
      // A member may not have every point type in a source.
    }
  }
  return balances;
}

async function livePointBalancesForUser(env, lineUserId, pointTypes = ["gift_money"]) {
  const balances = [];
  for (const channelKey of [POINT_OA1, POINT_OA2]) {
    try {
      balances.push(...await livePointBalanceRows(env, channelKey, lineUserId, pointTypes));
    } catch (_err) {
      // A LINE uid may not exist in every source. Keep the other source usable.
    }
  }
  return balances;
}

async function livePointBalancesForSourceUsers(env, channelLineUserIds, pointTypes) {
  const balances = [];
  for (const channelKey of [POINT_OA1, POINT_OA2]) {
    const sourceLineUserId = stringValue(channelLineUserIds && channelLineUserIds[channelKey]);
    if (!sourceLineUserId) continue;
    try {
      balances.push(...await livePointBalanceRows(env, channelKey, sourceLineUserId, pointTypes));
    } catch (_err) {
      // Keep the other source usable when a source-specific UID is stale or unavailable.
    }
  }
  return balances;
}

async function livePointBalanceRow(env, channelKey, lineUserId, pointType) {
  const snapshot = await fetchWetwPointSnapshot(env, channelKey, lineUserId, pointType, 20);
  const liveRows = Array.isArray(snapshot.rows) ? snapshot.rows.length : 0;
  if (liveRows > 0 || Number(snapshot.balance || 0) !== 0) {
    const masterMemberRef = await upsertLivePointAccountCache(env, channelKey, lineUserId, pointType, snapshot.balance);
    return decoratePointBalances([{
      account_key: `${channelKey}:${lineUserId}:${pointType}`,
      master_member_ref: masterMemberRef,
      channel_key: channelKey,
      line_user_id: lineUserId,
      point_type: pointType,
      balance: snapshot.balance,
      updated_at: "mother-site-live",
      query_shop_id: snapshot.shop_id,
      live_rows: liveRows,
    }])[0];
  }
  const local = await localPointBalanceRow(env, channelKey, lineUserId, pointType, snapshot.shop_id);
  if (local) return local;
  return decoratePointBalances([{
    account_key: `${channelKey}:${lineUserId}:${pointType}`,
    master_member_ref: "",
    channel_key: channelKey,
    line_user_id: lineUserId,
    point_type: pointType,
    balance: snapshot.balance,
    updated_at: "mother-site-live-empty",
    query_shop_id: snapshot.shop_id,
    live_rows: liveRows,
  }])[0];
}

async function localPointBalanceRow(env, channelKey, lineUserId, pointType, queryShopId = "") {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`
    SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
    FROM point_accounts
    WHERE channel_key = ? AND line_user_id = ? AND point_type = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(channelKey, lineUserId, pointType).first();
  if (!row) return null;
  let masterMemberRef = stringValue(row.master_member_ref);
  if (!masterMemberRef) {
    masterMemberRef = await resolveMasterMemberRefForPointLineUser(env, channelKey, lineUserId);
    if (masterMemberRef) {
      await env.DB.prepare(`
        UPDATE point_accounts
        SET master_member_ref = ?, updated_at = CURRENT_TIMESTAMP
        WHERE account_key = ?
      `).bind(masterMemberRef, row.account_key).run();
    }
  }
  return decoratePointBalances([{
    account_key: stringValue(row.account_key),
    master_member_ref: masterMemberRef,
    channel_key: stringValue(row.channel_key),
    line_user_id: stringValue(row.line_user_id),
    point_type: stringValue(row.point_type),
    balance: Number(row.balance || 0),
    updated_at: row.updated_at || "local-cache",
    query_shop_id: queryShopId,
    live_rows: 0,
    local_account: true,
  }])[0];
}

async function upsertLivePointAccountCache(env, channelKey, lineUserId, pointType, balance) {
  if (!env.DB) return "";
  const masterMemberRef = await resolveMasterMemberRefForPointLineUser(env, channelKey, lineUserId);
  const accountKey = `${channelKey}:${lineUserId}:${pointType}`;
  await env.DB.prepare(`
    INSERT INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_key) DO UPDATE SET
      master_member_ref = COALESCE(NULLIF(excluded.master_member_ref, ''), point_accounts.master_member_ref),
      balance = excluded.balance,
      updated_at = CURRENT_TIMESTAMP
  `).bind(accountKey, masterMemberRef || null, channelKey, lineUserId, pointType, Number(balance || 0)).run();
  return masterMemberRef;
}

async function resolveMasterMemberRefForPointLineUser(env, channelKey, lineUserId) {
  if (!env.DB) return "";
  const userId = stringValue(lineUserId);
  const sourceKey = stringValue(channelKey);
  if (!userId) return "";
  const linked = await env.DB.prepare(`
    SELECT master_member_ref
    FROM member_line_links
    WHERE channel_key = ? AND line_user_id = ?
    ORDER BY linked_at DESC
    LIMIT 1
  `).bind(sourceKey, userId).first();
  if (linked && linked.master_member_ref) return stringValue(linked.master_member_ref);
  const member = await env.DB.prepare(`
    SELECT member_ref
    FROM crm_members
    WHERE json_extract(source_json, '$.LINE_user_id') = ?
       OR json_extract(source_json, '$.user_login') = ?
       OR json_extract(source_json, '$.line_user_id') = ?
       OR json_extract(source_json, '$.lineUserId') = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(userId, userId, userId, userId).first();
  if (!member || !member.member_ref) return "";
  await env.DB.prepare(`
    INSERT INTO member_line_links (master_member_ref, channel_key, line_user_id, binding_code, linked_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(master_member_ref, channel_key) DO UPDATE SET
      line_user_id = excluded.line_user_id,
      binding_code = excluded.binding_code,
      linked_at = CURRENT_TIMESTAMP
  `).bind(stringValue(member.member_ref), sourceKey, userId, `cache:${sourceKey}`).run();
  return stringValue(member.member_ref);
}

async function pointIdentityAlternatives(env, chatLineUserId, userName, pointType = "gift_money") {
  const chatUserId = stringValue(chatLineUserId);
  const name = stringValue(userName).trim();
  if (!env.DB || !name) return [];
  const chatProfile = chatUserId ? await env.DB.prepare(`
    SELECT picture_url
    FROM profiles
    WHERE user_id = ?
    ORDER BY updated_at DESC, last_profile_sync DESC
    LIMIT 1
  `).bind(chatUserId).first() : null;
  const chatPictureKey = linePictureKey(chatProfile && chatProfile.picture_url);
  const rows = await env.DB.prepare(`
    SELECT p.user_id, p.display_name, p.picture_url, e.channel_key, COUNT(*) AS events
    FROM profiles p
    JOIN webhook_events e ON e.line_user_id = p.user_id
    WHERE p.display_name = ?
      AND e.channel_key IN (?, ?)
    GROUP BY p.user_id, p.display_name, p.picture_url, e.channel_key
    ORDER BY
      CASE WHEN p.user_id = ? THEN 0 ELSE 1 END,
      events DESC,
      p.updated_at DESC
    LIMIT 12
  `).bind(name, POINT_OA1, POINT_OA2, chatUserId).all();
  const seen = new Set();
  const alternatives = [];
  for (const row of rows.results || []) {
    const channelKey = stringValue(row.channel_key);
    const userId = stringValue(row.user_id);
    if (!POINT_CHANNELS.has(channelKey) || !userId) continue;
    const key = `${channelKey}:${userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let balance = null;
    let liveRows = 0;
    try {
      const snapshot = await fetchWetwPointSnapshot(env, channelKey, userId, pointType, 10);
      balance = snapshot.balance;
      liveRows = Array.isArray(snapshot.rows) ? snapshot.rows.length : 0;
    } catch (_err) {
      balance = null;
    }
    const account = await env.DB.prepare(`
      SELECT master_member_ref
      FROM point_accounts
      WHERE channel_key = ? AND line_user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(channelKey, userId).first();
    alternatives.push({
      channel_key: channelKey,
      line_user_id: userId,
      display_name: stringValue(row.display_name),
      picture_url: stringValue(row.picture_url),
      picture_match: Boolean(chatPictureKey && linePictureKey(row.picture_url) === chatPictureKey),
      selected: userId === chatUserId,
      balance,
      live_rows: liveRows,
      master_member_ref: stringValue(account && account.master_member_ref),
      source_label: pointSourceMeta(channelKey)?.label || channelKey,
    });
  }
  return alternatives;
}

function pointSourceMeta(channelKey) {
  return POINT_SOURCE_META[channelKey] || null;
}

async function resolvePointIdentity(env, input) {
  const chatLineUserId = stringValue(input.chatLineUserId);
  const masterMemberRef = stringValue(input.masterMemberRef || input.master_member_ref);
  const userName = stringValue(input.userName).trim();
  if (!env.DB) return null;

  if (masterMemberRef) {
    const member = await env.DB.prepare(`
      SELECT member_ref, name, source_json
      FROM crm_members
      WHERE member_ref = ?
      LIMIT 1
    `).bind(masterMemberRef).first();
    let channelLineUserIds = await pointLineUserIdsForMember(env, masterMemberRef, member);
    channelLineUserIds = await augmentPointIdentityWithUniqueKangliAccount(env, channelLineUserIds, userName || (member && member.name));
    if (hasPointSourceLineUsers(channelLineUserIds)) {
      return {
        channelLineUserIds,
        pointLineUserId: channelLineUserIds[POINT_OA1] || channelLineUserIds[POINT_OA2] || "",
        memberRef: masterMemberRef,
        name: member && member.name ? member.name : "",
        source: "member_ref",
      };
    }
  }

  if (chatLineUserId) {
    const linked = await env.DB.prepare(`
      SELECT master_member_ref, line_user_id
      FROM member_line_links
      WHERE channel_key = 'chat' AND line_user_id = ?
      LIMIT 1
    `).bind(chatLineUserId).first();
    if (linked && linked.master_member_ref) {
      const member = await env.DB.prepare(`
        SELECT member_ref, name, source_json
        FROM crm_members
        WHERE member_ref = ?
        LIMIT 1
      `).bind(linked.master_member_ref).first();
      let channelLineUserIds = await pointLineUserIdsForMember(env, linked.master_member_ref, member);
      channelLineUserIds = await augmentPointIdentityWithUniqueKangliAccount(env, channelLineUserIds, userName || (member && member.name));
      if (hasPointSourceLineUsers(channelLineUserIds)) {
        return {
          channelLineUserIds,
          pointLineUserId: channelLineUserIds[POINT_OA1] || channelLineUserIds[POINT_OA2] || "",
          memberRef: linked.master_member_ref,
          name: member && member.name ? member.name : "",
          source: "member_link",
        };
      }
    }

    const sourceLinked = await env.DB.prepare(`
      SELECT master_member_ref, channel_key, line_user_id
      FROM member_line_links
      WHERE channel_key IN (?, ?) AND line_user_id = ?
      ORDER BY linked_at DESC
      LIMIT 1
    `).bind(POINT_OA1, POINT_OA2, chatLineUserId).first();
    if (sourceLinked && sourceLinked.master_member_ref) {
      const member = await env.DB.prepare(`
        SELECT member_ref, name, source_json
        FROM crm_members
        WHERE member_ref = ?
        LIMIT 1
      `).bind(sourceLinked.master_member_ref).first();
      let channelLineUserIds = await pointLineUserIdsForMember(env, sourceLinked.master_member_ref, member);
      channelLineUserIds = await augmentPointIdentityWithUniqueKangliAccount(env, channelLineUserIds, userName || (member && member.name));
      if (hasPointSourceLineUsers(channelLineUserIds)) {
        return {
          channelLineUserIds,
          pointLineUserId: channelLineUserIds[POINT_OA1] || channelLineUserIds[POINT_OA2] || "",
          memberRef: sourceLinked.master_member_ref,
          name: member && member.name ? member.name : "",
          source: "source_member_link",
        };
      }
    }

    if (userName) {
      const profileResolved = await pointSourceLineUsersFromChatProfile(env, chatLineUserId, userName);
      if (hasPointSourceLineUsers(profileResolved.channelLineUserIds)) {
        return {
          channelLineUserIds: profileResolved.channelLineUserIds,
          pointLineUserId: profileResolved.channelLineUserIds[POINT_OA1] || profileResolved.channelLineUserIds[POINT_OA2] || "",
          memberRef: profileResolved.memberRef || "",
          name: profileResolved.name || userName,
          source: profileResolved.source || "point_profile_picture",
        };
      }
      const uniqueNameResolved = await pointSourceLineUsersFromUniquePointAccountName(env, userName);
      if (hasPointSourceLineUsers(uniqueNameResolved.channelLineUserIds)) {
        return {
          channelLineUserIds: uniqueNameResolved.channelLineUserIds,
          pointLineUserId: uniqueNameResolved.channelLineUserIds[POINT_OA1] || uniqueNameResolved.channelLineUserIds[POINT_OA2] || "",
          memberRef: uniqueNameResolved.memberRef || "",
          name: uniqueNameResolved.name || userName,
          source: uniqueNameResolved.source || "unique_point_account_name",
        };
      }
      const crmNameResolved = await pointSourceLineUsersFromUniqueCrmMemberName(env, userName);
      if (hasPointSourceLineUsers(crmNameResolved.channelLineUserIds)) {
        return {
          channelLineUserIds: crmNameResolved.channelLineUserIds,
          pointLineUserId: crmNameResolved.channelLineUserIds[POINT_OA1] || crmNameResolved.channelLineUserIds[POINT_OA2] || "",
          memberRef: crmNameResolved.memberRef || "",
          name: crmNameResolved.name || userName,
          source: crmNameResolved.source || "unique_crm_member_name",
        };
      }
    }
  }

  return null;
}

function pointIdentityNameQueries(userName) {
  const value = stringValue(userName);
  if (!value) return [];
  const queries = [value];
  const chars = Array.from(value);
  if (/[\u3400-\u9fff]/.test(value) && chars.length > 1) {
    const withoutFirstChar = chars.slice(1).join("");
    if (withoutFirstChar && !queries.includes(withoutFirstChar)) queries.push(withoutFirstChar);
  }
  return queries;
}

function crmLineUserId(member) {
  if (!member) return "";
  try {
    const raw = JSON.parse(member.source_json || "{}");
    return stringValue(raw.LINE_user_id || raw.user_login || raw.line_user_id || raw.lineUserId);
  } catch (_err) {
    return "";
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

async function pointLineUserIdForMember(env, memberRef, channelKey = "") {
  const ref = stringValue(memberRef);
  if (!ref) return "";
  const sourceKey = stringValue(channelKey);
  if (POINT_CHANNELS.has(sourceKey)) {
    const linked = await env.DB.prepare(`
      SELECT line_user_id
      FROM member_line_links
      WHERE master_member_ref = ? AND channel_key = ?
      ORDER BY linked_at DESC
      LIMIT 1
    `).bind(ref, sourceKey).first();
    if (linked && linked.line_user_id) return stringValue(linked.line_user_id);
  }
  const linked = await env.DB.prepare(`
    SELECT line_user_id
    FROM member_line_links
    WHERE master_member_ref = ? AND channel_key IN (?, ?)
    ORDER BY CASE channel_key WHEN ? THEN 0 ELSE 1 END, linked_at DESC
    LIMIT 1
  `).bind(ref, POINT_OA1, POINT_OA2, POINT_OA1).first();
  if (linked && linked.line_user_id) return stringValue(linked.line_user_id);
  return "";
}

async function pointLineUserIdsForMember(env, memberRef, member = null) {
  const ref = stringValue(memberRef);
  const result = {};
  if (!ref || !env.DB) return result;
  const links = await env.DB.prepare(`
    SELECT channel_key, line_user_id
    FROM member_line_links
    WHERE master_member_ref = ? AND channel_key IN (?, ?)
    ORDER BY linked_at DESC
  `).bind(ref, POINT_OA1, POINT_OA2).all();
  for (const link of links.results || []) {
    const channelKey = stringValue(link.channel_key);
    if (POINT_CHANNELS.has(channelKey) && !result[channelKey]) result[channelKey] = stringValue(link.line_user_id);
  }
  const crmUid = crmLineUserId(member);
  if (crmUid && !result[POINT_OA1]) result[POINT_OA1] = crmUid;
  return result;
}

async function augmentPointIdentityWithUniqueKangliAccount(env, channelLineUserIds, userName) {
  const result = { ...(channelLineUserIds || {}) };
  if (result[POINT_OA1]) return result;
  const uniqueNameResolved = await pointSourceLineUsersFromUniquePointAccountName(env, userName);
  const oa1UserId = stringValue(uniqueNameResolved.channelLineUserIds && uniqueNameResolved.channelLineUserIds[POINT_OA1]);
  if (oa1UserId) result[POINT_OA1] = oa1UserId;
  return result;
}
function hasPointSourceLineUsers(channelLineUserIds) {
  return POINT_CHANNELS.has(POINT_OA1) && Boolean(channelLineUserIds && (channelLineUserIds[POINT_OA1] || channelLineUserIds[POINT_OA2]));
}

async function pointSourceLineUsersFromProfileName(env, userName) {
  const name = stringValue(userName).trim();
  if (!name || !env.DB) return { channelLineUserIds: {} };
  const rows = await env.DB.prepare(`
    SELECT e.channel_key, p.user_id, p.display_name, COUNT(*) AS events
    FROM profiles p
    JOIN webhook_events e ON e.line_user_id = p.user_id
    WHERE p.display_name = ?
      AND e.channel_key IN (?, ?)
    GROUP BY e.channel_key, p.user_id, p.display_name
    ORDER BY
      CASE e.channel_key WHEN ? THEN 0 ELSE 1 END,
      events DESC
    LIMIT 10
  `).bind(name, POINT_OA1, POINT_OA2, POINT_OA1).all();
  const channelLineUserIds = {};
  const ambiguous = new Set();
  for (const row of rows.results || []) {
    const channelKey = stringValue(row.channel_key);
    const userId = stringValue(row.user_id);
    if (!POINT_CHANNELS.has(channelKey) || !userId) continue;
    if (channelLineUserIds[channelKey] && channelLineUserIds[channelKey] !== userId) {
      delete channelLineUserIds[channelKey];
      ambiguous.add(channelKey);
      continue;
    }
    if (!ambiguous.has(channelKey)) channelLineUserIds[channelKey] = userId;
  }
  return { channelLineUserIds, name };
}

async function pointSourceLineUsersFromUniqueCrmMemberName(env, userName) {
  const queries = pointIdentityNameQueries(userName);
  if (!queries.length || !env.DB) return { channelLineUserIds: {} };
  for (const query of queries) {
    const rows = await env.DB.prepare(`
      SELECT member_ref, name, source_json
      FROM crm_members
      WHERE name = ?
         OR json_extract(source_json, '$.LINE_display_name') = ?
         OR json_extract(source_json, '$.display_name') = ?
      ORDER BY updated_at DESC
      LIMIT 10
    `).bind(query, query, query).all();
    const members = rows.results || [];
    const uniqueRefs = new Set(members.map((row) => stringValue(row.member_ref)).filter(Boolean));
    if (uniqueRefs.size !== 1) continue;
    const member = members.find((row) => stringValue(row.member_ref) === Array.from(uniqueRefs)[0]) || members[0];
    const channelLineUserIds = await pointLineUserIdsForMember(env, member.member_ref, member);
    if (hasPointSourceLineUsers(channelLineUserIds)) {
      return {
        channelLineUserIds,
        memberRef: stringValue(member.member_ref),
        name: stringValue(member.name) || query,
        source: "unique_crm_member_name",
      };
    }
  }
  return { channelLineUserIds: {} };
}
async function pointSourceLineUsersFromUniquePointAccountName(env, userName) {
  const name = stringValue(userName).trim();
  if (!name || !env.DB) return { channelLineUserIds: {} };
  const rows = await env.DB.prepare(`
    SELECT pa.channel_key, pa.line_user_id, pa.master_member_ref, p.display_name, MAX(pa.updated_at) AS updated_at
    FROM point_accounts pa
    JOIN profiles p ON p.user_id = pa.line_user_id
    WHERE p.display_name = ?
      AND pa.channel_key IN (?, ?)
      AND pa.point_type = 'gift_money'
    GROUP BY pa.channel_key, pa.line_user_id, pa.master_member_ref, p.display_name
    ORDER BY MAX(pa.updated_at) DESC
    LIMIT 10
  `).bind(name, POINT_OA1, POINT_OA2).all();
  const candidates = rows.results || [];
  const memberRefs = new Set(candidates.map((row) => stringValue(row.master_member_ref)).filter(Boolean));
  const userIds = new Set(candidates.map((row) => stringValue(row.line_user_id)).filter(Boolean));
  if (memberRefs.size > 1 || (!memberRefs.size && userIds.size !== 1)) return { channelLineUserIds: {} };
  const memberRef = Array.from(memberRefs)[0] || "";
  if (memberRef) {
    const member = await env.DB.prepare(`
      SELECT member_ref, name, source_json
      FROM crm_members
      WHERE member_ref = ?
      LIMIT 1
    `).bind(memberRef).first();
    const channelLineUserIds = await pointLineUserIdsForMember(env, memberRef, member);
    for (const row of candidates) {
      const channelKey = stringValue(row.channel_key);
      if (POINT_CHANNELS.has(channelKey) && !channelLineUserIds[channelKey]) channelLineUserIds[channelKey] = stringValue(row.line_user_id);
    }
    return { channelLineUserIds, memberRef, name: member && member.name ? member.name : name, source: "unique_point_account_name" };
  }
  const row = candidates[0];
  const channelKey = stringValue(row && row.channel_key);
  const lineUserId = stringValue(row && row.line_user_id);
  if (!POINT_CHANNELS.has(channelKey) || !lineUserId) return { channelLineUserIds: {} };
  return { channelLineUserIds: { [channelKey]: lineUserId }, memberRef: "", name, source: "unique_point_account_name" };
}
async function pointSourceLineUsersFromChatProfile(env, chatLineUserId, userName) {
  const chatUserId = stringValue(chatLineUserId);
  const name = stringValue(userName).trim();
  if (!chatUserId || !name || !env.DB) return { channelLineUserIds: {} };
  const chatProfile = await env.DB.prepare(`
    SELECT picture_url, display_name
    FROM profiles
    WHERE user_id = ?
      AND picture_url IS NOT NULL
      AND picture_url <> ''
    ORDER BY updated_at DESC, last_profile_sync DESC
    LIMIT 1
  `).bind(chatUserId).first();
  const chatPictureKey = linePictureKey(chatProfile && chatProfile.picture_url);
  if (!chatPictureKey) return { channelLineUserIds: {} };
  const rows = await env.DB.prepare(`
    SELECT p.user_id, p.display_name, p.picture_url, p.updated_at
    FROM profiles p
    WHERE p.user_id <> ?
      AND p.display_name = ?
      AND p.picture_url IS NOT NULL
      AND p.picture_url <> ''
    ORDER BY p.updated_at DESC
    LIMIT 20
  `).bind(chatUserId, name).all();
  const candidates = [];
  for (const row of rows.results || []) {
    const pictureKey = linePictureKey(row.picture_url);
    if (!pictureKey || pictureKey !== chatPictureKey) continue;
    const sourceRows = await env.DB.prepare(`
      SELECT e.channel_key, COUNT(*) AS events
      FROM webhook_events e
      WHERE e.line_user_id = ?
        AND e.channel_key IN (?, ?)
      GROUP BY e.channel_key
      ORDER BY events DESC
    `).bind(row.user_id, POINT_OA1, POINT_OA2).all();
    for (const source of sourceRows.results || []) {
      const channelKey = stringValue(source.channel_key);
      if (!POINT_CHANNELS.has(channelKey)) continue;
      candidates.push({ channelKey, userId: stringValue(row.user_id), events: Number(source.events || 0) });
    }
  }
  const channelLineUserIds = {};
  const ambiguous = new Set();
  for (const candidate of candidates.sort((a, b) => b.events - a.events)) {
    if (channelLineUserIds[candidate.channelKey] && channelLineUserIds[candidate.channelKey] !== candidate.userId) {
      delete channelLineUserIds[candidate.channelKey];
      ambiguous.add(candidate.channelKey);
      continue;
    }
    if (!ambiguous.has(candidate.channelKey)) channelLineUserIds[candidate.channelKey] = candidate.userId;
  }
  const sourceUserId = channelLineUserIds[POINT_OA1] || channelLineUserIds[POINT_OA2] || "";
  let memberRef = "";
  if (sourceUserId) {
    const account = await env.DB.prepare(`
      SELECT master_member_ref
      FROM point_accounts
      WHERE line_user_id = ?
        AND master_member_ref IS NOT NULL
        AND master_member_ref <> ''
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(sourceUserId).first();
    memberRef = stringValue(account && account.master_member_ref);
  }
  return { channelLineUserIds, memberRef, name, source: "point_profile_picture" };
}

function linePictureKey(url) {
  const value = stringValue(url);
  if (!value) return "";
  const token = value.split("/").filter(Boolean).pop() || "";
  if (token.length < 50) return token;
  return token.slice(10, -10);
}

async function pointUserNameFromChatUserId(env, lineUserId) {
  const userId = stringValue(lineUserId);
  if (!userId || !env.DB) return "";
  const thread = await env.DB.prepare(`
    SELECT display_name
    FROM threads
    WHERE user_id = ?
      AND display_name IS NOT NULL
      AND display_name <> ''
      AND display_name <> user_id
      AND display_name NOT LIKE 'U%'
    ORDER BY updated_at DESC, last_message_at DESC
    LIMIT 1
  `).bind(userId).first();
  if (thread && thread.display_name) return stringValue(thread.display_name);

  const profile = await env.DB.prepare(`
    SELECT display_name
    FROM profiles
    WHERE user_id = ?
      AND display_name IS NOT NULL
      AND display_name <> ''
      AND display_name <> user_id
      AND display_name NOT LIKE 'U%'
    ORDER BY updated_at DESC, last_profile_sync DESC
    LIMIT 1
  `).bind(userId).first();
  return profile && profile.display_name ? stringValue(profile.display_name) : "";
}

function decoratePointBalances(rows) {
  return (rows || []).map((row) => {
    const meta = pointSourceMeta(row.channel_key) || {};
    return {
      ...row,
      source_label: meta.label || row.channel_key,
      source_shop_id: meta.shopId || "",
      source_login_url: meta.loginUrl || "",
      can_grant: meta.canGrant !== false,
      deduct_priority: Boolean(meta.deductPriority),
    };
  });
}

function pointApiShopId(env, channelKey, override) {
  const explicit = Number(override || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const sourceEnv = channelKey === POINT_OA2 ? env.WETW_POINT_SHOP_ID_OA2 : env.WETW_POINT_SHOP_ID_OA1;
  const configured = Number(sourceEnv || 0);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (channelKey === POINT_OA1) {
    const checkinShopId = Number(env.WETW_MEMBER_CHECKIN_SHOP_ID || env.WETW_SHOP_ID || 0);
    if (Number.isFinite(checkinShopId) && checkinShopId > 0) return checkinShopId;
  }
  const metaShopId = Number(POINT_SOURCE_META[channelKey] && POINT_SOURCE_META[channelKey].shopId);
  if (Number.isFinite(metaShopId) && metaShopId > 0) return metaShopId;
  return wetwShopId(env);
}

function pointStatsDateFromDays(days) {
  const start = new Date(Date.now() - (days - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace("T", " ");
}

function pointStatsWhere(scope, sinceSql, channelKey, pointType, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const where = [`${prefix}created_at >= ?`];
  const bindings = [sinceSql];
  if (scope !== "all") {
    where.push(`${prefix}source NOT IN ('sync', 'import')`);
    where.push(`${prefix}action NOT IN ('sync', 'import')`);
    where.push(`${prefix}business_key NOT LIKE 'sync:%'`);
  }
  if (channelKey && POINT_CHANNELS.has(channelKey)) {
    where.push(`${prefix}channel_key = ?`);
    bindings.push(channelKey);
  }
  if (pointType) {
    where.push(`${prefix}point_type = ?`);
    bindings.push(pointType);
  }
  return { where: where.join(" AND "), bindings };
}

function pointStatsUserNameSql(alias = "pl") {
  return `COALESCE(
    NULLIF((
      SELECT cm.name
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.LINE_display_name')
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT json_extract(cm.source_json, '$.display_name')
      FROM crm_members cm
      WHERE cm.member_ref = ${alias}.master_member_ref
         OR json_extract(cm.source_json, '$.LINE_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.user_login') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.line_user_id') = ${alias}.line_user_id
         OR json_extract(cm.source_json, '$.lineUserId') = ${alias}.line_user_id
      ORDER BY cm.updated_at DESC
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT p.display_name
      FROM profiles p
      WHERE p.user_id = ${alias}.line_user_id
        AND p.display_name IS NOT NULL
        AND p.display_name <> ''
        AND p.display_name <> p.user_id
      ORDER BY p.updated_at DESC
      LIMIT 1
    ), '')
  )`;
}

function pointStatsTotals(rows) {
  return rows.reduce((totals, row) => {
    totals.days += 1;
    totals.transactions += Number(row.transactions || 0);
    totals.users += Number(row.unique_users || 0);
    totals.grant_points += Number(row.grant_points || 0);
    totals.deduct_points += Number(row.deduct_points || 0);
    totals.net_points += Number(row.net_points || 0);
    totals.grant_count += Number(row.grant_count || 0);
    totals.deduct_count += Number(row.deduct_count || 0);
    return totals;
  }, { days: 0, transactions: 0, users: 0, grant_points: 0, deduct_points: 0, net_points: 0, grant_count: 0, deduct_count: 0 });
}

function pointStatsMemberName(row) {
  const name = stringValue(row && row.user_name).trim();
  if (name) return name;
  const uid = stringValue(row && row.line_user_id);
  return uid ? `${uid.slice(0, 10)}...${uid.slice(-6)}` : "未命名會員";
}

async function listPointDailyStats(env, url) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const days = clampNumber(url.searchParams.get("days") || 30, 1, 366);
  const scope = stringValue(url.searchParams.get("scope") || "ops") === "all" ? "all" : "ops";
  const channelKey = stringValue(url.searchParams.get("channel_key") || url.searchParams.get("channelKey"));
  const pointType = stringValue(url.searchParams.get("point_type") || url.searchParams.get("pointType") || "gift_money");
  const sinceSql = pointStatsDateFromDays(days);
  const filter = pointStatsWhere(scope, sinceSql, channelKey, pointType, "pl");
  const userNameSql = pointStatsUserNameSql("pl");
  const dailyRows = await env.DB.prepare(`
    SELECT
      date(datetime(pl.created_at, '+8 hours')) AS day,
      COUNT(*) AS transactions,
      COUNT(DISTINCT pl.line_user_id) AS unique_users,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points,
      SUM(CASE WHEN pl.point_delta > 0 THEN 1 ELSE 0 END) AS grant_count,
      SUM(CASE WHEN pl.point_delta < 0 THEN 1 ELSE 0 END) AS deduct_count
    FROM point_ledger pl
    WHERE ${filter.where}
    GROUP BY day
    ORDER BY day DESC
  `).bind(...filter.bindings).all();
  const breakdownRows = await env.DB.prepare(`
    SELECT
      pl.action AS action,
      pl.source AS source,
      COUNT(*) AS transactions,
      COUNT(DISTINCT pl.line_user_id) AS unique_users,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points
    FROM point_ledger pl
    WHERE ${filter.where}
    GROUP BY pl.action, pl.source
    ORDER BY transactions DESC, action ASC, source ASC
    LIMIT 30
  `).bind(...filter.bindings).all();
  const recentRows = await env.DB.prepare(`
    SELECT pl.id, pl.channel_key, pl.line_user_id, ${userNameSql} AS user_name, pl.action, pl.point_type, pl.point_delta, pl.balance_after, pl.source, pl.business_key, pl.operator_name, pl.note, pl.created_at
    FROM point_ledger pl
    WHERE ${filter.where}
    ORDER BY pl.id DESC
    LIMIT 80
  `).bind(...filter.bindings).all();
  const memberRows = await env.DB.prepare(`
    SELECT
      date(datetime(pl.created_at, '+8 hours')) AS day,
      pl.line_user_id,
      ${userNameSql} AS user_name,
      COUNT(*) AS transactions,
      SUM(CASE WHEN pl.point_delta > 0 THEN pl.point_delta ELSE 0 END) AS grant_points,
      SUM(CASE WHEN pl.point_delta < 0 THEN -pl.point_delta ELSE 0 END) AS deduct_points,
      SUM(pl.point_delta) AS net_points
    FROM point_ledger pl
    WHERE ${filter.where}
    GROUP BY day, pl.line_user_id
    ORDER BY day DESC, transactions DESC, ABS(net_points) DESC
    LIMIT 1200
  `).bind(...filter.bindings).all();
  const dailyMembers = new Map();
  for (const row of memberRows.results || []) {
    const day = stringValue(row.day);
    if (!day) continue;
    const list = dailyMembers.get(day) || [];
    if (list.length < 12) {
      list.push({
        line_user_id: stringValue(row.line_user_id),
        name: pointStatsMemberName(row),
        transactions: Number(row.transactions || 0),
        grant_points: Number(row.grant_points || 0),
        deduct_points: Number(row.deduct_points || 0),
        net_points: Number(row.net_points || 0),
      });
    }
    dailyMembers.set(day, list);
  }
  const daily = (dailyRows.results || []).map((row) => ({
    day: stringValue(row.day),
    transactions: Number(row.transactions || 0),
    unique_users: Number(row.unique_users || 0),
    grant_points: Number(row.grant_points || 0),
    deduct_points: Number(row.deduct_points || 0),
    net_points: Number(row.net_points || 0),
    grant_count: Number(row.grant_count || 0),
    deduct_count: Number(row.deduct_count || 0),
    members: dailyMembers.get(stringValue(row.day)) || [],
  }));
  const breakdown = (breakdownRows.results || []).map((row) => ({
    action: stringValue(row.action),
    source: stringValue(row.source),
    transactions: Number(row.transactions || 0),
    unique_users: Number(row.unique_users || 0),
    grant_points: Number(row.grant_points || 0),
    deduct_points: Number(row.deduct_points || 0),
    net_points: Number(row.net_points || 0),
  }));
  const recent = (recentRows.results || []).map((row) => ({
    id: Number(row.id || 0),
    channel_key: stringValue(row.channel_key),
    source_label: pointSourceMeta(row.channel_key)?.label || stringValue(row.channel_key),
    line_user_id: stringValue(row.line_user_id),
    user_name: pointStatsMemberName(row),
    action: stringValue(row.action),
    point_type: stringValue(row.point_type),
    point_delta: Number(row.point_delta || 0),
    balance_after: Number(row.balance_after || 0),
    source: stringValue(row.source),
    business_key: stringValue(row.business_key),
    operator_name: stringValue(row.operator_name),
    note: kPointDisplayText(row.note),
    created_at: stringValue(row.created_at),
    created_at_text: formatTaipeiDateTime(row.created_at),
  }));
  return {
    days,
    scope,
    since: sinceSql,
    channel_key: POINT_CHANNELS.has(channelKey) ? channelKey : "",
    point_type: pointType,
    totals: pointStatsTotals(daily),
    daily,
    breakdown,
    recent,
  };
}async function listPointLedger(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  let userName = stringValue(url.searchParams.get("user_name") || url.searchParams.get("userName") || url.searchParams.get("name"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);
  const pointTypes = pointBalanceQueryTypes(url.searchParams.get("point_type") || url.searchParams.get("pointType"));
  if (lineUserId) {
    const ledgers = [];
    const sourceMap = { [POINT_OA1]: lineUserId, [POINT_OA2]: lineUserId };
    const sourceKeys = channelKey ? [channelKey] : [POINT_OA1, POINT_OA2];
    for (const sourceKey of sourceKeys) {
      const sourceLineUserId = stringValue(sourceMap[sourceKey]);
      if (!sourceLineUserId) continue;
      try {
        const snapshot = await fetchWetwPointSnapshot(env, sourceKey, sourceLineUserId, "gift_money", limit);
        ledgers.push(...snapshot.rows.map((row) => wetwPointLedgerRow(sourceKey, sourceLineUserId, row)));
      } catch (_err) {
        // Some members only exist in one source.
      }
    }
    const exactLedgers = ledgers.sort((a, b) => wetwPointRowRankFromLedger(b) - wetwPointRowRankFromLedger(a)).slice(0, limit);
    if (exactLedgers.length) return exactLedgers;
    if (!userName) userName = await pointUserNameFromChatUserId(env, lineUserId);
    const resolved = await resolvePointIdentity(env, { chatLineUserId: lineUserId, userName });
    if (resolved && hasPointSourceLineUsers(resolved.channelLineUserIds)) {
      const mappedLedgers = [];
      for (const sourceKey of sourceKeys) {
        const sourceLineUserId = stringValue(resolved.channelLineUserIds[sourceKey]);
        if (!sourceLineUserId) continue;
        try {
          const snapshot = await fetchWetwPointSnapshot(env, sourceKey, sourceLineUserId, "gift_money", limit);
          mappedLedgers.push(...snapshot.rows.map((row) => ({ ...wetwPointLedgerRow(sourceKey, sourceLineUserId, row), chat_line_user_id: lineUserId, resolved_member_ref: resolved.memberRef })));
        } catch (_err) {
          // Some members only exist in one source.
        }
      }
      return mappedLedgers.sort((a, b) => wetwPointRowRankFromLedger(b) - wetwPointRowRankFromLedger(a)).slice(0, limit);
    }
    return [];
  }
  if (masterMemberRef) {
    const resolved = await resolvePointIdentity(env, { masterMemberRef });
    if (resolved && hasPointSourceLineUsers(resolved.channelLineUserIds)) {
      const ledgers = [];
      const sourceKeys = channelKey ? [channelKey] : [POINT_OA1, POINT_OA2];
      for (const sourceKey of sourceKeys) {
        const sourceLineUserId = stringValue(resolved.channelLineUserIds[sourceKey]);
        if (!sourceLineUserId) continue;
        try {
          const snapshot = await fetchWetwPointSnapshot(env, sourceKey, sourceLineUserId, "gift_money", limit);
          ledgers.push(...snapshot.rows.map((row) => ({ ...wetwPointLedgerRow(sourceKey, sourceLineUserId, row), resolved_member_ref: resolved.memberRef })));
        } catch (_err) {
          // Some members only exist in one source.
        }
      }
      return ledgers.sort((a, b) => wetwPointRowRankFromLedger(b) - wetwPointRowRankFromLedger(a)).slice(0, limit);
    }
    return [];
  }
  return [];
}

function wetwPointLedgerRow(channelKey, lineUserId, row) {
  const delta = Number(row.get_point ?? row.point_delta ?? 0);
  const wetwId = stringValue(row.id || row.point_id || row.ledger_id);
  return {
    id: wetwId || `${channelKey}:${lineUserId}:${wetwPointRowRank(row)}`,
    master_member_ref: stringValue(row.user_id || row.member_ref || row.master_member_ref),
    channel_key: channelKey,
    line_user_id: lineUserId,
    action: delta >= 0 ? "grant" : "deduct",
    point_type: "gift_money",
    point_delta: delta,
    balance_after: Number(row.point_balance ?? row.balance ?? 0),
    source: "wetw-live",
    business_key: wetwId ? `wetw-point:${wetwId}` : "",
    operator_id: stringValue(row.shop_user_lineid),
    operator_name: kPointDisplayText(stringValue(row.child_shop_name || row.shop_user_lineid) || "母站"),
    note: kPointDisplayText([row.event_name, row.event_content || row.shop_remark].map(stringValue).filter(Boolean).join("｜")),
    created_at: stringValue(row.created_at || row.createdAt || row.date || row.datetime),
  };
}

function kPointDisplayText(value) {
  return stringValue(value)
    .replace(/購物金/g, "K點")
    .replace(/增加([0-9]+(?:\.[0-9]+)?)元/g, "增加$1點")
    .replace(/扣除([0-9]+(?:\.[0-9]+)?)元/g, "扣除$1點")
    .replace(/([+-]?[0-9]+(?:\.[0-9]+)?)元/g, "$1點");
}

function wetwPointRowRankFromLedger(row) {
  const businessId = Number(String(row && row.business_key || "").replace(/^wetw-point:/, ""));
  if (Number.isFinite(businessId) && businessId > 0) return businessId;
  const created = Date.parse(stringValue(row && row.created_at));
  return Number.isFinite(created) ? created : 0;
}

async function searchCrmMemberCandidates(env, url) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const q = stringValue(url.searchParams.get("q") || url.searchParams.get("query")).trim();
  const limit = clampNumber(url.searchParams.get("limit") || 12, 1, 30);
  if (!q) return [];
  let rows = await queryCrmMemberCandidates(env, q, limit);
  if (!rows.length) {
    const chars = Array.from(q);
    const hasCjk = /[\u3400-\u9fff]/.test(q);
    if (hasCjk && chars.length > 1) {
      rows = await queryCrmMemberCandidates(env, chars.slice(1).join(""), limit);
    }
  }
  return rows;
}

async function queryCrmMemberCandidates(env, q, limit) {
  const lowered = q.toLowerCase();
  const like = `%${lowered}%`;
  const rows = await env.DB.prepare(`
    SELECT member_ref, name, phone, email, level, source, source_json, updated_at
    FROM crm_members
    WHERE LOWER(member_ref) LIKE ?
       OR LOWER(name) LIKE ?
       OR LOWER(phone) LIKE ?
       OR LOWER(email) LIKE ?
       OR LOWER(source_json) LIKE ?
    ORDER BY
      CASE
        WHEN LOWER(member_ref) = ? THEN 0
        WHEN LOWER(phone) = ? THEN 1
        WHEN LOWER(name) = ? THEN 2
        WHEN LOWER(name) LIKE ? THEN 3
        ELSE 4
      END,
      updated_at DESC
    LIMIT ?
  `).bind(like, like, like, like, like, lowered, lowered, lowered, like, limit).all();

  return (rows.results || []).map((member) => {
    const raw = parseJsonObject(member.source_json);
    return {
      member_ref: stringValue(member.member_ref),
      name: stringValue(member.name || raw.display_name || raw.LINE_display_name),
      phone: stringValue(member.phone || raw.phone),
      line_user_id: crmLineUserId(member),
      line_display_name: stringValue(raw.LINE_display_name || raw.display_name),
      shop_id: stringValue(raw.shop_id || member.level),
      source: stringValue(member.source),
      updated_at: stringValue(member.updated_at),
    };
  }).filter((member) => member.member_ref);
}

async function listCrmMembers(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const q = stringValue(url.searchParams.get("q")).toLowerCase();
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);
  let sql = `
    SELECT member_ref, name, phone, email, level, source, source_json, points_snapshot, updated_at
    FROM crm_members
  `;
  const where = [];
  const bindings = [];
  if (q) {
    where.push("(LOWER(member_ref) LIKE ? OR LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ? OR LOWER(source_json) LIKE ?)");
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY updated_at DESC LIMIT ?";
  bindings.push(limit);

  const rows = await env.DB.prepare(sql).bind(...bindings).all();
  const members = rows.results || [];
  if (!channelKey) return members;

  const links = await env.DB.prepare(`
    SELECT master_member_ref, channel_key, line_user_id, linked_at
    FROM member_line_links
    WHERE channel_key = ?
  `).bind(channelKey).all();
  const linkMap = new Map((links.results || []).map((link) => [link.master_member_ref, link]));
  return members.map((member) => ({ ...member, line_link: linkMap.get(member.member_ref) || null }));
}

async function syncCrmMembers(env, body) {
  const members = Array.isArray(body.members) ? body.members : await fetchWetwArray(env, "members", body || {});
  let count = 0;
  let links = 0;
  for (const item of members) {
    const member = normalizeCrmMember(item);
    if (!member.memberRef) continue;
    await env.DB.prepare(`
      INSERT INTO crm_members (member_ref, name, phone, email, level, source, source_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(member_ref) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        level = excluded.level,
        source = excluded.source,
        source_json = excluded.source_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(member.memberRef, member.name, member.phone, member.email, member.level, member.source, JSON.stringify(item || {})).run();
    const raw = item && typeof item === "object" ? item : {};
    const sourceShopId = stringValue(raw.__source_shop_id || raw.shop_id || member.level);
    const sourceKey = sourceKeyFromShopId(sourceShopId);
    const lineUserId = stringValue(raw.LINE_user_id || raw.user_login || raw.line_user_id || raw.lineUserId);
    if (sourceKey && lineUserId) {
      await env.DB.prepare(`
        INSERT INTO member_line_links (master_member_ref, channel_key, line_user_id, binding_code, linked_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(master_member_ref, channel_key) DO UPDATE SET
          line_user_id = excluded.line_user_id,
          binding_code = excluded.binding_code,
          linked_at = CURRENT_TIMESTAMP
      `).bind(member.memberRef, sourceKey, lineUserId, `sync:${sourceShopId}`).run();
      links += 1;
    }
    count += 1;
  }
  await writeCrmSyncLog(env, "members", count, "success", body.members ? "body" : "wetw");
  return { count, links, source: body.members ? "body" : "wetw" };
}

async function syncCrmPoints(env, body) {
  const rows = await resolvePointSyncRows(env, body || {});
  let count = 0;
  const latestAccountRows = new Map();
  for (const item of rows) {
    const channelKey = stringValue(item.channel_key || item.channelKey || item.oa || body.channel_key || POINT_OA1);
    const lineUserId = stringValue(item.line_user_id || item.lineUserId || item.LINE_user_id || item.userId);
    const pointType = normalizeWetwPointType(item.point_type || item.pointType || wetwPointRowTypeText(item)) || "gift_money";
    const balance = Number(item.point_balance ?? item.balance ?? item.points ?? item.get_point ?? 0);
    if (!channelKey || !lineUserId || !Number.isFinite(balance)) continue;
    const accountKey = `${channelKey}:${lineUserId}:${pointType}`;
    const masterMemberRef = stringValue(item.master_member_ref || item.member_ref || item.memberRef || item.user_id) || null;
    const wetwPointId = stringValue(item.id || item.point_id || item.ledger_id);
    const businessKey = wetwPointId ? `wetw-point:${wetwPointId}` : `wetw-sync:${accountKey}:${pointType}:${lineUserId}`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(accountKey, masterMemberRef, channelKey, lineUserId, pointType, balance).run();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO point_ledger (account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(accountKey, masterMemberRef, channelKey, lineUserId, "sync", pointType, Number(item.get_point || 0), balance, "wetw", businessKey, "WETW read-only sync").run();
    const rank = wetwPointRowRank(item);
    const latest = latestAccountRows.get(accountKey);
    if (!latest || rank > latest.rank) {
      latestAccountRows.set(accountKey, { accountKey, masterMemberRef, channelKey, lineUserId, pointType, balance, rank });
    }
    count += 1;
  }
  for (const row of latestAccountRows.values()) {
    await env.DB.prepare(`
      INSERT INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(account_key) DO UPDATE SET
        master_member_ref = excluded.master_member_ref,
        balance = excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `).bind(row.accountKey, row.masterMemberRef, row.channelKey, row.lineUserId, row.pointType, row.balance).run();
  }
  await writeCrmSyncLog(env, "points", count, "success", body.points ? "body" : "wetw");
  return { count, source: body.points ? "body" : "wetw" };
}

function wetwPointRowRank(item) {
  const id = Number(item && (item.id || item.point_id || item.ledger_id));
  if (Number.isFinite(id) && id > 0) return id;
  const created = Date.parse(stringValue(item && (item.created_at || item.createdAt || item.date || item.datetime)));
  if (Number.isFinite(created)) return created;
  return 0;
}

function normalizeWetwPointType(value) {
  const raw = stringValue(value).trim().toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/[\s_-]+/g, "");
  if (["giftmoney", "kpoint", "kpoints", "k點", "購物金", "系統k點"].includes(compact)) return "gift_money";
  if (["systempoint", "系統點數", "原始點數"].includes(compact)) return "system_point";
  return raw;
}

function normalizePointType(value) {
  return normalizeWetwPointType(value) || "gift_money";
}

function wetwPointRowTypeText(row) {
  return [row && row.point_type, row && row.pointType, row && row.event_name, row && row.event_content, row && row.shop_remark]
    .map((value) => stringValue(value))
    .filter(Boolean)
    .join(" ");
}

function wetwPointRowIsSystemPoint(row) {
  const type = normalizeWetwPointType(row && (row.point_type || row.pointType));
  if (type === "system_point") return true;
  const text = wetwPointRowTypeText(row);
  return /系統點數|原始點數/.test(text) && !/購物金|K點|k點|系統K點/i.test(text);
}

function wetwPointRowMatchesType(row, pointType) {
  const requested = normalizeWetwPointType(pointType || "gift_money");
  const explicitType = normalizeWetwPointType(row && (row.point_type || row.pointType));
  if (explicitType) return explicitType === requested;
  if (requested !== "gift_money") return false;
  const text = wetwPointRowTypeText(row);
  if (/購物金|K點|k點|系統K點/i.test(text)) return true;
  if (/系統點數|原始點數/.test(text)) return false;
  return false;
}

async function resolvePointSyncRows(env, body) {
  if (Array.isArray(body.points)) return body.points;
  const explicitChannel = stringValue(body.channel_key || body.channelKey);
  const explicitShop = stringValue(body.shop_id || body.shopId);
  if (explicitChannel || explicitShop) {
    const rows = await fetchWetwArray(env, "points", body);
    return rows.map((item) => ({
      ...item,
      channel_key: stringValue(item.channel_key || item.channelKey || item.oa || explicitChannel || sourceKeyFromShopId(explicitShop) || POINT_OA1),
    }));
  }

  const defaultChannel = stringValue(body.default_channel_key || body.defaultChannelKey) || POINT_OA1;
  const rows = await fetchWetwArray(env, "points", { ...body, shop_id: pointApiShopId(env, defaultChannel), channel_key: defaultChannel });
  return rows.map((item) => ({
    ...item,
    channel_key: stringValue(item.channel_key || item.channelKey || item.oa || defaultChannel),
  }));
}

function sourceKeyFromShopId(shopId) {
  const normalized = String(shopId || "").trim();
  return Object.entries(POINT_SOURCE_META).find(([, meta]) => String(meta.shopId) === normalized)?.[0] || "";
}

async function fetchWetwArray(env, type, options = {}) {
  const url = type === "members" ? env.WETW_MEMBERS_URL : (env.WETW_POINTS_URL || DEFAULT_WETW_POINT_QUERY_URL);
  if (!url) throw httpError(`${type === "members" ? "WETW_MEMBERS_URL" : "WETW_POINTS_URL"} is not configured. You can POST an array in the request body first.`, 400);
  if (type === "members") return fetchWetwMembersFromWordPress(env, url, options);
  return fetchWetwPointListFromWordPress(env, url, options);
}

async function fetchWetwMembersFromWordPress(env, url, options = {}) {
  if (!env.POINT_API_KEY) throw httpError("POINT_API_KEY is not configured", 400);
  const shopIds = memberSyncShopIds(env, options);
  const all = [];

  for (const shopId of shopIds) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: env.POINT_API_KEY,
        shop_id: shopId,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = stringValue(data.code);
      const message = stringValue(data.message);
      throw httpError(`WETW members sync failed: ${response.status}${code ? ` ${code}` : ""}${message ? ` - ${message}` : ""}`, 502);
    }
    const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
    const rows = Array.isArray(data.members) ? data.members : Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : list;
    for (const row of rows) {
      all.push({ ...(row || {}), __source_shop_id: shopId });
    }
  }
  return all;
}

function memberSyncShopIds(env, options = {}) {
  const explicit = options.shop_ids || options.shopIds || options.shop_id || options.shopId;
  const values = [];
  if (Array.isArray(explicit)) {
    values.push(...explicit);
  } else if (explicit !== undefined && explicit !== null && explicit !== "") {
    values.push(...String(explicit).split(","));
  } else if (env.WETW_MEMBER_SHOP_IDS) {
    values.push(...String(env.WETW_MEMBER_SHOP_IDS).split(","));
  } else {
    values.push(env.WETW_SHOP_ID, POINT_SOURCE_META[POINT_OA1].shopId, POINT_SOURCE_META[POINT_OA2].shopId);
  }
  const normalized = [];
  for (const value of values) {
    const shopId = Number(value);
    if (Number.isFinite(shopId) && shopId > 0 && !normalized.includes(shopId)) normalized.push(shopId);
  }
  if (!normalized.length) normalized.push(wetwShopId(env));
  return normalized;
}

async function fetchWetwPointListFromWordPress(env, url, options = {}) {
  if (!env.POINT_API_KEY) throw httpError("POINT_API_KEY is not configured", 400);
  const shopId = Number(options.shop_id || options.shopId || env.WETW_SHOP_ID || 216);
  if (!Number.isFinite(shopId) || shopId <= 0) throw httpError("WETW_SHOP_ID must be a positive integer", 400);
  const basePayload = {
    api_key: env.POINT_API_KEY,
    shop_id: shopId,
    LINE_user_id: stringValue(options.LINE_user_id || options.line_user_id || options.lineUserId),
    point_type: stringValue(options.point_type || options.pointType),
    date_start: stringValue(options.date_start || options.dateStart),
    date_end: stringValue(options.date_end || options.dateEnd),
  };
  const perPage = clampNumber(options.per_page || options.perPage || 100, 1, 100);
  const firstPage = clampNumber(options.page || 1, 1, 100000);
  const maxPages = clampNumber(options.max_pages || options.maxPages || env.WETW_POINTS_MAX_PAGES || 5, 1, 20);
  const all = [];
  let totalPages = firstPage;
  const lastAllowedPage = firstPage + maxPages - 1;

  for (let page = firstPage; page <= totalPages && page <= lastAllowedPage; page += 1) {
    const payload = compactObject({ ...basePayload, page, per_page: perPage });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const code = stringValue(data.code);
      const message = stringValue(data.message);
      throw httpError(`WETW points sync failed: ${response.status}${code ? ` ${code}` : ""}${message ? ` - ${message}` : ""}`, response.ok ? 502 : response.status);
    }
    const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
    all.push(...list);
    totalPages = Number(data && data.data && data.data.pagination && data.data.pagination.total_pages) || page;
    if (!list.length) break;
  }
  return all;
}

function wetwShopId(env) {
  const shopId = Number(env.WETW_SHOP_ID || 216);
  if (!Number.isFinite(shopId) || shopId <= 0) throw httpError("WETW_SHOP_ID must be a positive integer", 400);
  return shopId;
}

function compactObject(input) {
  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  });
  return output;
}

function normalizeCrmMember(item) {
  return {
    memberRef: stringValue(item.member_ref || item.memberRef || item.ID || item.id || item.user_login || item.LINE_user_id || item.user_id || item.customer_id),
    name: stringValue(item.name || item.display_name || item.LINE_display_name || item.customer_name),
    phone: stringValue(item.phone || item.mobile || item.tel),
    email: stringValue(item.email || item.mail),
    level: stringValue(item.level || item.rank || item.member_level || item.shop_id),
    source: stringValue(item.source || "wetw"),
  };
}

async function writeCrmSyncLog(env, syncType, rows, status, source) {
  await env.DB.prepare(`
    INSERT INTO crm_sync_logs (sync_type, source, rows_count, status, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(syncType, source, rows, status).run();
}

async function listSmartMonitorData(env, url) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const days = clampNumber(url.searchParams.get("days") || 7, 1, 90);
  const statsUrl = new URL("https://local/admin/points/stats-data");
  statsUrl.searchParams.set("days", String(days));
  statsUrl.searchParams.set("scope", "ops");
  statsUrl.searchParams.set("channel_key", POINT_OA1);
  statsUrl.searchParams.set("point_type", "gift_money");
  const stats = await listPointDailyStats(env, statsUrl);
  const date = stringValue(url.searchParams.get("date") || taipeiDate()).slice(0, 10);
  const nextDate = addDaysDateString(date, 1);
  const checkinRows = await env.DB.prepare(`
    WITH checkins AS (
      SELECT line_user_id, '' AS master_member_ref, COUNT(*) AS hits, MIN(datetime(line_timestamp/1000,'unixepoch','+8 hours')) AS first_tw, MAX(datetime(line_timestamp/1000,'unixepoch','+8 hours')) AS last_tw
      FROM webhook_events
      WHERE channel_key = ?
        AND message_type = 'text'
        AND message_text = '會員打卡'
        AND line_timestamp >= strftime('%s', ?, '-8 hours') * 1000
        AND line_timestamp < strftime('%s', ?, '-8 hours') * 1000
      GROUP BY line_user_id
    ), rewards AS (
      SELECT line_user_id, SUM(points) AS points, MAX(balance_after) AS balance_after, MAX(updated_at) AS updated_at
      FROM daily_keyword_rewards
      WHERE reward_date = ?
        AND channel_key = ?
        AND point_type = 'gift_money'
        AND status = 'claimed'
      GROUP BY line_user_id
    )
    SELECT c.line_user_id, ${pointStatsUserNameSql("c")} AS user_name, c.hits, c.first_tw, c.last_tw, COALESCE(r.points,0) AS points, r.balance_after, r.updated_at,
           CASE WHEN r.line_user_id IS NULL THEN 1 ELSE 0 END AS missing
    FROM checkins c
    LEFT JOIN rewards r ON r.line_user_id = c.line_user_id
    ORDER BY c.first_tw DESC
    LIMIT 240
  `).bind(POINT_OA1, `${date} 00:00:00`, `${nextDate} 00:00:00`, date, POINT_OA1).all();
  const checkins = (checkinRows.results || []).map((row) => ({
    line_user_id: stringValue(row.line_user_id),
    user_name: pointStatsMemberName(row),
    hits: Number(row.hits || 0),
    first_tw: stringValue(row.first_tw),
    last_tw: stringValue(row.last_tw),
    points: Number(row.points || 0),
    balance_after: Number(row.balance_after || 0),
    updated_at: stringValue(row.updated_at),
    missing: Boolean(row.missing),
  }));
  const checkinSummary = checkins.reduce((sum, row) => {
    sum.users += 1;
    sum.messages += Number(row.hits || 0);
    if (row.missing) sum.missing += 1;
    else {
      sum.rewarded += 1;
      sum.points += Number(row.points || 0);
    }
    return sum;
  }, { date, users: 0, messages: 0, rewarded: 0, missing: 0, points: 0 });
  const todayStart = taipeiStartOfDay(Date.now());
  const [chatStats, todayUserMessages, todayAdminReplies, recentThreads] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done,
             SUM(CASE WHEN risk = 'high' THEN 1 ELSE 0 END) AS high_risk
      FROM threads
      WHERE floor_id = ?
    `).bind(STATUS_PENDING, STATUS_IMPORTANT, STATUS_DONE, FLOOR_MAIN).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?").bind(FLOOR_MAIN, USER_ROLE, todayStart).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE floor_id = ? AND sender_role = ? AND created_at >= ?").bind(FLOOR_MAIN, ADMIN_ROLE, todayStart).first(),
    env.DB.prepare(`
      SELECT t.id, t.user_id, t.display_name, t.summary, t.status, t.risk, t.last_message_at,
             (SELECT m.text FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id ORDER BY m.created_at DESC LIMIT 1) AS latest_text,
             (SELECT m.sender_role FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id ORDER BY m.created_at DESC LIMIT 1) AS latest_sender,
             (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.floor_id = t.floor_id) AS message_count
      FROM threads t
      WHERE t.floor_id = ?
      ORDER BY t.last_message_at DESC
      LIMIT 80
    `).bind(FLOOR_MAIN).all(),
  ]);
  const chatThreads = (recentThreads.results || []).map((row) => ({
    id: stringValue(row.id),
    user_id: stringValue(row.user_id),
    display_name: stringValue(row.display_name) || stringValue(row.user_id),
    summary: stringValue(row.summary),
    status: normalizeStatusForDisplay(row.status),
    risk: stringValue(row.risk) || "low",
    last_message_at: Number(row.last_message_at || 0),
    last_message_at_text: row.last_message_at ? formatTaipeiTimestamp(row.last_message_at) : "-",
    latest_text: stringValue(row.latest_text),
    latest_sender: stringValue(row.latest_sender),
    message_count: Number(row.message_count || 0),
  }));
  const chatMonitor = {
    floor: FLOOR_MAIN,
    label: "康立智能聊天室",
    total: Number(chatStats && chatStats.total || 0),
    pending: Number(chatStats && chatStats.pending || 0),
    done: Number(chatStats && chatStats.done || 0),
    high_risk: Number(chatStats && chatStats.high_risk || 0),
    today_user_messages: Number(todayUserMessages && todayUserMessages.count || 0),
    today_admin_replies: Number(todayAdminReplies && todayAdminReplies.count || 0),
    threads: chatThreads,
  };
  return { source: POINT_SOURCE_META[POINT_OA1], days, stats, checkinSummary, checkins, chatMonitor };
}

function formatTaipeiTimestamp(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function addDaysDateString(date, days) {
  const raw = stringValue(date).slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date();
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function smartMonitorHtml(headers) {
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>康立智能監控</title>
  <style>
    :root{--line:#06c755;--ink:#172033;--muted:#718096;--border:#dfe5ec;--soft:#f6f8fb;--dark:#061536;--bad:#b42318;--blue:#175cd3}
    *{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}button,select{font:inherit}button{cursor:pointer}
    .app{display:grid;grid-template-columns:400px minmax(680px,1fr);height:100vh;background:#fff}.left{border-right:1px solid var(--border);min-height:0;background:#fff}.main{min-width:0;min-height:0;display:flex;flex-direction:column;background:#f7f9fc}.brand{height:112px;display:flex;align-items:center;gap:14px;padding:22px 26px;border-bottom:1px solid var(--border);background:#fff}.oa{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;background:var(--line);color:#fff;font-size:20px;font-weight:780;box-shadow:0 10px 24px rgba(6,199,85,.18)}.brand h1{margin:0;font-size:24px;line-height:1.2;font-weight:760}.brand p{margin:5px 0 0;color:var(--muted);font-size:15px;line-height:1.35}.floorTabs{display:flex;gap:8px;padding:12px 18px;background:#fbfcfe;border-bottom:1px solid #eef2f7}.floorTab,.monitorTab,.syncBtn{height:36px;border:0;border-radius:999px;background:#eef2f7;color:#536072;padding:0 14px;font-weight:740;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.floorTab.active,.monitorTab.active{background:#e7f8ef;color:#067a35;box-shadow:inset 0 0 0 1px #9be2b8}.syncBtn{margin-left:auto;border:1px solid #b6ecc8;background:#fff;color:#067a35}.side{padding:20px 24px;display:grid;gap:14px}.sideTitle{font-size:14px;font-weight:760;color:#243149}.sideNote{color:var(--muted);line-height:1.6}.toolbar{display:grid;gap:8px}.toolbar label{font-weight:760;color:#243149}.toolbar select,.toolbar button{height:42px;border:1px solid #d7deea;border-radius:12px;background:#fff;color:#243149;padding:0 12px;font-weight:720}.toolbar button{background:#effcf4;color:#067a35;border-color:#b6ecc8}.head{height:112px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 28px;border-bottom:1px solid var(--border);background:#fff}.head h2{margin:0;font-size:30px;line-height:1.15;font-weight:760}.head p{margin:6px 0 0;color:var(--muted);font-size:16px}.headActions{display:flex;gap:10px;flex-wrap:wrap}.headActions a{height:42px;border:1px solid #d7deea;border-radius:12px;background:#fff;color:#243149;padding:0 14px;font-weight:720;text-decoration:none;display:inline-flex;align-items:center}.content{min-height:0;overflow:auto;padding:24px 28px}.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.card,.panel{background:#fff;border:1px solid #e8edf4;border-radius:12px;box-shadow:0 8px 20px rgba(16,24,40,.04)}.card{padding:16px}.label{font-size:13px;color:#667085;font-weight:720}.metric{margin-top:8px;font-size:30px;font-weight:760;letter-spacing:0}.good{color:#067a35}.bad{color:var(--bad)}.net{color:var(--blue)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.panel{margin-top:16px;overflow:hidden}.grid .panel{margin-top:0}.panel h2{margin:0;padding:15px 18px;border-bottom:1px solid #edf1f5;font-size:18px;font-weight:760;color:#172033}table{width:100%;border-collapse:collapse}th,td{padding:12px 14px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top}th{font-size:12px;color:#667085;background:#f8fafc;font-weight:760}.right{text-align:right}.uid{font-size:12px;color:#64748b;word-break:break-all}.pill{display:inline-flex;border-radius:999px;padding:5px 10px;background:#ecfdf3;color:#067a35;font-size:12px;font-weight:760}.pill.bad{background:#fff1f3;color:#c01048}.empty{padding:24px;color:#667085}.error{display:none;margin-bottom:14px;padding:12px 14px;border:1px solid #fecdd3;border-radius:12px;background:#fff1f3;color:#be123c;font-weight:760}.tableWrap{overflow:auto}
    @media(max-width:1100px){.app{grid-template-columns:1fr;height:auto;min-height:100vh}.left{border-right:0;border-bottom:1px solid var(--border)}.head{height:auto;align-items:flex-start;flex-direction:column}.content{padding:16px}.cards,.grid{grid-template-columns:1fr}.brand{height:auto}.metric{font-size:24px}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="left">
      <header class="brand"><div class="oa">KL</div><div><h1>KLINK 客服系統</h1><p>康立智能監控，不自動回覆</p></div></header>
      <div class="floorTabs"><a class="floorTab" href="/dashboard?floor=main">產品客服</a><a class="floorTab" href="/dashboard?floor=admin">行政客服</a><a class="monitorTab active" href="/admin/smart-monitor">康立智能監控</a><a class="syncBtn" href="/console">主控台</a></div>
      <section class="side"><div class="sideTitle">監控範圍</div><div class="sideNote">固定顯示康立智能 1086 的聊天室、今日會員打卡與 K 點流水。產品客服與行政客服帳號都可以查看。</div><div class="toolbar"><label for="days">期間</label><select id="days"><option value="7" selected>近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select><button id="refresh" type="button">重新整理</button></div></section>
    </aside>
    <main class="main">
      <header class="head"><div><h2>康立智能監控</h2><p>聊天室、打卡贈點、K 點進出集中查看</p></div><div class="headActions"><a href="/dashboard?floor=main">產品客服</a><a href="/dashboard?floor=admin">行政客服</a></div></header>
      <section class="content">
        <div id="error" class="error"></div>
        <section class="cards"><div class="card"><div class="label">聊天室總數</div><div id="chatTotal" class="metric">0</div></div><div class="card"><div class="label">待處理聊天室</div><div id="chatPending" class="metric bad">0</div></div><div class="card"><div class="label">今日用戶訊息</div><div id="todayMessages" class="metric net">0</div></div><div class="card"><div class="label">今日客服回覆</div><div id="todayReplies" class="metric good">0</div></div><div class="card"><div class="label">高風險聊天室</div><div id="highRisk" class="metric bad">0</div></div></section>
        <section class="cards" style="margin-top:12px"><div class="card"><div class="label">今日打卡人數</div><div id="checkinUsers" class="metric">0</div></div><div class="card"><div class="label">今日已贈點</div><div id="rewarded" class="metric good">0</div></div><div class="card"><div class="label">今日缺漏</div><div id="missing" class="metric bad">0</div></div><div class="card"><div class="label">今日贈點合計</div><div id="checkinPoints" class="metric good">0</div></div><div class="card"><div class="label">期間淨增減</div><div id="net" class="metric net">0</div></div></section>
        <section class="panel"><h2>聊天室監控</h2><div class="tableWrap"><table><thead><tr><th>聊天室</th><th>最新時間</th><th>狀態</th><th>風險</th><th class="right">訊息數</th><th>最新訊息</th></tr></thead><tbody id="chatrooms"></tbody></table></div></section>
        <section class="grid"><div class="panel"><h2>今日打卡名單</h2><div class="tableWrap"><table><thead><tr><th>會員</th><th>打卡時間</th><th class="right">次數</th><th class="right">點數</th><th>狀態</th></tr></thead><tbody id="checkins"></tbody></table></div></div><div class="panel"><h2>每日 K 點進出</h2><div class="tableWrap"><table><thead><tr><th>日期</th><th class="right">贈點</th><th class="right">扣點</th><th class="right">淨額</th><th class="right">人數</th></tr></thead><tbody id="daily"></tbody></table></div></div></section>
        <section class="panel"><h2>最近康立智能流水</h2><div class="tableWrap"><table><thead><tr><th>時間</th><th>會員</th><th>UID</th><th class="right">進出</th><th class="right">餘額</th><th>備註</th></tr></thead><tbody id="recent"></tbody></table></div></section>
      </section>
    </main>
  </div>
<script>
const $=id=>document.getElementById(id);const fmt=n=>Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const signed=n=>{const v=Number(n||0);return (v>0?'+':'')+fmt(v)};function empty(cols,msg){return '<tr><td class="empty" colspan="'+cols+'">'+esc(msg)+'</td></tr>'}
async function load(){ $('error').style.display='none'; try{const p=new URLSearchParams({days:$('days').value});const res=await fetch('/admin/smart-monitor-data?'+p.toString(),{credentials:'same-origin'}); if(res.status===401){location.href='/login?next=/admin/smart-monitor';return} const json=await res.json().catch(()=>({})); if(!res.ok||json.status!=='success') throw new Error(json.message||'讀取失敗'); render(json.data||{});}catch(err){$('error').textContent=err&&err.message?err.message:String(err);$('error').style.display='block';}}
function render(data){const s=data.checkinSummary||{}, stats=data.stats||{}, totals=stats.totals||{}, chat=data.chatMonitor||{};$('chatTotal').textContent=fmt(chat.total);$('chatPending').textContent=fmt(chat.pending);$('todayMessages').textContent=fmt(chat.today_user_messages);$('todayReplies').textContent=fmt(chat.today_admin_replies);$('highRisk').textContent=fmt(chat.high_risk);$('checkinUsers').textContent=fmt(s.users);$('rewarded').textContent=fmt(s.rewarded);$('missing').textContent=fmt(s.missing);$('checkinPoints').textContent=fmt(s.points);$('net').textContent=signed(totals.net_points);const rooms=chat.threads||[];$('chatrooms').innerHTML=rooms.length?rooms.map(r=>'<tr><td><strong>'+esc(r.display_name||'未命名')+'</strong><div class="uid">'+esc(r.user_id)+'</div></td><td>'+esc(r.last_message_at_text||'-')+'</td><td><span class="pill '+(r.status==='處理完畢'?'':'bad')+'">'+esc(r.status||'待處理')+'</span></td><td>'+esc(r.risk==='high'?'高風險':'低風險')+'</td><td class="right">'+fmt(r.message_count)+'</td><td>'+esc(r.latest_text||r.summary||'')+'</td></tr>').join(''):empty(6,'目前沒有聊天室資料');const checkins=data.checkins||[];$('checkins').innerHTML=checkins.length?checkins.map(r=>'<tr><td><strong>'+esc(r.user_name||'未命名')+'</strong><div class="uid">'+esc(r.line_user_id)+'</div></td><td>'+esc(r.first_tw||'')+'</td><td class="right">'+fmt(r.hits)+'</td><td class="right good">'+fmt(r.points)+'</td><td>'+(r.missing?'<span class="pill bad">缺漏</span>':'<span class="pill">已贈點</span>')+'</td></tr>').join(''):empty(5,'今天尚無會員打卡');const daily=stats.daily||[];$('daily').innerHTML=daily.length?daily.map(r=>'<tr><td><strong>'+esc(r.day)+'</strong></td><td class="right good">'+fmt(r.grant_points)+'</td><td class="right bad">'+fmt(r.deduct_points)+'</td><td class="right net">'+signed(r.net_points)+'</td><td class="right">'+fmt(r.unique_users)+'</td></tr>').join(''):empty(5,'目前沒有 K 點進出');const recent=stats.recent||[];$('recent').innerHTML=recent.length?recent.map(r=>'<tr><td>'+esc(r.created_at_text||r.created_at)+'</td><td><strong>'+esc(r.user_name||'未命名')+'</strong></td><td class="uid">'+esc(r.line_user_id)+'</td><td class="right '+(Number(r.point_delta)>=0?'good':'bad')+'">'+signed(r.point_delta)+'</td><td class="right">'+fmt(r.balance_after)+'</td><td>'+esc(r.note||r.operator_name||r.action)+'</td></tr>').join(''):empty(6,'目前沒有流水');}
$('days').addEventListener('change',load);$('refresh').addEventListener('click',load);load();
</script>
</body>
</html>`, { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
function pointStatsHtml(headers) {
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KLINK 點數統計</title>
  <style>
    :root{--green:#06c755;--ink:#0f172a;--muted:#64748b;--border:#d8e0eb;--bg:#f6f8fb;--bad:#b42318;--orange:#f97316}
    *{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans TC",sans-serif;background:var(--bg);color:var(--ink)}
    header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid var(--border);padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
    h1{margin:0;font-size:28px;line-height:1.2}.sub{margin-top:6px;color:var(--muted);font-size:14px}.wrap{padding:22px;max-width:1500px;margin:0 auto}
    .toolbar{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;margin-bottom:16px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:13px;font-weight:800;color:#334155}
    select,input,button{font:inherit;border:1px solid var(--border);border-radius:10px;background:#fff;padding:12px 14px;color:var(--ink)}button{cursor:pointer;font-weight:900}.primary{background:var(--green);border-color:var(--green);color:#fff}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.card,.panel{background:#fff;border:1px solid var(--border);border-radius:14px}.card{padding:16px}.label{font-size:13px;color:var(--muted);font-weight:800}.metric{margin-top:8px;font-size:30px;font-weight:900}.good{color:#0f8a43}.bad{color:var(--bad)}.net{color:#1d4ed8}
    .grid{display:grid;grid-template-columns:1.4fr .9fr;gap:16px;margin-top:16px}.panel h2{font-size:20px;margin:0;padding:16px 18px;border-bottom:1px solid var(--border)}
    table{width:100%;border-collapse:collapse}th,td{padding:12px 14px;border-bottom:1px solid #edf1f7;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left}th{font-size:13px;color:#475569;background:#f8fafc}.empty{padding:26px;color:var(--muted)}
    .pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;background:#eef2ff;color:#1e3a8a;font-size:12px;font-weight:900}.muted{color:var(--muted)}.recent{margin-top:16px}.name{font-weight:900;text-align:left}.members{display:flex;flex-wrap:wrap;gap:6px;max-width:460px}.member{display:inline-flex;border-radius:999px;background:#ecfdf5;color:#047857;padding:4px 8px;font-size:12px;font-weight:800}.uid{font-size:12px;color:#64748b;word-break:break-all}.note{max-width:360px;text-align:left;color:#475569}.error{margin:14px 0;padding:14px 16px;border-radius:12px;background:#fff1f2;color:#be123c;border:1px solid #fecdd3;display:none}
    @media(max-width:1000px){.toolbar,.cards,.grid{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}.wrap{padding:14px}th,td{padding:10px 8px;font-size:13px}.tableWrap{overflow:auto}.metric{font-size:24px}}
  </style>
</head>
<body>
  <header>
    <div><h1>點數統計</h1><div class="sub">每日 K 點進出、扣贈統計與最近流水。資料來源：本系統 point_ledger。</div></div>
    <button onclick="location.href='/console'">回主控台</button>
  </header>
  <main class="wrap">
    <section class="toolbar">
      <div class="field"><label>期間</label><select id="days"><option value="7">近 7 天</option><option value="30" selected>近 30 天</option><option value="90">近 90 天</option><option value="180">近 180 天</option><option value="366">近 366 天</option></select></div>
      <div class="field"><label>統計範圍</label><select id="scope"><option value="ops" selected>營運進出</option><option value="all">含同步/匯入</option></select></div>
      <div class="field"><label>平台</label><select id="channel"><option value="">全部平台</option><option value="oa1">康立智能 1086</option><option value="oa2">康立全球 1584</option></select></div>
      <div class="field"><label>K 點類型</label><input id="pointType" value="gift_money" /></div>
      <div class="field"><label>&nbsp;</label><button id="refresh" class="primary">重新整理</button></div>
    </section>
    <div id="error" class="error"></div>
    <section class="cards">
      <div class="card"><div class="label">總贈點</div><div id="grant" class="metric good">0</div></div>
      <div class="card"><div class="label">總扣點</div><div id="deduct" class="metric bad">0</div></div>
      <div class="card"><div class="label">淨增減</div><div id="net" class="metric net">0</div></div>
      <div class="card"><div class="label">流水筆數</div><div id="transactions" class="metric">0</div></div>
      <div class="card"><div class="label">每日觸及人次加總</div><div id="users" class="metric">0</div></div>
    </section>
    <section class="grid">
      <div class="panel"><h2>每日進出</h2><div class="tableWrap"><table><thead><tr><th>日期</th><th>會員</th><th>贈點</th><th>扣點</th><th>淨額</th><th>筆數</th><th>人數</th></tr></thead><tbody id="daily"></tbody></table></div></div>
      <div class="panel"><h2>來源分類</h2><div class="tableWrap"><table><thead><tr><th>類型</th><th>來源</th><th>贈</th><th>扣</th><th>淨</th></tr></thead><tbody id="breakdown"></tbody></table></div></div>
    </section>
    <section class="panel recent"><h2>最近流水</h2><div class="tableWrap"><table><thead><tr><th>時間</th><th>會員</th><th>平台</th><th>UID</th><th>進出</th><th>餘額</th><th>備註</th></tr></thead><tbody id="recent"></tbody></table></div></section>
  </main>
<script>
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function trEmpty(cols,msg){return '<tr><td class="empty" colspan="'+cols+'">'+esc(msg)+'</td></tr>';}
function signed(n){const v=Number(n||0);return (v>0?'+':'')+fmt(v);}
function memberBadges(members){const list=Array.isArray(members)?members:[];return '<div class="members">'+(list.length?list.map(m=>'<span class="member">'+esc(m.name||m.line_user_id||'未命名')+'</span>').join(''):'<span class="muted">無名單</span>')+'</div>';}
async function load(){
  $('error').style.display='none';
  const params=new URLSearchParams({days:$('days').value,scope:$('scope').value,point_type:$('pointType').value.trim()||'gift_money'});
  if($('channel').value) params.set('channel_key',$('channel').value);
  try{
    const res=await fetch('/admin/points/stats-data?'+params.toString(),{credentials:'same-origin'});
    if(res.status===401){location.href='/login?next=/admin/points/stats';return;}
    const json=await res.json().catch(()=>({}));
    if(!res.ok||json.status!=='success') throw new Error(json.message||'讀取失敗');
    render(json.data||{});
  }catch(err){$('error').textContent=err&&err.message?err.message:String(err);$('error').style.display='block';}
}
function render(data){
  const totals=data.totals||{};
  $('grant').textContent=fmt(totals.grant_points);
  $('deduct').textContent=fmt(totals.deduct_points);
  $('net').textContent=signed(totals.net_points);
  $('transactions').textContent=fmt(totals.transactions);
  $('users').textContent=fmt(totals.users);
  const daily=data.daily||[];
  $('daily').innerHTML=daily.length?daily.map(r=>'<tr><td><strong>'+esc(r.day)+'</strong></td><td>'+memberBadges(r.members)+'</td><td class="good">'+fmt(r.grant_points)+'</td><td class="bad">'+fmt(r.deduct_points)+'</td><td class="net">'+signed(r.net_points)+'</td><td>'+fmt(r.transactions)+'</td><td>'+fmt(r.unique_users)+'</td></tr>').join(''):trEmpty(7,'目前沒有點數進出資料');
  const breakdown=data.breakdown||[];
  $('breakdown').innerHTML=breakdown.length?breakdown.map(r=>'<tr><td><span class="pill">'+esc(r.action||'-')+'</span></td><td>'+esc(r.source||'-')+'</td><td class="good">'+fmt(r.grant_points)+'</td><td class="bad">'+fmt(r.deduct_points)+'</td><td>'+signed(r.net_points)+'</td></tr>').join(''):trEmpty(5,'目前沒有分類資料');
  const recent=data.recent||[];
  $('recent').innerHTML=recent.length?recent.map(r=>'<tr><td>'+esc(r.created_at_text||r.created_at)+'</td><td class="name">'+esc(r.user_name||'未命名會員')+'</td><td>'+esc(r.source_label||r.channel_key)+'</td><td class="uid">'+esc(r.line_user_id)+'</td><td class="'+(Number(r.point_delta)>=0?'good':'bad')+'">'+signed(r.point_delta)+'</td><td>'+fmt(r.balance_after)+'</td><td class="note">'+esc(r.note||r.operator_name||r.action)+'</td></tr>').join(''):trEmpty(7,'目前沒有流水');
}
['days','scope','channel'].forEach(id=>$(id).addEventListener('change',load));
$('refresh').addEventListener('click',load);
load();
</script>
</body>
</html>`, { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
function crmAdminToolHtml(headers) {
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KLINK CRM / K點模組</title>
  <style>
    :root{--line:#06c755;--ink:#172033;--muted:#667085;--border:#dbe3ee;--soft:#f6f8fb;--navy:#071833;--orange:#ff8a00;--red:#d92d20}
    *{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif}
    .shell{min-height:100vh;display:grid;grid-template-columns:320px minmax(0,1fr)}
    aside{background:#fff;border-right:1px solid var(--border);padding:24px;display:flex;flex-direction:column;gap:18px}
    main{padding:24px;display:grid;gap:16px;align-content:start}
    h1,h2,h3,p{margin:0}.brand{display:flex;align-items:center;gap:12px}.logo{width:52px;height:52px;border-radius:16px;background:var(--line);color:#fff;display:grid;place-items:center;font-weight:900}.brand h1{font-size:24px}.muted,p{color:var(--muted);font-size:14px;line-height:1.5}
    .panel,.card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:18px;box-shadow:0 10px 26px rgba(16,24,40,.04)}
    .panel h2,.card h2{font-size:17px;margin-bottom:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.kpi{background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px}.kpi strong{display:block;font-size:30px;margin-top:8px}
    label{display:block;font-size:13px;color:#4b5563;font-weight:800;margin:10px 0 6px}
    input,select{width:100%;min-height:42px;border:1px solid var(--border);border-radius:12px;padding:9px 12px;background:#fff;outline:none}input:focus,select:focus{border-color:var(--line);box-shadow:0 0 0 3px rgba(6,199,85,.12)}
    button{min-height:42px;border:0;border-radius:12px;background:var(--line);color:#fff;font-weight:850;padding:0 16px;cursor:pointer}button.secondary{background:#eff4fb;color:var(--ink);border:1px solid var(--border)}button.dark{background:var(--navy)}button.warn{background:var(--orange)}button:disabled{opacity:.55;cursor:not-allowed}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:end}.tableWrap{overflow:auto;border:1px solid var(--border);border-radius:16px;background:#fff}.table{width:100%;border-collapse:collapse;min-width:760px}.table th,.table td{padding:12px;border-bottom:1px solid #edf1f5;text-align:left;vertical-align:top}.table th{font-size:12px;color:#667085;background:#f8fafc}.pill{display:inline-flex;border-radius:999px;background:#effcf4;color:#067a35;font-weight:850;padding:5px 10px;font-size:12px}.pill.gray{background:#eef2f7;color:#344054}.pill.orange{background:#fff3e0;color:#b54708}.status{min-height:24px;color:#667085;font-size:13px}.output{white-space:pre-wrap;background:#101828;color:#e5e7eb;border-radius:14px;padding:14px;min-height:112px;overflow:auto;font-size:13px}.hide{display:none}
    @media(max-width:980px){.shell{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--border)}.kpis,.grid,.toolbar{grid-template-columns:1fr}}
  </style>
</head>
<body>
<div class="shell">
  <aside>
    <div class="brand"><div class="logo">KL</div><div><h1>KLINK CRM</h1><p>LINE 會員與K點模組</p></div></div>
    <section class="panel">
      <h2>連線設定</h2>
      <label>Admin Token 或 Dashboard Token</label>
      <input id="token" type="password" placeholder="貼上 Token">
      <div class="row" style="margin-top:12px">
        <button id="saveToken" class="dark">儲存本機</button>
        <button id="clearToken" class="secondary">清除</button>
      </div>
      <p style="margin-top:10px">Token 只存在這台瀏覽器的 localStorage，不會寫入 Git。</p>
    </section>
    <section class="panel">
      <h2>同步</h2>
      <button id="syncMembers">同步 WETW 會員</button>
      <button id="syncPoints" class="secondary" style="margin-top:10px">同步 WETW K點</button>
      <p style="margin-top:10px">會員 API 已支援 WETW POST JSON 格式。K點以 gift_money 為正式餘額。</p>
    </section>
    <section class="panel">
      <h2>手動K點</h2>
      <label>OA</label><select id="channel"><option value="oa1">OA1 產品客服</option><option value="oa2">OA2 行政客服</option></select>
      <label>LINE User ID</label><input id="lineUserId" placeholder="U...">
      <label>Point Type</label><input id="pointType" value="manual_point">
      <label>K點</label><input id="points" type="number" value="10">
      <label>備註</label><input id="note" placeholder="例如：活動補點 / 商品核銷">
      <div class="row" style="margin-top:12px">
        <button id="grant">贈K點</button>
        <button id="deduct" class="warn">扣K點</button>
        <button id="balance" class="secondary">查餘額</button>
      </div>
    </section>
  </aside>
  <main>
    <section class="kpis">
      <div class="kpi"><p>會員快取</p><strong id="memberCount">0</strong></div>
      <div class="kpi"><p>目前列表</p><strong id="visibleCount">0</strong></div>
      <div class="kpi"><p>狀態</p><strong id="statusText" style="font-size:20px">待同步</strong></div>
    </section>
    <section class="card">
      <div class="toolbar">
        <div><label>搜尋會員</label><input id="search" placeholder="姓名、電話、LINE uid、會員 ID"></div>
        <button id="members">讀取會員</button>
        <button id="searchButton" class="secondary">搜尋</button>
      </div>
      <div class="status" id="statusLine" style="margin-top:12px">等待操作</div>
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div><h2>會員列表</h2><p>資料來源：WETW WordPress API → D1 crm_members</p></div>
        <span class="pill" id="sourcePill">wetw</span>
      </div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>會員 ID</th><th>姓名</th><th>電話</th><th>店家/等級</th><th>LINE uid</th><th>更新時間</th></tr></thead>
          <tbody id="memberRows"><tr><td colspan="6">尚未讀取資料</td></tr></tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h2>API 回應</h2>
      <pre class="output" id="out">等待操作</pre>
    </section>
  </main>
</div>
<script>
const $ = (id) => document.getElementById(id);
const savedToken = localStorage.getItem("klink_crm_token") || localStorage.getItem("line_ai_api_token") || "";
$("token").value = savedToken;
function esc(value){return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c];});}
function headers(){return {"content-type":"application/json","authorization":"Bearer "+$("token").value.trim()};}
function payload(){return {channel_key:$("channel").value,line_user_id:$("lineUserId").value.trim(),point_type:$("pointType").value.trim(),points:Number($("points").value),note:$("note").value};}
function setStatus(text){$("statusLine").textContent=text;$("statusText").textContent=text.length > 8 ? text.slice(0,8) : text;}
function show(data){$("out").textContent=JSON.stringify(data,null,2);}
async function call(path,opt){
  setStatus("處理中");
  const res=await fetch(path,{headers:headers(),...(opt||{})});
  const text=await res.text();
  let data;
  try{data=JSON.parse(text);}catch(_err){data={raw:text};}
  show(data);
  if(!res.ok || data.status==="error" || data.success===false){setStatus("失敗");throw new Error(data.message||"request failed");}
  setStatus("完成");
  return data;
}
function renderMembers(data){
  const rows=(data.data||data.members||[]);
  $("visibleCount").textContent=rows.length;
  if(!rows.length){$("memberRows").innerHTML='<tr><td colspan="6">沒有資料</td></tr>';return;}
  $("memberRows").innerHTML=rows.map(function(row){
    let raw={};
    try{raw=JSON.parse(row.source_json||"{}");}catch(_err){}
    const lineUid=raw.LINE_user_id||raw.user_login||"";
    return '<tr>'+
      '<td><span class="pill gray">'+esc(row.member_ref)+'</span></td>'+
      '<td><strong>'+esc(row.name||raw.LINE_display_name||raw.display_name)+'</strong></td>'+
      '<td>'+esc(row.phone||raw.phone)+'</td>'+
      '<td><span class="pill orange">'+esc(row.level||raw.shop_id||"")+'</span></td>'+
      '<td style="font-size:12px;color:#667085">'+esc(lineUid)+'</td>'+
      '<td style="font-size:12px;color:#667085">'+esc(row.updated_at||"")+'</td>'+
    '</tr>';
  }).join("");
}
async function loadMembers(){
  const q=$("search").value.trim();
  const data=await call("/admin/crm/members?limit=500"+(q?"&q="+encodeURIComponent(q):""));
  renderMembers(data);
}
$("saveToken").onclick=function(){localStorage.setItem("klink_crm_token",$("token").value.trim());setStatus("已儲存");};
$("clearToken").onclick=function(){localStorage.removeItem("klink_crm_token");$("token").value="";setStatus("已清除");};
$("members").onclick=loadMembers;
$("searchButton").onclick=loadMembers;
$("search").addEventListener("keydown",function(event){if(event.key==="Enter")loadMembers();});
$("syncMembers").onclick=async function(){const data=await call("/admin/crm/sync-members",{method:"POST",body:"{}"});$("memberCount").textContent=data.count||0;await loadMembers();};
$("syncPoints").onclick=function(){return call("/admin/crm/sync-points",{method:"POST",body:"{}"});};
$("grant").onclick=function(){return call("/admin/points/grant",{method:"POST",body:JSON.stringify(payload())});};
$("deduct").onclick=function(){return call("/admin/points/deduct",{method:"POST",body:JSON.stringify(payload())});};
$("balance").onclick=function(){return call("/admin/points/balance?channel_key="+encodeURIComponent($("channel").value)+"&line_user_id="+encodeURIComponent($("lineUserId").value.trim()));};
if(savedToken) loadMembers().catch(function(error){setStatus(error.message);});
</script>
</body>
</html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

async function fetchDashboardData(env, floor = FLOOR_MAIN, options = {}) {
  if (!env.DB) return withThreadData(await callGas(env, { type: "FETCH_DASHBOARD_DATA" }));
  const searchQuery = stringValue(options.searchQuery || options.q || "").trim();
  const [threads, aiLogs, knowledgeMeta] = await Promise.all([
    fetchThreads(env, floor, searchQuery ? 80 : 120, { searchQuery }),
    fetchAiLogs(env, floor, 100),
    getKnowledgeMeta(env, floor),
  ]);
  if (!searchQuery && floor === FLOOR_MAIN && !threads.length && env.GAS_URL) {
    const gasData = await backupGas(env, { type: "FETCH_DASHBOARD_DATA" });
    if (gasData && gasData.status === "success") return withThreadData(gasData);
  }
  return {
    status: "success",
    data: {
      floor,
      threads,
      chats: threads.flatMap((thread) => thread.messages.map((message) => message.raw)),
      aiLogs,
      chatMeta: threads.map(threadToMetaRow),
      systemErrors: [],
      knowledgeMeta,
    },
  };
}

async function fetchThreads(env, floor = FLOOR_MAIN, limit = 120, options = {}) {
  const searchQuery = stringValue(options.searchQuery || options.q || "").trim();
  const bindings = [floor];
  const where = ["t.floor_id = ?"];
  if (searchQuery) {
    const like = `%${searchQuery.toLowerCase()}%`;
    where.push(`(
      LOWER(t.display_name) LIKE ?
      OR LOWER(COALESCE(p.display_name, '')) LIKE ?
      OR LOWER(t.user_id) LIKE ?
      OR LOWER(t.summary) LIKE ?
      OR LOWER(t.tags) LIKE ?
      OR LOWER(t.note) LIKE ?
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.thread_id = t.id
          AND m.floor_id = t.floor_id
          AND LOWER(m.text) LIKE ?
      )
    )`);
    bindings.push(like, like, like, like, like, like, like);
  }
  const queryLimit = floor === FLOOR_ADMIN ? Math.min(Number(limit || 120) + 500, 800) : limit;
  bindings.push(queryLimit);
  let { results } = await env.DB.prepare(`
    SELECT t.*, p.display_name AS profile_display_name, p.picture_url AS profile_picture_url, (SELECT tx.display_name FROM threads tx WHERE tx.user_id = t.user_id AND tx.display_name <> '' AND tx.display_name <> tx.user_id ORDER BY tx.updated_at DESC LIMIT 1) AS linked_display_name, (SELECT tx.picture_url FROM threads tx WHERE tx.user_id = t.user_id AND tx.picture_url <> '' ORDER BY tx.updated_at DESC LIMIT 1) AS linked_picture_url, p.profile_status, p.profile_error, p.last_profile_sync
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY t.last_message_at DESC, t.updated_at DESC
    LIMIT ?
  `).bind(...bindings).all();
  results = results || [];
  if (floor === FLOOR_ADMIN) results = await removePointGatewayOnlyThreads(env, results);

  const ids = results.map((row) => row.id);
  const messageResults = [];
  for (const batch of chunkArray(ids, D1_IN_QUERY_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const messageRows = await env.DB.prepare(`SELECT * FROM messages WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC`).bind(...batch).all();
    messageResults.push(...(messageRows.results || []));
  }
  const byThread = new Map(ids.map((id) => [id, []]));
  for (const row of messageResults) {
    if (isMonitorHiddenMessage(row)) continue;
    if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, []);
    byThread.get(row.thread_id).push(row);
  }
  const threads = results
    .map((row) => threadFromD1(row, byThread.get(row.id) || []))
    .filter((thread) => searchQuery || thread.messages.length > 0);


  return threads;
}

async function fetchCrmMemberThreads(env, searchQuery, limit = 20, existingUserIds = new Set()) {
  if (!env.DB || !searchQuery || limit <= 0) return [];
  const crmSearchUrl = new URL("https://local.invalid/admin/crm/member-search");
  crmSearchUrl.searchParams.set("q", searchQuery);
  crmSearchUrl.searchParams.set("limit", String(Math.min(Math.max(limit * 2, 20), 30)));
  const members = await searchCrmMemberCandidates(env, crmSearchUrl);
  const threads = [];
  const seen = new Set(existingUserIds || []);
  for (const member of members) {
    const userId = stringValue(member.line_user_id || member.user_login || member.LINE_user_id || member.lineUserId);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    threads.push(crmMemberToMonitorThread(member));
    if (threads.length >= limit) break;
  }
  return threads;
}

function crmMemberToMonitorThread(member) {
  const userId = stringValue(member.line_user_id || member.user_login || member.LINE_user_id || member.lineUserId);
  const displayName = stringValue(member.name || member.line_display_name || userId) || userId;
  const updatedAt = Date.parse(stringValue(member.updated_at)) || Date.now();
  const text = "CRM 會員資料，尚無聊天室訊息。";
  const raw = {
    "時間": updatedAt,
    "身份": "user",
    "用戶ID": userId,
    "內容": text,
    "類別": "會員資料",
    "AI建議": "[]",
    "重要": "否",
    "狀態": "處理完畢",
    "用戶名稱": displayName,
    "頭像URL": "",
  };
  return {
    id: `crm:${stringValue(member.member_ref || userId)}`,
    floor: FLOOR_MAIN,
    userId,
    name: displayName,
    displayName,
    pictureUrl: "",
    summary: text,
    status: "處理完畢",
    risk: "low",
    profileStatus: null,
    profileError: "",
    lastProfileSync: 0,
    tags: ["CRM會員"],
    note: `母站會員 ${stringValue(member.member_ref || "")}`.trim(),
    lastMessageAt: updatedAt,
    hasRealName: !isPlaceholderName(displayName, userId),
    messages: [{
      id: `crm:${stringValue(member.member_ref || userId)}:profile`,
      type: "text",
      senderRole: USER_ROLE,
      senderId: userId,
      senderName: displayName,
      text,
      createdAt: updatedAt,
      category: "會員資料",
      suggestions: [],
      important: false,
      raw,
    }],
  };
}
async function removePointGatewayOnlyThreads(env, rows) {
  const suspects = (rows || []).filter((row) => {
    return !stringValue(row.display_name)
      && !stringValue(row.picture_url)
      && Number(row.profile_status || 0) === 404
      && stringValue(row.user_id);
  });
  if (!suspects.length) return rows;

  const gatewayUsers = new Set();
  const userIds = Array.from(new Set(suspects.map((row) => stringValue(row.user_id)).filter(Boolean)));
  for (const batch of chunkArray(userIds, D1_IN_QUERY_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const eventRows = await env.DB.prepare(`
      SELECT DISTINCT line_user_id
      FROM webhook_events
      WHERE channel_key IN (?, ?)
        AND line_user_id IN (${placeholders})
    `).bind(POINT_OA1, POINT_OA2, ...batch).all();
    for (const eventRow of eventRows.results || []) gatewayUsers.add(stringValue(eventRow.line_user_id));
  }
  if (!gatewayUsers.size) return rows;
  return rows.filter((row) => {
    const userId = stringValue(row.user_id);
    const isGatewayOnly = !stringValue(row.display_name)
      && !stringValue(row.picture_url)
      && Number(row.profile_status || 0) === 404
      && gatewayUsers.has(userId);
    return !isGatewayOnly;
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchThread(env, floor, id) {
  const lookup = id.includes(":user:") || id.startsWith("user:") ? id : threadIdFor(floor, id);
  const row = await env.DB.prepare(`
    SELECT t.*, p.display_name AS profile_display_name, p.picture_url AS profile_picture_url, (SELECT tx.display_name FROM threads tx WHERE tx.user_id = t.user_id AND tx.display_name <> '' AND tx.display_name <> tx.user_id ORDER BY tx.updated_at DESC LIMIT 1) AS linked_display_name, (SELECT tx.picture_url FROM threads tx WHERE tx.user_id = t.user_id AND tx.picture_url <> '' ORDER BY tx.updated_at DESC LIMIT 1) AS linked_picture_url, p.profile_status, p.profile_error, p.last_profile_sync
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE t.floor_id = ? AND (t.id = ? OR t.user_id = ?)
  `).bind(floor, lookup, id.replace(/^(admin:)?user:/, "")).first();
  if (!row) return null;
  const messages = await env.DB.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC").bind(row.id).all();
  return threadFromD1(row, (messages.results || []).filter((message) => !isMonitorHiddenMessage(message)));
}

function isMonitorHiddenMessage(message) {
  return stringValue(message && message.floor_id) === FLOOR_MAIN
    && normalizeTextKeyword(message && message.text) === normalizeTextKeyword("簽到贈K點");
}

async function fetchAiLogs(env, floor = FLOOR_MAIN, limit = 100) {
  const { results } = await env.DB.prepare("SELECT * FROM ai_logs WHERE floor_id = ? ORDER BY created_at DESC LIMIT ?").bind(floor, limit).all();
  return (results || []).map((row) => ({
    "\u6642\u9593": row.created_at,
    "\u7528\u6236ID": row.user_id,
    "\u5167\u5bb9": row.text,
    "\u985e\u5225": row.category,
    "\u60c5\u7dd2": row.sentiment,
    "\u539f\u56e0": row.report_reason,
    "\u72c0\u614b": row.status,
    "TG\u901a\u77e5": row.telegram_status,
  }));
}

async function migrateGasToD1(env, floor = FLOOR_MAIN) {
  const gas = await callGas(env, { type: "FETCH_DASHBOARD_DATA" });
  const data = gas.data || {};
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const chatMeta = Array.isArray(data.chatMeta) ? data.chatMeta : [];
  const threads = buildThreadsFromGas(chats, chatMeta);
  let threadCount = 0;
  let messageCount = 0;
  let profileCount = 0;

  for (const thread of threads) {
    const now = Date.now();
    const threadId = threadIdFor(floor, thread.userId);
    await upsertProfile(env, {
      floor,
      userId: thread.userId,
      displayName: thread.hasRealName ? thread.name : "",
      pictureUrl: thread.pictureUrl,
      now,
    });
    profileCount += 1;

    await env.DB.prepare(`
      INSERT INTO threads (id, floor_id, user_id, display_name, picture_url, summary, status, risk, tags, note, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE threads.display_name END,
        picture_url = CASE WHEN excluded.picture_url != '' THEN excluded.picture_url ELSE threads.picture_url END,
        summary = excluded.summary,
        status = excluded.status,
        risk = excluded.risk,
        tags = excluded.tags,
        note = excluded.note,
        last_message_at = excluded.last_message_at,
        updated_at = excluded.updated_at
    `).bind(
      threadId,
      floor,
      thread.userId,
      thread.hasRealName ? thread.name : "",
      thread.pictureUrl || "",
      thread.summary || "",
      thread.status || STATUS_PENDING,
      thread.risk || "low",
      JSON.stringify(thread.tags || []),
      thread.note || "",
      thread.lastMessageAt || now,
      thread.lastMessageAt || now,
      now,
    ).run();
    threadCount += 1;

    for (const message of thread.messages || []) {
      const messageId = message.id || `${threadId}:${message.createdAt || now}:${crypto.randomUUID()}`;
      await env.DB.prepare(`
        INSERT OR IGNORE INTO messages (id, floor_id, thread_id, user_id, sender_role, message_type, text, category, suggestions, important, sentiment, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        messageId,
        floor,
        threadId,
        thread.userId,
        message.senderRole === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
        "text",
        message.text || "",
        message.category || "",
        JSON.stringify(message.suggestions || []),
        message.important ? 1 : 0,
        (message.raw && message.raw["\u60c5\u7dd2"]) || "neutral",
        JSON.stringify(message.raw || {}),
        message.createdAt || now,
      ).run();
      messageCount += 1;
    }
  }

  return { status: "success", threads: threadCount, messages: messageCount, profiles: profileCount };
}

function threadFromD1(row, messages) {
  const tags = parseJsonArray(row.tags);
  const name = chooseStableName(row.user_id, row.display_name, row.profile_display_name) || chooseStableName(row.user_id, row.linked_display_name, "") || PENDING_DISPLAY_NAME;
  return {
    id: row.id,
    floor: row.floor_id || FLOOR_MAIN,
    userId: row.user_id,
    name,
    displayName: name,
    pictureUrl: stringValue(row.picture_url || row.profile_picture_url || row.linked_picture_url),
    summary: stringValue(row.summary),
    status: normalizeStatusForDisplay(row.status),
    risk: row.risk || "low",
    profileStatus: row.profile_status || null,
    profileError: stringValue(row.profile_error),
    lastProfileSync: Number(row.last_profile_sync || 0),
    tags,
    note: stringValue(row.note),
    lastMessageAt: Number(row.last_message_at || 0),
    hasRealName: !isPlaceholderName(name, row.user_id),
    messages: messages.map((message) => messageFromD1(row, message)),
  };
}

function normalizeStoredLinePayload(rawJson, fallbackType = "text") {
  const raw = rawJson && typeof rawJson === "object" ? rawJson : {};
  if (Array.isArray(raw.lineMessages)) return { direction: raw.direction || "outgoing", messages: raw.lineMessages };
  if (Array.isArray(raw.messages)) return { direction: raw.direction || "outgoing", messages: raw.messages };
  if (raw.lineMessage && typeof raw.lineMessage === "object") return { direction: raw.direction || "outgoing", messages: [raw.lineMessage] };
  if (raw.message && typeof raw.message === "object") return { direction: raw.direction || "incoming", messages: [raw.message] };
  if (raw.type && raw.type !== "message") return { direction: raw.direction || "outgoing", messages: [raw] };
  if (fallbackType && fallbackType !== "text") return { direction: raw.direction || "unknown", messages: [{ type: fallbackType }] };
  return null;
}

function lineMessageDisplayText(message) {
  const item = message && typeof message === "object" ? message : {};
  const type = stringValue(item.type || "text");
  if (type === "text") return stringValue(item.text);
  if (type === "image") return "[圖片]";
  if (type === "video") return "[影片]";
  if (type === "audio") return "[音訊]";
  if (type === "location") return stringValue(item.title || item.address) || "[位置]";
  if (type === "sticker") return "[貼圖]";
  if (type === "flex") return stringValue(item.altText) || "[Flex 訊息]";
  if (type === "template") return stringValue(item.altText) || "[Template 訊息]";
  return type ? `[${type}]` : "[LINE 訊息]";
}

function lineMessagesDisplayText(messages) {
  const items = Array.isArray(messages) ? messages : [];
  return items.map(lineMessageDisplayText).filter(Boolean).join("\n") || "[LINE 訊息]";
}
function messageFromD1(thread, message) {
  const suggestions = parseJsonArray(message.suggestions);
  const rawJson = parseJsonObject(message.raw_json);
  const linePayload = normalizeStoredLinePayload(rawJson, message.message_type);
  const raw = {
    "\u6642\u9593": message.created_at,
    "\u8eab\u4efd": message.sender_role === ADMIN_ROLE ? "admin" : "user",
    "\u7528\u6236ID": message.user_id,
    "floor": thread.floor_id || FLOOR_MAIN,
    "\u5167\u5bb9": message.text,
    "\u985e\u5225": message.category,
    "AI\u5efa\u8b70": JSON.stringify(suggestions),
    "\u91cd\u8981": message.important ? "\u662f" : "\u5426",
    "\u60c5\u7dd2": message.sentiment || "neutral",
    "\u72c0\u614b": normalizeStatusForDisplay(thread.status),
    "\u7528\u6236\u540d\u7a31": thread.display_name || "",
    "\u982d\u50cfURL": thread.picture_url || "",
    "LINEPayload": linePayload,
  };
  return {
    id: message.id,
    type: message.message_type || "text",
    senderRole: message.sender_role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
    senderId: message.user_id,
    senderName: message.sender_role === ADMIN_ROLE ? "\u7ba1\u7406\u54e1" : (chooseStableName(thread.user_id, thread.display_name, "") || PENDING_DISPLAY_NAME),
    text: message.text,
    createdAt: message.created_at,
    category: message.category,
    suggestions,
    important: Boolean(message.important),
    rawJson,
    linePayload,
    raw,
  };
}

async function processLineWebhook(env, floor, provider, payload, options = {}) {
  for (const event of payload.events || []) {
    if (!event || event.type !== "message" || !event.message) continue;
    const userId = event.source && event.source.userId ? event.source.userId : "";
    const messageType = stringValue(event.message.type || "text");
    const text = messageType === "text" ? stringValue(event.message.text) : lineMessageDisplayText(event.message);
    if (!userId || !text) continue;
    const templateReplied = messageType === "text" && options.skipCheckinTemplateReply !== true && await maybeReplyCheckinTemplate(env, floor, provider, event, userId, text);
    await saveIncomingMessage(env, floor, provider, event, userId, text);
    if (templateReplied || messageType !== "text") continue;
    await handleKeywordAutomation(env, floor, provider, event, userId, text);
  }
  if (floor === FLOOR_MAIN) await backupGas(env, { type: "LINE_WEBHOOK", data: payload });
}

async function handleKeywordAutomation(env, floor, provider, event, userId, text, options = {}) {
  if (floor !== FLOOR_MAIN || !userId || !text) return null;
  const rule = await matchKeywordRule(env, floor, text);
  if (!rule || rule.action !== "daily_point_reward") return null;
  let result;
  let replyText;
  try {
    result = await applyDailyKeywordReward(env, rule, userId);
    const balance = result && result.balance_after !== undefined && result.balance_after !== null
      ? result.balance_after
      : await getPointAccountBalance(env, stringValue(rule.channel_key) || POINT_OA1, userId, stringValue(rule.point_type) || "gift_money");
    if (result.readonly) {
      replyText = `目前累積 ${formatPoint(balance)} K點。`;
    } else {
      replyText = result.duplicate
      ? `您今天已經簽到過，目前累積 ${formatPoint(balance)} K點。`
      : `簽到成功，已贈送 ${formatPoint(result.points)} K點。目前累積 ${formatPoint(balance)} K點。`;
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    result = { error: message };
    const status = Number(error && error.status || 0);
    replyText = status >= 400 && status < 500 && message
      ? message
      : "簽到暫時失敗，請稍後再試。";
  }
  const delivery = await replyOrPushLineMessage(provider, event.replyToken, userId, replyText);
  await recordDailyKeywordDelivery(env, rule, userId, delivery);
  if (options.saveMessage !== false) {
    await saveAdminMessage(env, {
      floor,
      userId,
      text: replyText,
      createdAt: Date.now(),
      status: STATUS_DONE,
      category: "關鍵字自動回覆",
    });
  }
  return result;
}

async function recordDailyKeywordDelivery(env, rule, userId, delivery) {
  if (!rule || !userId) return;
  const rewardDate = taipeiDate();
  const ok = delivery && delivery.ok;
  const status = delivery && delivery.status ? delivery.status : 0;
  const detail = stringValue(delivery && delivery.detail).slice(0, 240);
  await env.DB.prepare(`
    UPDATE daily_keyword_rewards
    SET message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
  `).bind(ok ? `line_delivery_ok:${status}` : `line_delivery_failed:${status}:${detail}`, rule.id, userId, rewardDate).run();
}

async function matchKeywordRule(env, floor, text) {
  const rows = await env.DB.prepare(`
    SELECT id, floor_id, keyword, match_type, action, channel_key, point_type, points, response_success, response_duplicate
    FROM keyword_rules
    WHERE floor_id = ? AND active = 1
    ORDER BY priority DESC, id ASC
  `).bind(floor).all();
  const normalized = normalizeTextKeyword(text);
  for (const row of rows.results || []) {
    const keyword = normalizeTextKeyword(row.keyword);
    const matchType = stringValue(row.match_type || "exact");
    if (matchType === "contains" && normalized.includes(keyword)) return row;
    if (normalized === keyword) return row;
  }
  return null;
}

async function applyDailyKeywordReward(env, rule, userId) {
  const rewardDate = taipeiDate();
  const channelKey = stringValue(rule.channel_key) || POINT_OA1;
  const pointType = "gift_money";
  const keyword = stringValue(rule.keyword);
  const points = Math.max(1, Number(rule.points || 10));
  const existingSameDay = await env.DB.prepare(`
    SELECT id, keyword, points, balance_after, status
    FROM daily_keyword_rewards
    WHERE line_user_id = ? AND channel_key = ? AND point_type = ? AND reward_date = ? AND status != 'failed'
    ORDER BY id ASC
    LIMIT 1
  `).bind(userId, channelKey, pointType, rewardDate).first();

  if (existingSameDay) {
    const balance = await getLiveFirstPointAccountBalance(env, channelKey, userId, pointType).catch(() => getPointAccountBalance(env, channelKey, userId, pointType)).catch(() => 0);
    await env.DB.prepare(`
      UPDATE daily_keyword_rewards
      SET balance_after = ?, message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(balance, "duplicate_mother_site_gift_money_query", existingSameDay.id).run();
    return { readonly: false, duplicate: true, points: Number(existingSameDay.points || points), balance_after: balance };
  }

  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO daily_keyword_rewards (rule_id, keyword, line_user_id, channel_key, point_type, points, reward_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(rule.id, keyword, userId, channelKey, pointType, points, rewardDate).run();

  if (inserted && inserted.meta && inserted.meta.changes === 0) {
    const balance = await getLiveFirstPointAccountBalance(env, channelKey, userId, pointType).catch(() => getPointAccountBalance(env, channelKey, userId, pointType)).catch(() => 0);
    return { readonly: false, duplicate: true, points, balance_after: balance };
  }

  try {
    const mutation = await pointMutation(env, {
      channel_key: channelKey,
      line_user_id: userId,
      chat_line_user_id: userId,
      point_type: pointType,
      points,
      operator_name: "關鍵字自動贈點",
      note: `${keyword} 每日打卡贈點`,
    }, "grant");
    const localBalance = Number(mutation && mutation.balance_after);
    const balance = Number.isFinite(localBalance)
      ? localBalance
      : await getPointAccountBalance(env, channelKey, userId, pointType).catch(() => 0);
    await env.DB.prepare(`
      UPDATE daily_keyword_rewards
      SET balance_after = ?, status = 'claimed', message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
    `).bind(balance, "gift_money_granted", rule.id, userId, rewardDate).run();
    return { readonly: false, duplicate: false, points, balance_after: balance };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE daily_keyword_rewards
      SET status = 'failed', message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
    `).bind(error && error.message ? error.message.slice(0, 240) : String(error).slice(0, 240), rule.id, userId, rewardDate).run();
    throw error;
  }
}


async function repairLocalGiftMoneyBalances(env, body = {}) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  const dryValue = body.dry_run !== undefined ? body.dry_run : body.dryRun;
  const dryRun = dryValue === undefined
    ? true
    : !(dryValue === false || ["false", "0", "no"].includes(String(dryValue).toLowerCase()));
  const date = stringValue(body.date || body.reward_date || body.rewardDate || taipeiDate()).slice(0, 10);
  const lineUserId = stringValue(body.line_user_id || body.lineUserId || body.userId);
  const limit = clampNumber(body.limit || 200, 1, 500);
  const where = [
    "pa.channel_key = 'oa1'",
    "pa.point_type = 'gift_money'",
    "EXISTS (SELECT 1 FROM point_ledger pl WHERE pl.account_key = pa.account_key AND date(pl.created_at) = ?)",
  ];
  const bindings = [date];
  if (lineUserId) {
    where.push("pa.line_user_id = ?");
    bindings.push(lineUserId);
  }
  bindings.push(limit);
  const accounts = await env.DB.prepare(`
    SELECT pa.account_key, pa.channel_key, pa.line_user_id, pa.point_type, pa.balance
    FROM point_accounts pa
    WHERE ${where.join(" AND ")}
    ORDER BY pa.updated_at DESC
    LIMIT ?
  `).bind(...bindings).all();
  const report = { dry_run: dryRun, date, scanned: 0, repaired: 0, already_correct: 0, failed: 0, details: [] };
  for (const account of accounts.results || []) {
    const detail = { account_key: account.account_key, line_user_id: account.line_user_id, current: Number(account.balance || 0), target: null, status: "", error: "" };
    report.scanned += 1;
    try {
      const ledgers = await env.DB.prepare(`
        SELECT id, point_delta, balance_after, created_at
        FROM point_ledger
        WHERE account_key = ? AND point_type = 'gift_money'
        ORDER BY id ASC
      `).bind(account.account_key).all();
      let maxRow = null;
      for (const row of ledgers.results || []) {
        const balance = Number(row.balance_after);
        if (!Number.isFinite(balance)) continue;
        if (!maxRow || balance > maxRow.balance_after) maxRow = { id: Number(row.id), balance_after: balance };
      }
      if (!maxRow) {
        detail.status = "no_ledger_balance";
        report.already_correct += 1;
      } else {
        let target = maxRow.balance_after;
        for (const row of ledgers.results || []) {
          if (Number(row.id) > maxRow.id) target += Number(row.point_delta || 0);
        }
        detail.target = target;
        if (target <= detail.current) {
          detail.status = "already_correct";
          report.already_correct += 1;
        } else if (dryRun) {
          detail.status = "needs_repair";
        } else {
          await env.DB.prepare(`
            UPDATE point_accounts
            SET balance = ?, updated_at = CURRENT_TIMESTAMP
            WHERE account_key = ?
          `).bind(target, account.account_key).run();
          await env.DB.prepare(`
            UPDATE daily_keyword_rewards
            SET balance_after = CASE WHEN balance_after < ? THEN ? ELSE balance_after END,
                message = 'local_balance_repaired',
                updated_at = CURRENT_TIMESTAMP
            WHERE channel_key = 'oa1' AND point_type = 'gift_money' AND line_user_id = ? AND reward_date = ?
          `).bind(target, target, account.line_user_id, date).run();
          detail.status = "repaired";
          report.repaired += 1;
        }
      }
    } catch (error) {
      detail.status = "failed";
      detail.error = error && error.message ? error.message : String(error);
      report.failed += 1;
    }
    report.details.push(detail);
  }
  return report;
}
async function fetchDailyKeywordGiftBalance(env, channelKey, userId) {
  const resolved = await resolvePointIdentity(env, { chatLineUserId: userId }).catch(() => null);
  const sourceLineUserId = stringValue(resolved && resolved.channelLineUserIds && resolved.channelLineUserIds[channelKey]) || userId;
  const snapshot = await fetchWetwPointSnapshot(env, channelKey, sourceLineUserId, "gift_money", 10, {
    shop_id: memberCheckinShopId(env),
  });
  const liveBalance = Number(snapshot && snapshot.balance);
  if (Array.isArray(snapshot && snapshot.rows) && snapshot.rows.length && Number.isFinite(liveBalance)) {
    return liveBalance;
  }
  const sourceLocalBalance = await getPointAccountBalance(env, channelKey, sourceLineUserId, "gift_money").catch(() => 0);
  const chatLocalBalance = sourceLineUserId === userId
    ? sourceLocalBalance
    : await getPointAccountBalance(env, channelKey, userId, "gift_money").catch(() => 0);
  return Math.max(
    Number.isFinite(liveBalance) ? liveBalance : 0,
    Number.isFinite(Number(sourceLocalBalance)) ? Number(sourceLocalBalance) : 0,
    Number.isFinite(Number(chatLocalBalance)) ? Number(chatLocalBalance) : 0
  );
}

function normalizeTextKeyword(value) {
  return stringValue(value).replace(/\s+/g, "").toLowerCase();
}

async function saveIncomingMessage(env, floor, provider, event, userId, text) {
  const now = Number(event.timestamp || Date.now());
  const sourceType = stringValue(event.source && event.source.type) || "user";
  const sourceId = stringValue((event.source && (event.source.groupId || event.source.roomId)) || userId);
  const threadId = threadIdFor(floor, userId);
  const messageId = stringValue(event.message.id) || `${threadId}:${now}:${crypto.randomUUID()}`;
  const rawJson = JSON.stringify(event);
  const current = await env.DB.prepare("SELECT tags, note, display_name, picture_url FROM threads WHERE id = ? AND floor_id = ?").bind(threadId, floor).first();

  await env.DB.prepare(`
    INSERT INTO threads (id, floor_id, user_id, source_type, source_id, display_name, picture_url, summary, status, risk, tags, note, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_type = CASE WHEN excluded.source_type != '' THEN excluded.source_type ELSE threads.source_type END,
      source_id = CASE WHEN excluded.source_id != '' THEN excluded.source_id ELSE threads.source_id END,
      summary = excluded.summary,
      status = excluded.status,
      risk = excluded.risk,
      last_message_at = excluded.last_message_at,
      updated_at = excluded.updated_at
  `).bind(
    threadId,
    floor,
    userId,
    sourceType,
    sourceId,
    current ? stringValue(current.display_name) : "",
    current ? stringValue(current.picture_url) : "",
    text,
    STATUS_PENDING,
    "low",
    current ? current.tags : "[]",
    current ? current.note : "",
    now,
    now,
    now,
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO messages (id, floor_id, thread_id, user_id, sender_role, message_type, text, category, suggestions, important, sentiment, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    messageId,
    floor,
    threadId,
    userId,
    USER_ROLE,
    stringValue(event.message && event.message.type) || "text",
    text,
    "",
    "[]",
    0,
    "neutral",
    rawJson,
    now,
  ).run();

  const profile = await resolveProfile(env, floor, provider, userId, event.source || {}, event.userProfile || null);
  await upsertProfile(env, {
    floor,
    userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    sourceType,
    sourceId,
    profileStatus: profile.profileStatus,
    profileError: profile.profileError,
    now,
  });

  const canAnalyze = stringValue(event.message && event.message.type || "text") === "text";
  const analysis = canAnalyze ? await analyzeMessage(env, floor, text, userId, profile.displayName || userId) : { category: "LINE 訊息", suggestions: [], isImportant: false, sentiment: "neutral" };
  const status = analysis.isImportant ? STATUS_IMPORTANT : STATUS_PENDING;
  const risk = analysis.isImportant ? "high" : "low";

  await env.DB.prepare(`
    UPDATE threads
    SET display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
        picture_url = CASE WHEN ? != '' THEN ? ELSE picture_url END,
        status = ?,
        risk = ?,
        updated_at = ?
    WHERE id = ? AND floor_id = ?
  `).bind(
    profile.displayName || "",
    profile.displayName || "",
    profile.pictureUrl || "",
    profile.pictureUrl || "",
    status,
    risk,
    now,
    threadId,
    floor,
  ).run();

  await env.DB.prepare(`
    UPDATE messages
    SET category = ?, suggestions = ?, important = ?, sentiment = ?
    WHERE id = ? AND floor_id = ?
  `).bind(
    analysis.category,
    JSON.stringify(analysis.suggestions || []),
    analysis.isImportant ? 1 : 0,
    analysis.sentiment || "neutral",
    messageId,
    floor,
  ).run();

  if (analysis.isImportant) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ai_logs (id, floor_id, thread_id, user_id, text, category, sentiment, report_reason, status, telegram_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `ai:${messageId}`,
      floor,
      threadId,
      userId,
      text,
      analysis.category,
      analysis.sentiment || "neutral",
      analysis.reportReason || analysis.summary || "",
      STATUS_IMPORTANT,
      "gas-backup",
      now,
    ).run();
  }
}

async function saveAdminMessage(env, input) {
  const floor = input.floor || FLOOR_MAIN;
  const userId = stringValue(input.userId);
  const lineMessages = Array.isArray(input.lineMessages) ? input.lineMessages : null;
  const text = stringValue(input.text) || (lineMessages ? lineMessagesDisplayText(lineMessages) : "");
  const messageType = stringValue(input.messageType || (lineMessages && lineMessages.length === 1 ? lineMessages[0].type : (lineMessages ? "line" : "text"))) || "text";
  const rawPayload = input.rawJson || (lineMessages ? { direction: "outgoing", lineMessages } : {});
  const now = Number(input.createdAt || Date.now());
  const threadId = threadIdFor(floor, userId);
  const profile = await getProfile(env, floor, userId);
  const name = profile && profile.display_name ? profile.display_name : stringValue(input.userName);
  const pictureUrl = profile && profile.picture_url ? profile.picture_url : "";
  const current = await env.DB.prepare("SELECT tags, note FROM threads WHERE id = ? AND floor_id = ?").bind(threadId, floor).first();

  await env.DB.prepare(`
    INSERT INTO threads (id, floor_id, user_id, display_name, picture_url, summary, status, risk, tags, note, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      status = excluded.status,
      last_message_at = excluded.last_message_at,
      updated_at = excluded.updated_at
  `).bind(threadId, floor, userId, name, pictureUrl, text, input.status || STATUS_DONE, "low", current ? current.tags : "[]", current ? current.note : "", now, now, now).run();

  const messageId = `admin:${threadId}:${now}:${crypto.randomUUID()}`;
  await env.DB.prepare(`
    INSERT INTO messages (id, floor_id, thread_id, user_id, sender_role, message_type, text, category, suggestions, important, sentiment, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(messageId, floor, threadId, userId, ADMIN_ROLE, messageType, text, input.category || "\u4eba\u5de5\u56de\u8986", "[]", 0, "neutral", JSON.stringify(rawPayload || {}), now).run();

  await learnFromAdminReply(env, {
    floor,
    threadId,
    userId,
    userName: name,
    replyText: text,
    replyMessageId: messageId,
    messageType,
    category: input.category || "\u4eba\u5de5\u56de\u8986",
    createdAt: now,
    tags: current ? current.tags : "[]",
  });
}

async function learnFromAdminReply(env, input) {
  if (!env.DB) return null;
  if (stringValue(input.messageType || "text") !== "text") return null;
  const replyText = stringValue(input.replyText).trim();
  if (!replyText || replyText.length < 2) return null;
  if (!isLearnableAdminReply(input.category, replyText)) return null;
  await ensureReplyLearningSchema(env);
  const previous = await env.DB.prepare(`
    SELECT id, text, category, created_at
    FROM messages
    WHERE thread_id = ?
      AND floor_id = ?
      AND sender_role = ?
      AND text IS NOT NULL
      AND text <> ''
      AND created_at <= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(input.threadId, input.floor || FLOOR_MAIN, USER_ROLE, Number(input.createdAt || Date.now())).first();
  if (!previous || !stringValue(previous.text).trim()) return null;
  const userText = stringValue(previous.text).trim();
  const now = Date.now();
  const learningKey = await learningFingerprint(input.floor || FLOOR_MAIN, userText, replyText);
  await env.DB.prepare(`
    INSERT INTO reply_learning (
      learning_key, floor_id, thread_id, user_id, user_name, user_message_id, user_text,
      reply_message_id, reply_text, category, tags, source, quality, use_count, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(learning_key) DO UPDATE SET
      thread_id = excluded.thread_id,
      user_id = excluded.user_id,
      user_name = CASE WHEN excluded.user_name != '' THEN excluded.user_name ELSE reply_learning.user_name END,
      reply_message_id = excluded.reply_message_id,
      category = excluded.category,
      tags = excluded.tags,
      updated_at = excluded.updated_at
  `).bind(
    learningKey,
    input.floor || FLOOR_MAIN,
    input.threadId,
    input.userId,
    stringValue(input.userName),
    previous.id,
    userText,
    input.replyMessageId,
    replyText,
    stringValue(input.category || previous.category || "\u4eba\u5de5\u56de\u8986"),
    stringValue(input.tags || "[]"),
    "admin_reply",
    "accepted",
    now,
    now,
  ).run();
  return { learningKey, userText, replyText };
}

function isLearnableAdminReply(category, replyText) {
  const categoryText = stringValue(category);
  const text = stringValue(replyText).trim();
  if (!text || text.length < 6) return false;
  if (categoryText.includes("\u95dc\u9375\u5b57") || categoryText.includes("\u81ea\u52d5")) return false;
  const genericHoldPatterns = [
    "\u9019\u500b\u554f\u984c\u6211\u5148\u70ba\u60a8\u78ba\u8a8d",
    "\u7a0d\u5f8c\u7531\u5c08\u4eba\u56de\u8986",
    "\u8acb\u7a0d\u5019",
  ];
  return !genericHoldPatterns.some((pattern) => text.includes(pattern));
}

async function ensureReplyLearningSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS reply_learning (
        learning_key TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL DEFAULT 'main',
        thread_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        user_message_id TEXT NOT NULL DEFAULT '',
        user_text TEXT NOT NULL,
        reply_message_id TEXT NOT NULL DEFAULT '',
        reply_text TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'admin_reply',
        quality TEXT NOT NULL DEFAULT 'accepted',
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_reply_learning_floor_updated ON reply_learning(floor_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_reply_learning_floor_category ON reply_learning(floor_id, category)"),
  ]);
}

async function learningFingerprint(floor, userText, replyText) {
  const value = `${floor}\n${normalizeLearningText(userText)}\n${normalizeLearningText(replyText)}`;
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeLearningText(value) {
  return stringValue(value).trim().replace(/\s+/g, " ").slice(0, 500);
}

async function updateConversationMeta(env, input) {
  const floor = input.floor || FLOOR_MAIN;
  const userId = stringValue(input.userId);
  const now = Date.now();
  const threadId = threadIdFor(floor, userId);
  const existing = await env.DB.prepare("SELECT * FROM threads WHERE id = ? AND floor_id = ?").bind(threadId, floor).first();
  const currentTags = existing ? parseJsonArray(existing.tags) : [];
  const tags = input.tags === undefined ? currentTags : normalizeTags(input.tags);
  const displayName = chooseStableName(userId, input.userName, existing && existing.display_name);
  const pictureUrl = stringValue(input.pictureUrl || (existing && existing.picture_url));
  const status = input.status !== undefined && input.status !== "" ? stringValue(input.status) : (existing && existing.status) || STATUS_PENDING;
  const note = input.note !== undefined ? String(input.note || "") : (existing && existing.note) || "";

  await env.DB.prepare(`
    INSERT INTO threads (id, floor_id, user_id, display_name, picture_url, summary, status, risk, tags, note, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE threads.display_name END,
      picture_url = CASE WHEN excluded.picture_url != '' THEN excluded.picture_url ELSE threads.picture_url END,
      status = excluded.status,
      tags = excluded.tags,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).bind(threadId, floor, userId, displayName, pictureUrl, existing ? existing.summary : "", status, existing ? existing.risk : "low", JSON.stringify(tags), note, existing ? existing.last_message_at : 0, existing ? existing.created_at : now, now).run();

  if (displayName || pictureUrl) {
    await upsertProfile(env, { floor, userId, displayName, pictureUrl, now });
  }

  return {
    floor,
    userId,
    userName: displayName,
    pictureUrl,
    status,
    tags,
    note,
    updatedAt: now,
  };
}

async function backfillProfiles(env, floor, provider, limit, options = {}) {
  const force = Boolean(options.force);
  const staleBefore = Date.now() - Number(options.staleMs || 0);
  const staleClause = force ? "" : "AND (p.profile_status IS NULL OR p.last_profile_sync IS NULL OR p.last_profile_sync < ?)";
  const bindings = force ? [limit] : [staleBefore, limit];
  const { results } = await env.DB.prepare(`
    SELECT t.user_id, t.source_type, t.source_id, t.display_name, t.picture_url
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id
    WHERE t.floor_id = ? AND (t.display_name = '' OR t.display_name = t.user_id OR t.picture_url = '')
      ${staleClause}
    ORDER BY t.updated_at DESC
    LIMIT ?
  `).bind(floor, ...bindings).all();
  const output = [];
  for (const row of results || []) {
    const source = sourceFromD1(row);
    const profile = await fetchLineProfileWithDetail(provider, row.user_id, source);
    const result = { userId: row.user_id, profileStatus: profile.status, updated: false };
    if (profile.ok && profile.data && (profile.data.displayName || profile.data.pictureUrl)) {
      const now = Date.now();
      await upsertProfile(env, {
        floor,
        userId: row.user_id,
        displayName: profile.data.displayName,
        pictureUrl: profile.data.pictureUrl,
        sourceType: row.source_type,
        sourceId: row.source_id,
        profileStatus: profile.status,
        now,
      });
      await updateConversationMeta(env, {
        floor,
        userId: row.user_id,
        userName: profile.data.displayName || row.display_name,
        pictureUrl: profile.data.pictureUrl || row.picture_url,
      });
      result.updated = true;
      result.displayName = profile.data.displayName || "";
      result.pictureUrl = profile.data.pictureUrl || "";
    } else {
      result.error = profile.detail || profile.error || "LINE profile unavailable";
      await upsertProfile(env, {
        floor,
        userId: row.user_id,
        displayName: "",
        pictureUrl: "",
        sourceType: row.source_type,
        sourceId: row.source_id,
        profileStatus: profile.status || 0,
        profileError: result.error,
        now: Date.now(),
      });
    }
    output.push(result);
  }
  return output;
}

async function backfillPointChannelProfiles(env, channelKey, provider, limit, options = {}) {
  const sourceKey = stringValue(channelKey);
  if (!POINT_CHANNELS.has(sourceKey)) throw httpError("Unsupported point source", 400);
  const force = Boolean(options.force);
  const staleBefore = Date.now() - Number(options.staleMs || 86400000);
  const staleClause = force ? "" : "AND (p.profile_status IS NULL OR p.last_profile_sync IS NULL OR p.last_profile_sync < ?)";
  const bindings = force ? [sourceKey, limit] : [sourceKey, staleBefore, limit];
  const rows = await env.DB.prepare(`
    SELECT e.line_user_id AS user_id, MAX(e.id) AS latest_event_id
    FROM webhook_events e
    LEFT JOIN profiles p ON p.user_id = e.line_user_id
    WHERE e.channel_key = ?
      AND e.line_user_id IS NOT NULL
      AND e.line_user_id <> ''
      ${staleClause}
    GROUP BY e.line_user_id
    ORDER BY latest_event_id DESC
    LIMIT ?
  `).bind(...bindings).all();
  const output = [];
  for (const row of rows.results || []) {
    const profile = await fetchLineProfileWithDetail(provider, row.user_id);
    const result = { userId: row.user_id, channelKey: sourceKey, profileStatus: profile.status, updated: false };
    if (profile.ok && profile.data && (profile.data.displayName || profile.data.pictureUrl)) {
      await upsertProfile(env, {
        floor: provider.floor || POINT_CHANNEL_FLOORS[sourceKey] || FLOOR_MAIN,
        userId: row.user_id,
        displayName: profile.data.displayName,
        pictureUrl: profile.data.pictureUrl,
        sourceType: "user",
        sourceId: row.user_id,
        profileStatus: profile.status,
        now: Date.now(),
      });
      result.updated = true;
      result.displayName = profile.data.displayName || "";
      result.pictureUrl = profile.data.pictureUrl || "";
    } else {
      result.error = profile.detail || profile.error || "LINE profile unavailable";
      await upsertProfile(env, {
        floor: provider.floor || POINT_CHANNEL_FLOORS[sourceKey] || FLOOR_MAIN,
        userId: row.user_id,
        displayName: "",
        pictureUrl: "",
        sourceType: "user",
        sourceId: row.user_id,
        profileStatus: profile.status || 0,
        profileError: result.error,
        now: Date.now(),
      });
    }
    output.push(result);
  }
  return output;
}

async function resolveProfile(env, floor, provider, userId, source, webhookProfile) {
  const stored = await getProfile(env, floor, userId);
  const incomingName = webhookProfile && webhookProfile.displayName ? webhookProfile.displayName : "";
  const incomingPicture = webhookProfile && webhookProfile.pictureUrl ? webhookProfile.pictureUrl : "";
  if (incomingName || incomingPicture) {
    return {
      displayName: chooseStableName(userId, incomingName, stored && stored.display_name),
      pictureUrl: incomingPicture || (stored && stored.picture_url) || "",
      profileStatus: 200,
      profileError: "",
    };
  }

  const shouldRefresh = !stored || !stored.display_name || !stored.picture_url || Date.now() - Number(stored.last_profile_sync || 0) > 86400000;
  if (shouldRefresh) {
    const fetched = await fetchLineProfileWithDetail(provider, userId, source);
    if (fetched.ok && fetched.data) {
      return {
        displayName: chooseStableName(userId, fetched.data.displayName, stored && stored.display_name),
        pictureUrl: fetched.data.pictureUrl || (stored && stored.picture_url) || "",
        profileStatus: fetched.status,
        profileError: "",
      };
    }
    return {
      displayName: stored && stored.display_name ? stored.display_name : "",
      pictureUrl: stored && stored.picture_url ? stored.picture_url : "",
      profileStatus: fetched.status || 0,
      profileError: fetched.detail || fetched.error || "LINE profile unavailable",
    };
  }

  return {
    displayName: stored.display_name || "",
    pictureUrl: stored.picture_url || "",
    profileStatus: stored.profile_status || null,
    profileError: stored.profile_error || "",
  };
}

async function getProfile(env, floor, userId) {
  if (!env.DB) return null;
  return await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ? AND floor_id = ?").bind(userId, floor || FLOOR_MAIN).first();
}

async function upsertProfile(env, input) {
  if (!env.DB || !input.userId) return;
  const now = Number(input.now || Date.now());
  const displayName = stringValue(input.displayName);
  const pictureUrl = stringValue(input.pictureUrl);
  await env.DB.prepare(`
    INSERT INTO profiles (user_id, floor_id, display_name, picture_url, source_type, source_id, profile_status, profile_error, last_profile_sync, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE profiles.display_name END,
      picture_url = CASE WHEN excluded.picture_url != '' THEN excluded.picture_url ELSE profiles.picture_url END,
      source_type = CASE WHEN excluded.source_type != '' THEN excluded.source_type ELSE profiles.source_type END,
      source_id = CASE WHEN excluded.source_id != '' THEN excluded.source_id ELSE profiles.source_id END,
      profile_status = excluded.profile_status,
      profile_error = excluded.profile_error,
      last_profile_sync = excluded.last_profile_sync,
      updated_at = excluded.updated_at
  `).bind(input.userId, input.floor || FLOOR_MAIN, displayName, pictureUrl, stringValue(input.sourceType || "user"), stringValue(input.sourceId), input.profileStatus || null, stringValue(input.profileError), now, now, now).run();
}

async function analyzeMessage(env, floor, text, userId, userName) {
  const local = await localKnowledgeSuggestion(env, floor, text);
  const learned = await localReplyLearningSuggestion(env, floor, text);
  const important = isImportantText(text);
  const fallback = {
    isImportant: important,
    category: learned.category || local.category || (important ? "\u91cd\u8981\u8a0a\u606f" : "\u4e00\u822c\u8a0a\u606f"),
    sentiment: important ? "negative" : "neutral",
    suggestions: uniqueSuggestions([...learned.suggestions, ...local.suggestions]).slice(0, 3).length ? uniqueSuggestions([...learned.suggestions, ...local.suggestions]).slice(0, 3) : ["\u60a8\u597d\uff0c\u611f\u8b1d\u60a8\u7684\u7559\u8a00\u3002\u8acb\u554f\u60a8\u5177\u9ad4\u60f3\u4e86\u89e3\u54ea\u65b9\u9762\u7684\u8cc7\u8a0a\uff1f"],
    summary: learned.summary || local.summary || "local fallback",
    reportReason: important ? "\u542b\u5ba2\u8a34\u3001\u8ca0\u8a55\u6216\u9ad8\u98a8\u96aa\u95dc\u9375\u5b57" : "",
  };

  if (!env.OPENAI_API_KEY) return fallback;
  try {
    const prompt = [
      "\u4f60\u662f LINE OA \u5f8c\u53f0\u7ba1\u7406\u54e1\u7684 AI \u52a9\u7406\uff0c\u53ea\u7522\u751f\u7ba1\u7406\u54e1\u56de\u8986\u5efa\u8b70\uff0c\u7d55\u5c0d\u4e0d\u81ea\u52d5\u56de\u8986\u7528\u6236\u3002",
      "\u8acb\u6839\u64da\u77e5\u8b58\u5eab\u8207\u7528\u6236\u8a0a\u606f\uff0c\u8f38\u51fa JSON\uff1a{\"isImportant\":boolean,\"category\":\"\",\"sentiment\":\"neutral|negative|positive\",\"suggestions\":[\"\"],\"summary\":\"\",\"reportReason\":\"\"}",
      `userId: ${userId}`,
      `userName: ${userName}`,
      `message: ${text}`,
      `knowledge: ${JSON.stringify(local.matches.slice(0, 6))}`,
      `learnedReplies: ${JSON.stringify(learned.matches.slice(0, 6))}`,
    ].join("\n");
    const generated = await callOpenAI(env, prompt);
    const parsed = JSON.parse(generated);
    return {
      ...fallback,
      ...parsed,
      suggestions: Array.isArray(parsed.suggestions) && parsed.suggestions.length ? parsed.suggestions.map(stringValue).filter(Boolean).slice(0, 3) : fallback.suggestions,
      isImportant: Boolean(parsed.isImportant || fallback.isImportant),
    };
  } catch (_err) {
    return fallback;
  }
}

async function localKnowledgeSuggestion(env, floor, text) {
  if (!env.DB) return { matches: [], suggestions: [] };
  const targetFloor = floor || FLOOR_MAIN;
  const { results } = await env.DB.prepare("SELECT category, question, answer FROM knowledge_items WHERE floor_id = ? OR floor_id = 'main' ORDER BY CASE WHEN floor_id = ? THEN 0 ELSE 1 END, id ASC LIMIT 1200").bind(targetFloor, targetFloor).all();
  const query = normalizeKnowledgeText(text);
  const terms = knowledgeSearchTerms(text);
  const matches = (results || []).map((item) => {
    const category = stringValue(item.category);
    const question = stringValue(item.question);
    const answer = stringValue(item.answer);
    const haystack = normalizeKnowledgeText(`${category} ${question} ${answer}`);
    const questionNorm = normalizeKnowledgeText(question);
    const categoryNorm = normalizeKnowledgeText(category);
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      if (questionNorm.includes(term)) score += 5;
      else if (categoryNorm.includes(term)) score += 4;
      else if (haystack.includes(term)) score += term.length >= 4 ? 2 : 1;
    }
    if (query && questionNorm && (query.includes(questionNorm) || questionNorm.includes(query))) score += 12;
    if (query && categoryNorm && query.includes(categoryNorm)) score += 7;
    score += knowledgeOverlapScore(query, questionNorm) * 2;
    score += knowledgeOverlapScore(query, categoryNorm);
    return { ...item, category, question, answer, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (!matches.length) return { matches: [], suggestions: [] };
  return {
    matches: matches.map((item) => ({ category: item.category, question: item.question, answer: item.answer, score: item.score })),
    category: matches[0].category,
    suggestions: matches.slice(0, 3).map(knowledgeReplySuggestion),
    summary: "local knowledge match",
  };
}

async function localReplyLearningSuggestion(env, floor, text) {
  if (!env.DB) return { matches: [], suggestions: [] };
  await ensureReplyLearningSchema(env);
  const targetFloor = floor || FLOOR_MAIN;
  const { results } = await env.DB.prepare(`
    SELECT learning_key, floor_id, user_text, reply_text, category, tags, use_count, updated_at
    FROM reply_learning
    WHERE floor_id = ? OR floor_id = ?
    ORDER BY updated_at DESC
    LIMIT 500
  `).bind(targetFloor, FLOOR_MAIN).all();
  const terms = tokenize(text);
  const matches = (results || []).map((item) => {
    const haystack = `${item.category} ${item.user_text} ${item.reply_text}`;
    const exactUserText = normalizeLearningText(item.user_text) === normalizeLearningText(text);
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
      + (exactUserText ? 8 : 0)
      + Math.min(Number(item.use_count || 0), 5);
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (!matches.length) return { matches: [], suggestions: [] };
  return {
    matches: matches.map((item) => ({
      userText: item.user_text,
      replyText: item.reply_text,
      category: item.category,
      score: item.score,
    })),
    category: matches[0].category,
    suggestions: uniqueSuggestions(matches.map((item) => item.reply_text)).slice(0, 3),
    summary: "reply learning match",
  };
}

function normalizeKnowledgeText(value) {
  return stringValue(value).toLowerCase().replace(/[\s,，。！？!?、/\\\-_:：;；()[\]{}「」『』【】《》〈〉.．]+/g, "");
}

function knowledgeSearchTerms(text) {
  const raw = stringValue(text);
  const normalized = normalizeKnowledgeText(raw);
  const terms = new Set(tokenize(raw).map(normalizeKnowledgeText).filter(Boolean));
  if (normalized.length >= 2) {
    terms.add(normalized);
    for (let size = Math.min(6, normalized.length); size >= 2; size -= 1) {
      for (let i = 0; i <= normalized.length - size; i += 1) {
        const term = normalized.slice(i, i + size);
        if (!/^[0-9a-z]+$/.test(term) || term.length >= 3) terms.add(term);
      }
    }
  }
  return Array.from(terms).filter((term) => term.length >= 2).slice(0, 80);
}

function knowledgeOverlapScore(query, target) {
  const q = normalizeKnowledgeText(query);
  const t = normalizeKnowledgeText(target);
  if (!q || !t) return 0;
  const grams = new Set();
  for (let i = 0; i < q.length - 1; i += 1) grams.add(q.slice(i, i + 2));
  let score = 0;
  for (const gram of grams) if (t.includes(gram)) score += 1;
  return score;
}

function knowledgeReplySuggestion(item) {
  const category = stringValue(item && item.category) || "相關資訊";
  const answer = stringValue(item && item.answer).replace(/\s+/g, " ").trim();
  const compact = answer.length > 260 ? `${answer.slice(0, 260)}...` : answer;
  return `您好，關於${category}，${compact}`;
}
function uniqueSuggestions(items) {
  const output = [];
  const seen = new Set();
  for (const item of items || []) {
    const text = stringValue(item).trim();
    if (!text) continue;
    const key = normalizeLearningText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

async function fetchReplyLearning(env, floor = FLOOR_MAIN, limit = 50) {
  if (!env.DB) return { count: 0, items: [] };
  await ensureReplyLearningSchema(env);
  const targetFloor = floor || FLOOR_MAIN;
  const [countRow, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM reply_learning WHERE floor_id = ?").bind(targetFloor).first(),
    env.DB.prepare(`
      SELECT learning_key, floor_id, user_name, user_text, reply_text, category, tags, source, quality, use_count, created_at, updated_at
      FROM reply_learning
      WHERE floor_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(targetFloor, limit).all(),
  ]);
  return { count: Number(countRow && countRow.count || 0), items: rows.results || [] };
}

async function rebuildReplyLearning(env, floor = FLOOR_MAIN, limit = 500) {
  if (!env.DB) return { scanned: 0, learned: 0 };
  await ensureReplyLearningSchema(env);
  const targetFloor = floor || FLOOR_MAIN;
  const rows = await env.DB.prepare(`
    SELECT m.id, m.floor_id, m.thread_id, m.user_id, m.text, m.category, m.created_at, t.display_name, t.tags
    FROM messages m
    LEFT JOIN threads t ON t.id = m.thread_id AND t.floor_id = m.floor_id
    WHERE m.floor_id = ?
      AND m.sender_role = ?
      AND m.text IS NOT NULL
      AND m.text <> ''
    ORDER BY m.created_at DESC
    LIMIT ?
  `).bind(targetFloor, ADMIN_ROLE, limit).all();
  let learned = 0;
  for (const row of rows.results || []) {
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM reply_learning WHERE reply_message_id = ?").bind(row.id).first();
    if (Number(before && before.count || 0) > 0) continue;
    const result = await learnFromAdminReply(env, {
      floor: row.floor_id,
      threadId: row.thread_id,
      userId: row.user_id,
      userName: row.display_name,
      replyText: row.text,
      replyMessageId: row.id,
      category: row.category,
      createdAt: row.created_at,
      tags: row.tags || "[]",
    });
    if (result) learned += 1;
  }
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM reply_learning WHERE floor_id = ?").bind(targetFloor).first();
  return { scanned: (rows.results || []).length, learned, count: Number(countRow && countRow.count || 0) };
}

async function callOpenAI(env, prompt) {
  const apiUrl = env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
  const model = env.OPENAI_MODEL || "gpt-5-mini";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 700,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${body}`);
  return extractOpenAIText(JSON.parse(body));
}

function extractOpenAIText(body) {
  const chunks = [];
  const pushText = (value) => {
    if (typeof value === "string" && value.trim()) chunks.push(value.trim());
  };
  pushText(body && body.output_text);
  for (const item of body && body.output || []) {
    pushText(item && item.text);
    for (const part of item && item.content || []) {
      if (typeof part === "string") pushText(part);
      pushText(part && part.text);
      pushText(part && part.output_text);
      if (part && part.type === "output_text") pushText(part.text);
    }
  }
  for (const choice of body && body.choices || []) {
    pushText(choice && choice.text);
    pushText(choice && choice.message && choice.message.content);
  }
  if (chunks.length) return chunks.join("\n");
  const status = body && body.status ? ` status=${body.status}` : "";
  const reason = body && body.incomplete_details ? ` incomplete=${JSON.stringify(body.incomplete_details)}` : "";
  throw new Error(`OpenAI returned empty content.${status}${reason}`);
}

async function importKnowledge(env, floor, payload, fileName) {
  const normalized = normalizeKnowledgePayload(typeof payload === "string" ? JSON.parse(payload) : payload);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM knowledge_items WHERE floor_id = ?").bind(floor || FLOOR_MAIN).run();
  await insertKnowledgeItems(env, floor || FLOOR_MAIN, normalized.items, fileName, now);
  const meta = { title: normalized.title, version: normalized.version, source: fileName, count: normalized.items.length, updatedAt: new Date(now).toISOString() };
  await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(`knowledge_meta:${floor || FLOOR_MAIN}`, JSON.stringify(meta), now).run();
  return { status: "success", count: normalized.items.length, meta };
}

async function upsertKnowledgeFile(env, floor, payload, path) {
  const normalized = normalizeKnowledgePayload(typeof payload === "string" ? JSON.parse(payload) : payload);
  const now = Date.now();
  const targetFloor = floor || FLOOR_MAIN;
  await env.DB.prepare("DELETE FROM knowledge_items WHERE floor_id = ? AND source = ?").bind(targetFloor, path).run();
  await insertKnowledgeItems(env, targetFloor, normalized.items, path, now);
  const manifest = await getKnowledgeManifest(env, targetFloor);
  return { file: knowledgeFileEntry(path, normalized, normalized.items.length, now), manifest };
}

async function insertKnowledgeItems(env, floor, items, source, now) {
  const statements = items.map((item) => env.DB.prepare("INSERT INTO knowledge_items (floor_id, category, question, answer, source, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(floor, item.category, item.question, item.answer, source, now));
  if (statements.length) await env.DB.batch(statements);
}

async function deleteKnowledgeFile(env, floor, path) {
  const targetFloor = floor || FLOOR_MAIN;
  const result = await env.DB.prepare("DELETE FROM knowledge_items WHERE floor_id = ? AND source = ?").bind(targetFloor, path).run();
  return { path, deleted: Number(result.meta?.changes || 0), manifest: await getKnowledgeManifest(env, targetFloor) };
}

async function getKnowledgeManifest(env, floor = FLOOR_MAIN) {
  const targetFloor = floor || FLOOR_MAIN;
  const { results } = await env.DB.prepare(`
    SELECT source, category, COUNT(*) AS count, MAX(created_at) AS updated_at
    FROM knowledge_items
    WHERE floor_id = ?
    GROUP BY source, category
    ORDER BY MAX(created_at) DESC, source ASC
  `).bind(targetFloor).all();
  const bySource = new Map();
  for (const row of results || []) {
    const source = stringValue(row.source || "dashboard-upload.json") || "dashboard-upload.json";
    if (!bySource.has(source)) bySource.set(source, { source, categories: [], count: 0, updatedAt: 0 });
    const current = bySource.get(source);
    current.categories.push(stringValue(row.category || "一般"));
    current.count += Number(row.count || 0);
    current.updatedAt = Math.max(current.updatedAt, Number(row.updated_at || 0));
  }
  const files = Array.from(bySource.values()).map((item) => knowledgeFileEntry(item.source, { title: knowledgeTitleFromPath(item.source), category: item.categories[0], version: "" }, item.count, item.updatedAt));
  const total = files.reduce((sum, file) => sum + Number(file.count || 0), 0);
  return { id: "klink-knowledge", title: "KLINK 知識庫", version: new Date().toISOString().slice(0, 10), floor: targetFloor, count: total, files };
}

async function getKnowledgeFile(env, floor, path) {
  const targetFloor = floor || FLOOR_MAIN;
  const { results } = await env.DB.prepare("SELECT id, category, question, answer, source, created_at FROM knowledge_items WHERE floor_id = ? AND source = ? ORDER BY id ASC").bind(targetFloor, path).all();
  const rows = results || [];
  if (!rows.length) return null;
  const first = rows[0];
  return {
    id: safeKnowledgeSlug(path),
    title: knowledgeTitleFromPath(path),
    source: path,
    version: first.created_at ? new Date(Number(first.created_at)).toISOString().slice(0, 10) : "",
    status: "published",
    category: first.category || "一般",
    usage: "供 KLINK 客服監看與 AI 建議回覆比對使用。",
    entries: rows.map((row) => ({
      id: `item_${row.id}`,
      title: row.question,
      keywords: tokenize(row.question).slice(0, 8),
      answer: row.answer,
      reply_template: row.answer,
      tags: [row.category || "一般"],
    })),
  };
}

function knowledgeFileEntry(path, normalized, count, updatedAt) {
  const safePath = stringValue(path || "dashboard-upload.json") || "dashboard-upload.json";
  return {
    id: safeKnowledgeSlug(safePath),
    folder: knowledgeFolderFromPath(safePath, normalized.category),
    title: normalized.title || knowledgeTitleFromPath(safePath),
    path: safePath,
    category: normalized.category || "一般",
    status: "published",
    source: safePath,
    count: Number(count || 0),
    updated_at: updatedAt ? new Date(Number(updatedAt)).toISOString() : "",
  };
}

function knowledgeFolderFromPath(path, category) {
  const parts = stringValue(path).split("/").filter(Boolean);
  if (parts[0] === "knowledge" && parts[1]) return parts[1];
  return stringValue(category || "legacy").replace(/\s+/g, "_") || "legacy";
}

function knowledgeTitleFromPath(path) {
  const base = stringValue(path).split("/").filter(Boolean).pop() || "知識庫檔案";
  return base.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim() || "知識庫檔案";
}

function safeKnowledgeSlug(value) {
  return stringValue(value || "knowledge").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "knowledge";
}

async function getKnowledgeMeta(env, floor = FLOOR_MAIN) {
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(`knowledge_meta:${floor}`).first();
  if (row && row.value) {
    try { return JSON.parse(row.value); } catch (_err) { /* ignore */ }
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM knowledge_items WHERE floor_id = ?").bind(floor).first();
  return { count: Number((count && count.count) || 0), source: "D1", updatedAt: "" };
}

function normalizeKnowledgePayload(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const rawItems = Array.isArray(payload) ? payload : (Array.isArray(source.items) ? source.items : (Array.isArray(source.entries) ? source.entries : []));
  const defaultCategory = stringValue(source.category || source.folder || "一般");
  return {
    title: stringValue(source.title || source.name),
    version: stringValue(source.version || source.updatedAt || source.updated_at),
    category: defaultCategory,
    items: rawItems.map((item, index) => {
      const category = stringValue(item.category || item.categoryName || (Array.isArray(item.tags) ? item.tags[0] : "") || defaultCategory || "一般");
      const question = stringValue(item.question || item.q || item.title || item.id || item["問題"]);
      const answer = stringValue(item.answer || item.a || item.reply_template || item.response || item.content || item["答案"]);
      if (!question || !answer) throw new Error(`Invalid knowledge item at index ${index}: question/title and answer/reply_template are required`);
      return { category, question, answer };
    }),
  };
}
const CHECKIN_TEMPLATE_IMAGE_PREFIX = "checkin_template_image:";
const CHECKIN_TEMPLATE_IMAGE_MAX_BYTES = 1024 * 1024;

async function uploadCheckinTemplateImage(request, env) {
  await ensureAppMetaSchema(env);
  const form = await request.formData();
  const file = form.get("image");
  if (!file || typeof file.arrayBuffer !== "function") throw httpError("請上傳圖片檔。", 400);
  const mimeType = stringValue(file.type || "").toLowerCase();
  const supported = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!supported.has(mimeType)) throw httpError("圖片格式僅支援 JPG、PNG、WEBP、GIF。", 400);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > CHECKIN_TEMPLATE_IMAGE_MAX_BYTES) throw httpError("圖片檔案過大，請壓到 1MB 以內。", 400);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "jpg";
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
  const now = Date.now();
  const data = {
    id,
    mimeType,
    size: buffer.byteLength,
    fileName: stringValue(file.name || id).slice(0, 160),
    base64: arrayBufferToBase64(buffer),
    createdAt: now,
  };
  await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").bind(CHECKIN_TEMPLATE_IMAGE_PREFIX + id, JSON.stringify(data), now).run();
  return { id, url: `${publicBaseUrl(env)}/assets/checkin-template/${encodeURIComponent(id)}`, mimeType, size: buffer.byteLength };
}

async function serveCheckinTemplateImage(env, pathname, corsHeaders) {
  await ensureAppMetaSchema(env);
  const id = decodeURIComponent(String(pathname || "").split("/").pop() || "");
  if (!id || id.includes("..") || id.includes("/")) return new Response("Invalid image id", { status: 400, headers: corsHeaders });
  const row = await env.DB.prepare("SELECT value, updated_at FROM app_meta WHERE key = ?").bind(CHECKIN_TEMPLATE_IMAGE_PREFIX + id).first();
  if (!row || !row.value) return new Response("Image not found", { status: 404, headers: corsHeaders });
  let data = null;
  try { data = JSON.parse(row.value); } catch (_err) { data = null; }
  if (!data || !data.base64 || !data.mimeType) return new Response("Invalid image data", { status: 500, headers: corsHeaders });
  return new Response(base64ToUint8Array(data.base64), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": data.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": `"${id}-${row.updated_at || 0}"`,
    },
  });
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function aiWearMimeExtension(mimeType) {
  const type = stringValue(mimeType).toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

function aiWearResultObjectKey(id, mimeType) {
  return `ai-wear/results/${stringValue(id)}.${aiWearMimeExtension(mimeType)}`;
}

async function storeAiWearGeneratedResult(env, id, generated) {
  const mimeType = stringValue(generated && generated.mimeType) || "image/png";
  const resultUrl = `${publicBaseUrl(env)}${AI_WEAR_RESULT_ASSET_PREFIX}${encodeURIComponent(id)}`;
  const bucket = env.AI_WEAR_BUCKET;
  if (generated && generated.base64) {
    if (!bucket || typeof bucket.put !== "function") throw httpError("AI 已產生圖片，但 R2 儲存桶尚未設定，系統無法保存。此錯誤不會扣會員 K 點。", 500, "ai_wear_r2_not_configured");
    const bytes = base64ToUint8Array(generated.base64);
    await bucket.put(aiWearResultObjectKey(id, mimeType), bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { kind: "ai-wear-result", id: stringValue(id) },
    });
    return { url: resultUrl, mimeType, storage: "r2" };
  }
  const remoteUrl = stringValue(generated && generated.url);
  if (remoteUrl) return { url: remoteUrl, mimeType, storage: "remote" };
  throw httpError("AI image2 未回傳圖片。", 502, "ai_wear_empty_image");
}
const CHECKIN_TEMPLATE_META_KEY = "checkin_reward_template";
const DEFAULT_CHECKIN_TEMPLATE = {
  active: true,
  keywords: ["簽到贈點活動"],
  altText: "簽到贈點活動",
  pages: [
    {
      imageUrl: "https://k-link.cc/wp-content/uploads/2026/06/e9249f41c67958a396c3dddc07081d3d.jpg",
      imageLink: "",
      bubbleSize: "nano",
      imageAspectRatio: "400:600",
      imageAspectMode: "cover",
      buttons: [{ label: "簽到贈點", type: "message", text: "會員打卡", uri: "", color: "" }],
    },
    {
      imageUrl: "https://k-link.cc/wp-content/uploads/2026/06/94f5d7aa7084fc056863902be7adec78.jpg",
      imageLink: "",
      bubbleSize: "nano",
      imageAspectRatio: "400:600",
      imageAspectMode: "cover",
      buttons: [{ label: "點數查詢", type: "uri", text: "", uri: "https://liff.line.me/2007221311-c9SEkcRL", color: "#FF0000" }],
    },
  ],
};

async function ensureAppMetaSchema(env) {
  if (!env.DB) throw httpError("DB is not configured", 500);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)").run();
}



async function loadAiWearSettingsRaw(env) {
  await ensureAppMetaSchema(env);
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(AI_WEAR_SETTINGS_META_KEY).first();
  let stored = {};
  if (row && row.value) {
    try { stored = JSON.parse(row.value) || {}; } catch (_err) { stored = {}; }
  }
  return normalizeAiWearSettings(stored);
}

async function getAiWearPublicData(env) {
  await ensureAiWearSchema(env);
  const settings = await loadAiWearSettingsRaw(env);
  const gallery = await listAiWearReferences(env);
  return {
    settings: sanitizeAiWearSettingsForClient(settings),
    gallery: gallery.items || [],
  };
}

async function preflightAiWearGenerate(request, env) {
  await ensureAiWearSchema(env);
  const settings = await loadAiWearSettingsRaw(env);
  if (!settings.image2ApiKey) throw httpError("AI image2 API Key 尚未設定，請先到後台儲存設定。", 400);
  const form = await request.formData();
  const selfie = await resolveAiWearSelfieFromForm(form, env);
  if (!selfie || !selfie.buffer || !selfie.buffer.byteLength) throw httpError("請先上傳人物照片。", 400);
  if (selfie.buffer.byteLength > AI_WEAR_IMAGE_MAX_BYTES) throw httpError("人物照片過大，請重新上傳較小的照片。", 400);
  const modelId = stringValue(form.get("modelId") || form.get("model_id"));
  if (!modelId || modelId.includes("..") || modelId.includes("/")) throw httpError("請先選擇眼鏡款式。", 400);
  const reference = await env.DB.prepare("SELECT id, title, series FROM ai_wear_references WHERE id = ? AND active = 1").bind(modelId).first();
  if (!reference) throw httpError("找不到眼鏡參考圖，請重新選擇款式。", 404);
  const verifiedProfile = await verifyAiWearLineProfileFromForm(env, settings, form);
  const lineUserId = stringValue(verifiedProfile && verifiedProfile.userId);
  const pointCost = Number(settings.pointCost || 0);
  if (settings.pointDeductionEnabled && pointCost > 0 && !lineUserId) throw httpError("請先用 LINE 登入後再生成，系統需要確認會員 UID 才能扣點。", 401);
  let balance = 0;
  if (settings.pointDeductionEnabled && pointCost > 0) {
    balance = await getLiveFirstPointAccountBalance(env, settings.pointChannelKey, lineUserId, settings.pointType);
    if (balance < pointCost) throw httpError(`K點不足，目前 ${balance} 點，需要 ${pointCost} 點。`, 402);
  }
  return {
    ok: true,
    modelId,
    modelTitle: stringValue(reference.title),
    series: stringValue(reference.series),
    pointCost,
    balance,
    lineUserId,
    selfieSize: Number(selfie.size || selfie.buffer.byteLength || 0),
  };
}
async function generateAiWearImage(request, env) {
  await ensureAiWearSchema(env);
  const settings = await loadAiWearSettingsRaw(env);
  if (!settings.image2ApiKey) throw httpError("AI image2 API Key 尚未設定，請先到後台儲存設定。", 400);
  const form = await request.formData();
  const selfie = await resolveAiWearSelfieFromForm(form, env);
  const personBuffer = selfie.buffer;
  const personMimeType = selfie.mimeType;
  if (!personBuffer || !personBuffer.byteLength) throw httpError("請上傳人物照片。", 400);
  if (personBuffer.byteLength > AI_WEAR_IMAGE_MAX_BYTES) throw httpError("人物照片過大，請壓到 2MB 以內。", 400);
  const maskFile = form.get("editMask") || form.get("mask") || form.get("maskImage");
  let maskBuffer = null;
  let maskMimeType = "";
  if (maskFile && typeof maskFile.arrayBuffer === "function") {
    maskMimeType = stringValue(maskFile.type || "image/png").toLowerCase();
    if (maskMimeType !== "image/png") throw httpError("原圖鎖定遮罩必須是 PNG。", 400);
    maskBuffer = await maskFile.arrayBuffer();
    if (maskBuffer.byteLength > AI_WEAR_IMAGE_MAX_BYTES) throw httpError("原圖鎖定遮罩過大，請壓到 2MB 以內。", 400);
  }
  const modelId = stringValue(form.get("modelId") || form.get("model_id"));
  if (!modelId || modelId.includes("..") || modelId.includes("/")) throw httpError("請選擇眼鏡款式。", 400);
  const reference = await env.DB.prepare("SELECT id, title, series, mime_type, base64 FROM ai_wear_references WHERE id = ? AND active = 1").bind(modelId).first();
  if (!reference || !reference.base64) throw httpError("找不到眼鏡參考圖。", 404);
  const personDimensions = readAiWearImageDimensions(personBuffer, personMimeType);
  const verifiedProfile = await verifyAiWearLineProfileFromForm(env, settings, form);
  const verifiedLineUserId = stringValue(verifiedProfile && verifiedProfile.userId);
  const lineUserId = verifiedLineUserId || stringValue(selfie.lineUserId);
  const displayName = stringValue((verifiedProfile && verifiedProfile.displayName) || form.get("displayName") || form.get("display_name") || selfie.displayName).slice(0, 120);
  const pointCost = Number(settings.pointCost || 0);
  const shouldDeductPoints = Boolean(settings.pointDeductionEnabled && pointCost > 0 && lineUserId);
  if (settings.pointDeductionEnabled && pointCost > 0 && !verifiedLineUserId) throw httpError("請先用 LINE 登入後再生成，系統需要確認會員 UID 才能扣點。", 401);
  if (shouldDeductPoints) {
    const balance = await getLiveFirstPointAccountBalance(env, settings.pointChannelKey, lineUserId, settings.pointType);
    if (balance < pointCost) throw httpError(`K點不足，目前 ${balance} 點，需要 ${pointCost} 點。`, 402);
  }
  const wearMode = normalizeAiWearWearMode(form.get("wear_mode") || form.get("wearMode"));
  const prompt = buildAiWearIdentityPrompt(settings, reference, personDimensions, Boolean(maskBuffer), wearMode);
  const generated = await callAiWearImageApi(env, settings, {
    prompt,
    personBuffer,
    personMimeType,
    personFileName: selfie.fileName || "selfie.jpg",
    maskBuffer,
    maskMimeType,
    referenceBase64: stringValue(reference.base64),
    referenceMimeType: stringValue(reference.mime_type || "image/jpeg"),
    referenceFileName: stringValue(reference.id || "glasses.jpg"),
    referenceImageUrl: `${publicBaseUrl(env)}${AI_WEAR_REFERENCE_ASSET_PREFIX}${encodeURIComponent(stringValue(reference.id || ""))}`,
    referenceTitle: stringValue(reference.title),
    referenceSeries: stringValue(reference.series),
    personDimensions,
    referenceModelId: modelId,
    referenceProductUrl: stringValue(form.get("model_product_url") || form.get("modelProductUrl") || ""),
    wearMode,
  });
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = Date.now();
  let deductedPointCost = 0;
  const storedResult = await storeAiWearGeneratedResult(env, id, generated);
  const storedResultBase64 = "";
  const resultUrl = storedResult.url;
  const inlineDataUrl = "";
  // Final billing happens in saveAiWearResult after the browser-side original-photo composite is stored.
  await env.DB.prepare(`INSERT INTO ai_wear_results (id, line_user_id, display_name, model_id, model_title, person_image_url, result_image_url, result_mime_type, result_base64, prompt, point_cost, point_channel_key, point_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    lineUserId,
    displayName,
    modelId,
    stringValue(reference.title).slice(0, 120),
    stringValue(selfie.url).slice(0, 500),
    stringValue(resultUrl).slice(0, 500),
    stringValue(storedResult.mimeType || generated.mimeType || "image/png"),
    storedResultBase64,
    prompt.slice(0, 4000),
    deductedPointCost,
    settings.pointChannelKey,
    settings.pointType,
    "generated_raw",
    now,
  ).run();
  const finalUrl = resultUrl || inlineDataUrl;
  return {
    id,
    createdAt: now,
    resultUrl: finalUrl,
    inlineDataUrl,
    persistedImage: Boolean(storedResultBase64 || generated.url),
    modelId,
    modelTitle: stringValue(reference.title),
    selfie: aiWearSelfieToClient(selfie, env),
    result: { media_id: id, url: finalUrl, created_at: new Date(now).toISOString() },
  };
}

async function resolveAiWearSelfieFromForm(form, env) {
  const directFile = form.get("personImage") || form.get("person") || form.get("image") || form.get("selfie");
  if (directFile && typeof directFile.arrayBuffer === "function") {
    const mimeType = stringValue(directFile.type || "").toLowerCase();
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mimeType)) throw httpError("人物照片僅支援 JPG、PNG、WEBP。", 400);
    const buffer = await directFile.arrayBuffer();
    return {
      id: "",
      url: stringValue(form.get("selfie_url") || form.get("selfieUrl")),
      lineUserId: stringValue(form.get("lineUserId") || form.get("line_user_id")),
      displayName: stringValue(form.get("displayName") || form.get("display_name")),
      fileName: stringValue(directFile.name || "selfie.jpg"),
      mimeType,
      size: buffer.byteLength,
      buffer,
      createdAt: Date.now(),
    };
  }
  const selfieId = stringValue(form.get("selfie_media_id") || form.get("selfieMediaId") || form.get("selfie_id") || form.get("selfieId"));
  if (!selfieId || selfieId.includes("..") || selfieId.includes("/")) throw httpError("請先上傳自拍照。", 400);
  const row = await env.DB.prepare("SELECT id, line_user_id, display_name, file_name, mime_type, size, base64, created_at FROM ai_wear_selfies WHERE id = ?").bind(selfieId).first();
  if (!row || !row.base64) throw httpError("找不到已上傳自拍照，請重新上傳。", 404);
  return {
    id: stringValue(row.id),
    url: `${publicBaseUrl(env)}${AI_WEAR_SELFIE_ASSET_PREFIX}${encodeURIComponent(stringValue(row.id))}`,
    lineUserId: stringValue(row.line_user_id),
    displayName: stringValue(row.display_name),
    fileName: stringValue(row.file_name || "selfie.jpg"),
    mimeType: stringValue(row.mime_type || "image/jpeg"),
    size: numberOrZero(row.size),
    buffer: base64ToUint8Array(row.base64),
    createdAt: numberOrZero(row.created_at),
  };
}
function normalizeAiWearWearMode(value) {
  const text = stringValue(value).trim();
  return text === "no_glasses" ? "no_glasses" : "has_glasses";
}
function buildAiWearIdentityPrompt(settings, reference, personDimensions, hasMask, wearMode = "has_glasses") {
  const dimensionsText = personDimensions && personDimensions.width && personDimensions.height
    ? `原人物照片尺寸：${personDimensions.width}x${personDimensions.height}。輸出必須維持同一構圖、人物比例、鏡頭距離與裁切範圍，不得放大、不得拉近、不得改成另一張證件照或棚拍照。`
    : "輸出必須維持原人物照片的構圖、人物比例、鏡頭距離與裁切範圍，不得放大、不得拉近、不得改成另一張證件照或棚拍照。";
  const modeText = normalizeAiWearWearMode(wearMode) === "no_glasses"
    ? "使用者選擇原圖未戴眼鏡：只在眼睛、鼻樑與鏡腳應接觸區域新增參考眼鏡，不需要移除舊眼鏡。"
    : "使用者選擇原圖已有眼鏡：只在眼鏡區域先自然移除舊眼鏡，再置換成參考眼鏡。";
  const editScope = hasMask
    ? "遮罩透明區域是唯一可編輯範圍，只允許修改眼鏡、鼻墊、鏡片反光、鏡腳接觸陰影與被舊眼鏡遮住的小範圍皮膚。遮罩外所有像素必須保持原圖，不得重畫臉、頭髮、衣服、背景或整體光線。"
    : "沒有遮罩時也只能在眼鏡與其接觸陰影周邊做小範圍重建；不得重畫整張臉、不得改變臉型、不得改變眼睛、鼻子、嘴巴、眉毛、髮型、衣服、背景與光線。";
  const customPrompt = stringValue(settings.prompt || DEFAULT_AI_WEAR_PROMPT).trim();
  return [
    "任務：以第一張輸入的人物照片作為唯一主圖與身份基準，只對眼鏡區做局部編輯；遮罩外必須視為鎖定區，不得重新生成整張照片。",
    "輸入角色：第一張圖是本人原始照片，必須保留本人身份；第二張圖只是眼鏡款式參考，只能提取眼鏡本身的鏡框形狀、顏色、材質、粗細、鏡片大小、鼻墊、鏡腳、透明度與反光，不可提取第二張圖的背景、模特兒、構圖或光線。",
    dimensionsText,
    modeText,
    editScope,
    "身份保真硬性規則：結果中的人物必須與第一張原圖同一人；保留原臉型、五官比例、膚色、表情、眼神、髮型、衣服、姿勢、拍攝角度、背景與光線。不得美化、不得年輕化、不得換臉、不得讓臉變尖、不得改變眼距或鼻型。",
    "眼鏡處理：若原圖已有眼鏡，只在遮罩眼鏡區自然移除舊眼鏡遮擋後置換新眼鏡；若原圖未戴眼鏡，只在遮罩眼鏡放置區新增新眼鏡。新眼鏡需符合原照片頭部角度、眼睛位置、鼻樑位置與透視，加入自然接觸陰影與鏡片反光。",
    "不接受結果：生成另一個相似人物、改變人物角度、裁切成不同照片、改背景、改衣服、改髮型、改臉部表情，全部視為失敗。",
    customPrompt,
    `眼鏡款式名稱：${stringValue(reference && reference.title)}`,
    `系列：${stringValue(reference && reference.series)}`,
  ].filter(Boolean).join("\n\n");
}

function readAiWearImageDimensions(buffer, mimeType) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  const type = stringValue(mimeType).toLowerCase();
  if (bytes.length < 12) return null;
  if (type === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
  }
  if (type === "image/jpeg" || type === "image/jpg") {
    for (let index = 2; index + 9 < bytes.length;) {
      if (bytes[index] !== 0xff) { index += 1; continue; }
      const marker = bytes[index + 1];
      const length = readUInt16BE(bytes, index + 2);
      if (!length || index + length + 2 > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xc3) return { width: readUInt16BE(bytes, index + 7), height: readUInt16BE(bytes, index + 5) };
      index += 2 + length;
    }
  }
  if (type === "image/webp" && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const chunk = String.fromCharCode(bytes[12] || 0, bytes[13] || 0, bytes[14] || 0, bytes[15] || 0);
    if (chunk === "VP8X" && bytes.length >= 30) return { width: 1 + readUInt24LE(bytes, 24), height: 1 + readUInt24LE(bytes, 27) };
    if (chunk === "VP8 " && bytes.length >= 30) return { width: readUInt16LE(bytes, 26) & 0x3fff, height: readUInt16LE(bytes, 28) & 0x3fff };
  }
  return null;
}

function readUInt16BE(bytes, offset) { return ((bytes[offset] || 0) << 8) + (bytes[offset + 1] || 0); }
function readUInt16LE(bytes, offset) { return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8); }
function readUInt24LE(bytes, offset) { return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8) + ((bytes[offset + 2] || 0) << 16); }
function readUInt32BE(bytes, offset) { return ((bytes[offset] || 0) * 16777216) + ((bytes[offset + 1] || 0) << 16) + ((bytes[offset + 2] || 0) << 8) + (bytes[offset + 3] || 0); }

function chooseOpenAiWearImageSize(dimensions, model) {
  const width = Number(dimensions && dimensions.width) || 0;
  const height = Number(dimensions && dimensions.height) || 0;
  if (!width || !height) return "auto";
  const ratio = width / height;
  if (ratio > 1.12) return "1536x1024";
  if (ratio < 0.9) return "1024x1536";
  return "1024x1024";
}
async function callAiWearImageApi(env, settings, input) {
  const key = stringValue(settings.image2ApiKey).trim();
  const defaultOpenAiImageEditUrl = /^sk-(proj-)?[A-Za-z0-9_-]+/.test(key) ? "https://api.openai.com/v1/images/edits" : "";
  const apiUrl = stringValue(env.AI_IMAGE2_API_URL || settings.imageApiUrl || settings.aiweAjaxUrl || defaultOpenAiImageEditUrl).trim();
  if (!apiUrl) throw httpError("AI 穿戴後端尚未接上 image2 產圖服務。若使用 OpenAI sk-proj key，系統會自動使用 OpenAI Images Edit；其他 provider 請在 Worker 設定 AI_IMAGE2_API_URL。", 500);
  if (/wp-admin\/admin-ajax\.php/i.test(apiUrl)) {
    throw httpError("目前後端仍指向 AIWE WordPress AJAX，這不是正式 image2 產圖服務。本系統已改為自有圖庫流程，請改接正式 image2 provider。", 500);
  }
  const isOpenAiEndpoint = /(^|\.)openai\.com\/v1\/images\//i.test(apiUrl);
  if (isOpenAiEndpoint) return callOpenAiWearImageApi(settings, input, apiUrl);
  return callDirectImage2WearApi(settings, input, apiUrl);
}

async function callOpenAiWearImageApi(settings, input, apiUrl) {
  if (!/^sk-(proj-)?[A-Za-z0-9_-]+/.test(stringValue(settings.image2ApiKey))) {
    throw httpError("目前 API URL 是 OpenAI 圖片端點，但 image2 API Key 不是 OpenAI key 格式。請填入 image2 服務商 API URL，或改用 OpenAI key。", 400);
  }
  const requestedModel = stringValue(settings.imageModel || "gpt-image-2").trim() || "gpt-image-2";
  const effectiveImageModel = requestedModel.toLowerCase() === "image2" ? "gpt-image-2" : requestedModel;
  const payload = new FormData();
  payload.append("model", effectiveImageModel);
  payload.append("prompt", input.prompt);
  payload.append("size", chooseOpenAiWearImageSize(input.personDimensions, effectiveImageModel));
  payload.append("quality", "low");
  payload.append("n", "1");
  payload.append("background", "opaque");
  payload.append("output_format", "jpeg");
  payload.append("image[]", new Blob([input.personBuffer], { type: input.personMimeType || "image/jpeg" }), `PRIMARY_PERSON_KEEP_IDENTITY_${input.personFileName || "person.jpg"}`);
  if (input.maskBuffer) payload.append("mask", new Blob([input.maskBuffer], { type: input.maskMimeType || "image/png" }), "glasses-mask.png");
  payload.append("image[]", new Blob([base64ToUint8Array(input.referenceBase64)], { type: input.referenceMimeType || "image/jpeg" }), `GLASSES_STYLE_REFERENCE_ONLY_${input.referenceFileName || "glasses.jpg"}`);
  return parseAiWearImageResponse(await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.image2ApiKey}` },
    body: payload,
  }));
}

async function callDirectImage2WearApi(settings, input, apiUrl) {
  const payload = new FormData();
  payload.append("model", stringValue(settings.imageModel || "image2") || "image2");
  payload.append("prompt", input.prompt);
  payload.append("mode", "identity_preserving_image_to_image");
  payload.append("edit_scope", "glasses_only");
  payload.append("preserve_identity", "true");
  payload.append("preserve_composition", "true");
  payload.append("person_image_role", "primary_identity_anchor");
  payload.append("reference_image_role", "glasses_style_only");
  payload.append("person_width", String(Number(input.personDimensions && input.personDimensions.width) || ""));
  payload.append("person_height", String(Number(input.personDimensions && input.personDimensions.height) || ""));
  payload.append("person_image", new Blob([input.personBuffer], { type: input.personMimeType || "image/jpeg" }), input.personFileName || "person.jpg");
  if (input.maskBuffer) payload.append("mask_image", new Blob([input.maskBuffer], { type: input.maskMimeType || "image/png" }), "glasses-mask.png");
  payload.append("reference_image", new Blob([base64ToUint8Array(input.referenceBase64)], { type: input.referenceMimeType || "image/jpeg" }), input.referenceFileName || "glasses.jpg");
  payload.append("reference_title", stringValue(input.referenceTitle || ""));
  payload.append("reference_series", stringValue(input.referenceSeries || ""));
  return parseAiWearImageResponse(await fetch(apiUrl, {
    method: "POST",
    headers: aiWearOptionalAuthHeaders(settings),
    body: payload,
  }));
}
function aiWearOptionalAuthHeaders(settings) {
  const key = stringValue(settings.image2ApiKey).trim();
  return key ? { Authorization: `Bearer ${key}`, "X-API-Key": key } : {};
}

function translateAiWearApiError(message, detail = {}) {
  const text = stringValue(message).trim();
  if (!text) return "產圖服務沒有回傳錯誤內容，請稍後再試。";
  if (/Invalid size/i.test(text) && /minimum pixel budget/i.test(text)) return "圖片解析度低於 image2 最小像素要求；系統已調整輸出尺寸，請重新產生一次。";
  if (/Invalid size/i.test(text)) return "圖片輸出尺寸不符合 image2 規格，請重新產生一次。";
  if (/Incorrect API key/i.test(text)) return "API Key 不正確，請到 AI 穿戴設定重新確認。";
  if (/model .* does not exist/i.test(text) || /model.*not exist/i.test(text)) return "目前設定的模型不存在，請確認模型名稱是否正確。";
  if (/Country, region, or territory not supported|not supported in your country|unsupported country|region.*not supported/i.test(text)) return "OpenAI 圖片服務回覆：目前這個帳號、IP 或所在地區不支援圖片生成。請確認 OpenAI 組織/帳務地區、使用環境 IP、或改用可支援的 image2 provider。此錯誤不會扣會員 K 點。";
  if (/Duplicate parameter/i.test(text)) return "產圖請求欄位重複，系統需要調整送出格式。";
  if (/rate limit/i.test(text)) return "產圖服務流量過高，請稍後再試。";
  if (/insufficient_quota|quota.*exceed|exceed.*quota|exceeded your current quota|billing hard limit|credit|額度/i.test(text)) {
    const code = stringValue(detail.code);
    const type = stringValue(detail.type);
    const requestId = stringValue(detail.requestId);
    const meta = [type && `type=${type}`, code && `code=${code}`, requestId && `request_id=${requestId}`].filter(Boolean).join("，");
    return `OpenAI 回傳 quota 類錯誤：${text}${meta ? `（${meta}）` : ""}。這不等於一定是餘額用完；請用 request_id 到 OpenAI Logs 查實際原因，常見是 Project usage limit、rate limit、模型權限或帳務/組織狀態限制。此錯誤不會扣會員 K 點。`;
  }
  return text;
}
function aiWearResponseDebug(response, body) {
  const error = body && body.error && typeof body.error === "object" ? body.error : {};
  return {
    type: stringValue(error.type || (body && body.type)),
    code: stringValue(error.code || (body && body.code)),
    param: stringValue(error.param || (body && body.param)),
    requestId: stringValue(response.headers.get("x-request-id") || response.headers.get("openai-request-id") || response.headers.get("cf-ray")),
    retryAfter: stringValue(response.headers.get("retry-after")),
    limitRequests: stringValue(response.headers.get("x-ratelimit-limit-requests")),
    remainingRequests: stringValue(response.headers.get("x-ratelimit-remaining-requests")),
    resetRequests: stringValue(response.headers.get("x-ratelimit-reset-requests")),
  };
}
async function parseAiWearImageResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_err) { body = null; }
  if (!response.ok) {
    const rawMessage = body && body.error && body.error.message ? body.error.message : body && body.message ? body.message : text;
    const debug = aiWearResponseDebug(response, body || {});
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    const err = httpError(`AI image2 生成失敗 ${response.status}: ${translateAiWearApiError(rawMessage, debug)}`, status, debug.code || "ai_image_error");
    err.detail = debug;
    throw err;
  }
  const item = body && Array.isArray(body.data) ? body.data[0] : body && body.data && body.data.result ? body.data.result : body && body.result ? body.result : body;
  const base64 = stringValue(item && (item.b64_json || item.base64 || item.image_base64 || item.result_base64));
  const url = stringValue(item && (item.url || item.image_url || item.result_url || item.output_url));
  if (!base64 && !url) throw httpError("AI image2 未回傳圖片。", 502);
  return { base64, url, mimeType: stringValue(item && item.mime_type) || "image/jpeg" };
}
async function diagnoseAiWearOpenAi(env) {
  const settings = await loadAiWearSettingsRaw(env);
  const key = stringValue(settings.image2ApiKey).trim();
  const model = stringValue(settings.imageModel || "image2").trim() || "image2";
  const apiUrl = stringValue(env.AI_IMAGE2_API_URL || settings.imageApiUrl || settings.aiweAjaxUrl || "").trim();
  const looksOpenAiKey = /^sk-(proj-)?[A-Za-z0-9_-]+/.test(key);
  if (!key) return { ok: false, message: "AI image2 API Key 尚未設定。", model, apiUrlConfigured: Boolean(apiUrl), looksOpenAiKey };
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_err) { body = null; }
  const debug = aiWearResponseDebug(response, body || {});
  const models = body && Array.isArray(body.data) ? body.data.map((item) => stringValue(item && item.id)).filter(Boolean) : [];
  const imageModels = models.filter((id) => /image|dall|gpt-image/i.test(id));
  const error = body && body.error && typeof body.error === "object" ? body.error : null;
  return {
    ok: response.ok,
    httpStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    requestId: debug.requestId,
    errorType: stringValue(error && error.type),
    errorCode: stringValue(error && error.code),
    errorMessage: stringValue(error && error.message || (!response.ok ? text : "")),
    configuredModel: model,
    apiUrlConfigured: Boolean(apiUrl),
    apiUrlHost: apiUrl ? (() => { try { return new URL(apiUrl).host; } catch (_err) { return "invalid"; } })() : "openai.com default",
    looksOpenAiKey,
    visibleImageModels: imageModels.slice(0, 20),
    visibleImageModelCount: imageModels.length,
  };
}
async function getAiWearSettings(env) {
  return sanitizeAiWearSettingsForClient(await loadAiWearSettingsRaw(env));
}

async function saveAiWearSettings(env, input) {
  await ensureAppMetaSchema(env);
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(AI_WEAR_SETTINGS_META_KEY).first();
  let existing = {};
  if (row && row.value) {
    try { existing = JSON.parse(row.value) || {}; } catch (_err) { existing = {}; }
  }
  const data = normalizeAiWearSettings(input, existing);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(AI_WEAR_SETTINGS_META_KEY, JSON.stringify(data), now).run();
  return sanitizeAiWearSettingsForClient(data);
}

function normalizeAiWearSettings(input, existing = {}) {
  const source = input && typeof input === "object" ? input : {};
  const current = existing && typeof existing === "object" ? existing : {};
  const apiKeyInput = stringValue(source.image2ApiKey || source.apiKey || source.api_key).trim();
  const keptApiKey = apiKeyInput || stringValue(current.image2ApiKey || current.apiKey);
  const pointCost = Math.max(0, Math.floor(Number(source.pointCost ?? source.point_cost ?? current.pointCost ?? DEFAULT_AI_WEAR_SETTINGS.pointCost) || 0));
  const channelKey = POINT_CHANNELS.has(stringValue(source.pointChannelKey || source.channel_key || current.pointChannelKey))
    ? stringValue(source.pointChannelKey || source.channel_key || current.pointChannelKey)
    : DEFAULT_AI_WEAR_SETTINGS.pointChannelKey;
  const pointType = normalizePointType(source.pointType || source.point_type || current.pointType || DEFAULT_AI_WEAR_SETTINGS.pointType);
  const imageApiUrl = normalizeAiWearImageApiUrl(source.imageApiUrl || source.image_api_url || source.apiUrl || source.api_url || current.imageApiUrl || DEFAULT_AI_WEAR_SETTINGS.imageApiUrl);
  const aiweAjaxUrl = normalizeAiWearImageApiUrl(source.aiweAjaxUrl || source.aiwe_ajax_url || source.ajaxUrl || source.ajax_url || current.aiweAjaxUrl || current.ajaxUrl || imageApiUrl);
  const aiweNonce = stringValue(source.aiweNonce || source.aiwe_nonce || source.nonce || current.aiweNonce || current.nonce).slice(0, 120);
  const aiwePostId = stringValue(source.aiwePostId || source.aiwe_post_id || source.postId || source.post_id || current.aiwePostId || current.postId).slice(0, 40);
  return {
    title: stringValue(source.title || current.title || DEFAULT_AI_WEAR_SETTINGS.title).slice(0, 80),
    publicPath: normalizeAiWearPublicPath(source.publicPath || source.public_path || current.publicPath || DEFAULT_AI_WEAR_SETTINGS.publicPath),
    liffId: normalizeAiWearLiffId(source.liffId || source.liff_id || current.liffId || DEFAULT_AI_WEAR_SETTINGS.liffId),
    prompt: stringValue(source.prompt || current.prompt || DEFAULT_AI_WEAR_SETTINGS.prompt).slice(0, 4000),
    imageModel: stringValue(source.imageModel || source.model || current.imageModel || DEFAULT_AI_WEAR_SETTINGS.imageModel).slice(0, 60),
    imageApiUrl,
    aiweAjaxUrl,
    aiweNonce,
    aiwePostId,
    image2ApiKey: keptApiKey,
    pointDeductionEnabled: source.pointDeductionEnabled === true || source.point_deduction_enabled === true || source.deductPoints === true,
    pointCost,
    pointChannelKey: channelKey,
    pointType,
  };
}


function normalizeAiWearLiffId(value) {
  const text = stringValue(value).trim();
  if (!text) return DEFAULT_AI_WEAR_LIFF_ID;
  if (!/^\d+-[A-Za-z0-9_-]+$/.test(text)) return DEFAULT_AI_WEAR_LIFF_ID;
  return text.slice(0, 80);
}

function aiWearLineClientId(env, settings) {
  const configured = stringValue(env.AI_WEAR_LINE_LOGIN_CHANNEL_ID || env.REWARD_LINE_LOGIN_CHANNEL_ID || env.LINE_LOGIN_CHANNEL_ID || "").trim();
  if (configured) return configured;
  const liffId = normalizeAiWearLiffId(settings && settings.liffId);
  const match = liffId.match(/^(\d+)-/);
  return match ? match[1] : "";
}


async function verifyAiWearLineProfileFromToken(env, settings, idToken) {
  const token = stringValue(idToken).trim();
  if (!token) return null;
  const clientId = aiWearLineClientId(env, settings);
  if (!clientId) throw httpError("AI 穿戴尚未設定 LINE Login Channel ID。", 500);
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: clientId }).toString(),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
  if (!response.ok || !data || !data.sub) {
    const message = data && (data.error_description || data.error) || text || "LINE ID Token verify failed";
    throw httpError(`LINE 登入驗證失敗：${message}`, 401);
  }
  return {
    userId: stringValue(data.sub),
    displayName: stringValue(data.name),
    pictureUrl: stringValue(data.picture),
    email: stringValue(data.email),
  };
}

async function verifyAiWearLineProfileFromForm(env, settings, form) {
  const idToken = stringValue(form.get("idToken") || form.get("id_token") || form.get("lineIdToken") || form.get("line_id_token")).trim();
  return verifyAiWearLineProfileFromToken(env, settings, idToken);
}

async function fetchAiWearMemberPoints(env, body) {
  await ensureAiWearSchema(env);
  const settings = await loadAiWearSettingsRaw(env);
  const profile = await verifyAiWearLineProfileFromToken(env, settings, body && (body.idToken || body.id_token || body.lineIdToken || body.line_id_token));
  const lineUserId = stringValue(profile && profile.userId);
  if (!lineUserId) throw httpError("請先用 LINE 登入後再讀取 K 點。", 401);
  const balance = await getLiveFirstPointAccountBalance(env, settings.pointChannelKey, lineUserId, settings.pointType);
  return {
    lineUserId,
    displayName: stringValue((body && body.displayName) || (profile && profile.displayName)),
    pictureUrl: stringValue((body && body.pictureUrl) || (profile && profile.pictureUrl)),
    balance,
    pointChannelKey: settings.pointChannelKey,
    pointType: settings.pointType,
    pointCost: Number(settings.pointCost || 0),
  };
}
function normalizeAiWearImageApiUrl(value) {
  const text = stringValue(value).trim();
  if (!text) return "";
  if (!/^https:\/\//i.test(text)) return "";
  return text.slice(0, 500);
}
function sanitizeAiWearSettingsForClient(settings) {
  const data = { ...settings };
  data.hasImage2ApiKey = Boolean(data.image2ApiKey);
  data.image2ApiKey = "";
  return data;
}

function normalizeAiWearPublicPath(value) {
  const text = stringValue(value).trim() || "/ai-wear";
  if (/^https?:\/\//i.test(text)) return "/ai-wear";
  const path = (text.startsWith("/") ? text : `/${text}`).replace(/\/+/g, "/").slice(0, 120) || "/ai-wear";
  if (/^\/(api|admin|console|dashboard|assets|internal|line-webhook|webhook)(\/|$)/i.test(path)) return "/ai-wear";
  return path;
}

async function ensureAiWearSchema(env) {
  await ensureAppMetaSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_wear_references (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    base64 TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_wear_selfies (
    id TEXT PRIMARY KEY,
    line_user_id TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    base64 TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_wear_results (
    id TEXT PRIMARY KEY,
    line_user_id TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    model_title TEXT NOT NULL DEFAULT '',
    person_image_url TEXT NOT NULL DEFAULT '',
    result_image_url TEXT NOT NULL DEFAULT '',
    result_mime_type TEXT NOT NULL DEFAULT '',
    result_base64 TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    point_cost INTEGER NOT NULL DEFAULT 0,
    point_channel_key TEXT NOT NULL DEFAULT '',
    point_type TEXT NOT NULL DEFAULT 'gift_money',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at INTEGER NOT NULL DEFAULT 0
  )`).run();
}

function aiWearAssetIdFromPath(pathname, prefix) {
  const id = decodeURIComponent(String(pathname || "").slice(prefix.length));
  if (!id || id.includes("..") || id.includes("/")) return "";
  return id;
}

async function uploadAiWearSelfie(request, env) {
  await ensureAiWearSchema(env);
  const form = await request.formData();
  const file = form.get("selfie") || form.get("personImage") || form.get("person") || form.get("image");
  if (!file || typeof file.arrayBuffer !== "function") throw httpError("Selfie image is required.", 400);
  const mimeType = stringValue(file.type || "").toLowerCase();
  const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supported.has(mimeType)) throw httpError("Only JPG, PNG, and WEBP are supported.", 400);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > AI_WEAR_SELFIE_MAX_BYTES) throw httpError("自拍照片仍然過大，請重新選擇或截圖後再上傳。", 400);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
  const now = Date.now();
  const settings = await loadAiWearSettingsRaw(env);
  const verifiedProfile = await verifyAiWearLineProfileFromForm(env, settings, form);
  const lineUserId = stringValue((verifiedProfile && verifiedProfile.userId) || form.get("lineUserId") || form.get("line_user_id"));
  const displayName = stringValue((verifiedProfile && verifiedProfile.displayName) || form.get("displayName") || form.get("display_name")).slice(0, 120);
  const fileName = stringValue(file.name || id).slice(0, 160);
  await env.DB.prepare(`INSERT INTO ai_wear_selfies (id, line_user_id, display_name, file_name, mime_type, size, base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, lineUserId, displayName, fileName, mimeType, buffer.byteLength, arrayBufferToBase64(buffer), now).run();
  const selfie = { id, lineUserId, displayName, fileName, mimeType, size: buffer.byteLength, createdAt: now };
  return { selfie: aiWearSelfieToClient(selfie, env), selfieId: id, selfieUrl: `${publicBaseUrl(env)}${AI_WEAR_SELFIE_ASSET_PREFIX}${encodeURIComponent(id)}` };
}

function aiWearSelfieToClient(selfie, env) {
  const id = stringValue(selfie && selfie.id);
  const createdAt = numberOrZero(selfie && (selfie.createdAt || selfie.created_at));
  return {
    media_id: id,
    id,
    url: stringValue(selfie && selfie.url) || (id ? `${publicBaseUrl(env)}${AI_WEAR_SELFIE_ASSET_PREFIX}${encodeURIComponent(id)}` : ""),
    file_name: stringValue(selfie && (selfie.fileName || selfie.file_name)),
    mime_type: stringValue(selfie && (selfie.mimeType || selfie.mime_type)),
    size: numberOrZero(selfie && selfie.size),
    created_at: createdAt ? new Date(createdAt).toISOString() : "",
  };
}

async function serveAiWearSelfieImage(env, pathname, corsHeaders) {
  await ensureAiWearSchema(env);
  const id = aiWearAssetIdFromPath(pathname, AI_WEAR_SELFIE_ASSET_PREFIX);
  if (!id) return new Response("Invalid image id", { status: 400, headers: corsHeaders });
  const row = await env.DB.prepare("SELECT mime_type, base64, created_at FROM ai_wear_selfies WHERE id = ?").bind(id).first();
  if (!row || !row.base64) return new Response("Image not found", { status: 404, headers: corsHeaders });
  return new Response(base64ToUint8Array(row.base64), { status: 200, headers: { ...corsHeaders, "Content-Type": row.mime_type || "image/jpeg", "Cache-Control": "private, max-age=86400", "ETag": `"${id}-${row.created_at || 0}"` } });
}
async function uploadAiWearReference(request, env) {
  await ensureAiWearSchema(env);
  const form = await request.formData();
  const file = form.get("image");
  if (!file || typeof file.arrayBuffer !== "function") throw httpError("Reference image is required.", 400);
  const mimeType = stringValue(file.type || "").toLowerCase();
  const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supported.has(mimeType)) throw httpError("Only JPG, PNG, and WEBP are supported.", 400);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > AI_WEAR_IMAGE_MAX_BYTES) throw httpError("Image too large. Please keep it under 2MB.", 400);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
  const now = Date.now();
  const title = stringValue(form.get("title") || file.name || "Model").slice(0, 120);
  const series = stringValue(form.get("series") || "").slice(0, 80);
  await env.DB.prepare(`INSERT INTO ai_wear_references (id, title, series, file_name, mime_type, size, base64, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, title, series, stringValue(file.name || id).slice(0, 160), mimeType, buffer.byteLength, arrayBufferToBase64(buffer), now, now).run();
  return aiWearReferenceToClient({ id, title, series, file_name: stringValue(file.name || id), mime_type: mimeType, size: buffer.byteLength, active: 1, created_at: now, updated_at: now }, env);
}

async function listAiWearReferences(env) {
  await ensureAiWearSchema(env);
  const rows = await env.DB.prepare("SELECT id, title, series, file_name, mime_type, size, active, created_at, updated_at FROM ai_wear_references WHERE active = 1 ORDER BY updated_at DESC LIMIT 200").all();
  return { items: (rows.results || []).map((row) => aiWearReferenceToClient(row, env)) };
}

async function deleteAiWearReference(env, id) {
  await ensureAiWearSchema(env);
  const safeId = stringValue(id);
  if (!safeId || safeId.includes("..") || safeId.includes("/")) throw httpError("Invalid gallery ID.", 400);
  const now = Date.now();
  await env.DB.prepare("UPDATE ai_wear_references SET active = 0, updated_at = ? WHERE id = ?").bind(now, safeId).run();
  return { id: safeId, active: false };
}

function aiWearReferenceToClient(row, env) {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    series: stringValue(row.series),
    fileName: stringValue(row.file_name),
    mimeType: stringValue(row.mime_type),
    size: numberOrZero(row.size),
    url: `${publicBaseUrl(env)}${AI_WEAR_REFERENCE_ASSET_PREFIX}${encodeURIComponent(stringValue(row.id))}`,
    createdAt: numberOrZero(row.created_at),
    updatedAt: numberOrZero(row.updated_at),
  };
}

async function serveAiWearReferenceImage(env, pathname, corsHeaders) {
  await ensureAiWearSchema(env);
  const id = aiWearAssetIdFromPath(pathname, AI_WEAR_REFERENCE_ASSET_PREFIX);
  if (!id) return new Response("Invalid image id", { status: 400, headers: corsHeaders });
  const row = await env.DB.prepare("SELECT mime_type, base64, updated_at FROM ai_wear_references WHERE id = ? AND active = 1").bind(id).first();
  if (!row || !row.base64) return new Response("Image not found", { status: 404, headers: corsHeaders });
  return new Response(base64ToUint8Array(row.base64), { status: 200, headers: { ...corsHeaders, "Content-Type": row.mime_type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "ETag": `"${id}-${row.updated_at || 0}"` } });
}

async function saveAiWearResult(request, env) {
  await ensureAiWearSchema(env);
  const settings = await loadAiWearSettingsRaw(env);
  const now = Date.now();
  const contentType = request.headers.get("content-type") || "";
  let body = {};
  let resultMimeType = "";
  let resultUrl = "";
  let fileBuffer = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    body = Object.fromEntries(Array.from(form.entries()).filter(([, value]) => typeof value === "string"));
    const file = form.get("resultImage");
    if (file && typeof file.arrayBuffer === "function") {
      resultMimeType = stringValue(file.type || "image/jpeg").toLowerCase();
      fileBuffer = await file.arrayBuffer();
      if (fileBuffer.byteLength > AI_WEAR_RESULT_UPLOAD_MAX_BYTES) throw httpError("合成結果圖片過大，請重新上傳較低解析度自拍。", 400);
    }
  } else {
    body = await safeJson(request);
  }

  const configuredPointCost = Math.max(0, Math.floor(Number(settings.pointCost || 0) || 0));
  const shouldDeductPoints = Boolean(settings.pointDeductionEnabled && configuredPointCost > 0);
  let verifiedProfile = null;
  let lineUserId = stringValue(body.lineUserId || body.line_user_id);
  let displayName = stringValue(body.displayName || body.display_name).slice(0, 120);

  if (shouldDeductPoints) {
    verifiedProfile = await verifyAiWearLineProfileFromToken(env, settings, body.idToken || body.id_token || body.lineIdToken || body.line_id_token);
    lineUserId = stringValue(verifiedProfile && verifiedProfile.userId);
    displayName = stringValue((verifiedProfile && verifiedProfile.displayName) || displayName).slice(0, 120);
    if (!lineUserId) throw httpError("請先用 LINE 登入後再保存 AI 穿戴結果，系統需要確認會員 UID 才能扣點。", 401);
    const balance = await getLiveFirstPointAccountBalance(env, settings.pointChannelKey, lineUserId, settings.pointType);
    if (balance < configuredPointCost) throw httpError(`K點不足，目前 ${balance} 點，需要 ${configuredPointCost} 點。`, 402);
  }

  const id = stringValue(body.__storedId) || `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (fileBuffer) {
    const stored = await storeAiWearGeneratedResult(env, id, { base64: arrayBufferToBase64(fileBuffer), mimeType: resultMimeType });
    resultUrl = stored.url;
  }
  const modelId = stringValue(body.modelId || body.model_id);
  const model = modelId ? await env.DB.prepare("SELECT title FROM ai_wear_references WHERE id = ?").bind(modelId).first() : null;
  if (!resultUrl) resultUrl = stringValue(body.resultImageUrl || body.result_image_url).slice(0, 500);
  if (!resultUrl) throw httpError("AI 穿戴結果圖片尚未保存，未扣會員 K 點。", 400, "ai_wear_missing_result_image");

  const initialPointCost = shouldDeductPoints ? 0 : Math.max(0, Math.floor(Number(body.pointCost || body.point_cost || 0) || 0));
  const initialStatus = shouldDeductPoints ? "pending_point_deduction" : stringValue(body.status || "completed").slice(0, 40);
  const pointChannelKey = shouldDeductPoints ? settings.pointChannelKey : stringValue(body.pointChannelKey || body.point_channel_key);
  const pointType = shouldDeductPoints ? settings.pointType : normalizePointType(body.pointType || body.point_type || "gift_money");

  await env.DB.prepare(`INSERT INTO ai_wear_results (id, line_user_id, display_name, model_id, model_title, person_image_url, result_image_url, result_mime_type, result_base64, prompt, point_cost, point_channel_key, point_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    lineUserId,
    displayName,
    modelId,
    stringValue(model && model.title || body.modelTitle || body.model_title).slice(0, 120),
    stringValue(body.personImageUrl || body.person_image_url).slice(0, 500),
    resultUrl,
    resultMimeType,
    "",
    stringValue(body.prompt).slice(0, 4000),
    initialPointCost,
    pointChannelKey,
    pointType,
    initialStatus,
    now,
  ).run();

  let deductedPointCost = 0;
  if (shouldDeductPoints) {
    await applyWetwPointMutation(env, {
      channelKey: settings.pointChannelKey,
      lineUserId,
      pointType: settings.pointType,
      pointDelta: -configuredPointCost,
      action: "ai_wear_generate",
      source: "ai-wear",
      sourceEventId: `ai-wear:${lineUserId}:${id}`,
      businessKey: `ai-wear:${lineUserId}:${id}`,
      operatorId: `ai-wear:${lineUserId}`,
      operatorName: "AI穿戴",
      note: `AI穿戴生成扣點 ${configuredPointCost} 點`,
    }, {
      event_name: "AI穿戴扣點",
      event_content: `AI穿戴生成扣點 ${configuredPointCost} 點`,
      shop_remark: `AI穿戴生成扣點；model=${modelId}；result=${id}`,
    });
    deductedPointCost = configuredPointCost;
    await env.DB.prepare("UPDATE ai_wear_results SET point_cost = ?, point_channel_key = ?, point_type = ?, status = ? WHERE id = ?").bind(
      deductedPointCost,
      settings.pointChannelKey,
      settings.pointType,
      "completed",
      id,
    ).run();
  }

  return { id, createdAt: now, resultUrl, deductedPointCost };
}

async function listAiWearResults(env, searchParams) {
  await ensureAiWearSchema(env);
  const limit = clampNumber(searchParams && searchParams.get("limit") || 50, 1, 200);
  const rows = await env.DB.prepare("SELECT id, line_user_id, display_name, model_id, model_title, person_image_url, result_image_url, result_mime_type, CASE WHEN result_base64 != '' THEN 1 ELSE 0 END AS has_result_blob, point_cost, point_channel_key, point_type, status, created_at FROM ai_wear_results ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return { items: (rows.results || []).map((row) => ({ id: stringValue(row.id), lineUserId: stringValue(row.line_user_id), displayName: stringValue(row.display_name), modelId: stringValue(row.model_id), modelTitle: stringValue(row.model_title), personImageUrl: stringValue(row.person_image_url), resultImageUrl: row.has_result_blob ? `${publicBaseUrl(env)}${AI_WEAR_RESULT_ASSET_PREFIX}${encodeURIComponent(stringValue(row.id))}` : stringValue(row.result_image_url), pointCost: numberOrZero(row.point_cost), pointChannelKey: stringValue(row.point_channel_key), pointType: stringValue(row.point_type), status: stringValue(row.status), createdAt: numberOrZero(row.created_at) })) };
}

async function serveAiWearResultImage(env, pathname, corsHeaders) {
  await ensureAiWearSchema(env);
  const id = aiWearAssetIdFromPath(pathname, AI_WEAR_RESULT_ASSET_PREFIX);
  if (!id) return new Response("Invalid image id", { status: 400, headers: corsHeaders });
  const row = await env.DB.prepare("SELECT result_mime_type, result_base64, result_image_url, created_at FROM ai_wear_results WHERE id = ?").bind(id).first();
  if (!row) return new Response("Image not found", { status: 404, headers: corsHeaders });
  const mimeType = stringValue(row.result_mime_type || "image/jpeg");
  if (row.result_base64) {
    return new Response(base64ToUint8Array(row.result_base64), { status: 200, headers: { ...corsHeaders, "Content-Type": mimeType, "Cache-Control": "public, max-age=31536000, immutable", "ETag": `"${id}-${row.created_at || 0}"` } });
  }
  const bucket = env.AI_WEAR_BUCKET;
  if (!bucket || typeof bucket.get !== "function") return new Response("AI wear R2 bucket is not configured", { status: 500, headers: corsHeaders });
  const object = await bucket.get(aiWearResultObjectKey(id, mimeType));
  if (!object) return new Response("Image not found", { status: 404, headers: corsHeaders });
  return new Response(object.body, { status: 200, headers: { ...corsHeaders, "Content-Type": stringValue(object.httpMetadata && object.httpMetadata.contentType) || mimeType, "Cache-Control": "public, max-age=31536000, immutable", "ETag": `"${id}-${row.created_at || 0}"` } });
}

async function getCheckinTemplate(env) {
  await ensureAppMetaSchema(env);
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(CHECKIN_TEMPLATE_META_KEY).first();
  if (!row || !row.value) return normalizeCheckinTemplate(DEFAULT_CHECKIN_TEMPLATE);
  try {
    return normalizeCheckinTemplate(JSON.parse(row.value));
  } catch (_err) {
    return normalizeCheckinTemplate(DEFAULT_CHECKIN_TEMPLATE);
  }
}

async function saveCheckinTemplate(env, input) {
  await ensureAppMetaSchema(env);
  const data = normalizeCheckinTemplate(input);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(CHECKIN_TEMPLATE_META_KEY, JSON.stringify(data), now).run();
  return data;
}

function normalizeCheckinTemplate(input) {
  const source = input && typeof input === "object" ? input : {};
  const keywords = Array.isArray(source.keywords)
    ? source.keywords
    : stringValue(source.keyword || source.trigger || "簽到贈點活動").split(/[\n,，]/);
  const pages = Array.isArray(source.pages) ? source.pages : [];
  const normalizedPages = pages.map(normalizeCheckinTemplatePage).filter((page) => page.imageUrl).slice(0, 12);
  return {
    active: source.active !== false,
    keywords: uniqueSuggestions(keywords.map((item) => stringValue(item).trim()).filter(Boolean)).slice(0, 12),
    altText: stringValue(source.altText || source.alt_text || "簽到贈點活動").slice(0, 400),
    pages: normalizedPages.length ? normalizedPages : DEFAULT_CHECKIN_TEMPLATE.pages.map(normalizeCheckinTemplatePage),
  };
}

function normalizeCheckinTemplatePage(page) {
  const raw = page && typeof page === "object" ? page : {};
  const buttons = Array.isArray(raw.buttons) ? raw.buttons : [];
  return {
    imageUrl: stringValue(raw.imageUrl || raw.image_url || raw.url).trim(),
    imageLink: stringValue(raw.imageLink || raw.image_link || raw.link || raw.actionUri).trim(),
    bubbleSize: normalizeFlexBubbleSize(raw.bubbleSize || raw.bubble_size || raw.imageSize || raw.image_size || raw.size),
    imageAspectRatio: normalizeFlexAspectRatio(raw.imageAspectRatio || raw.image_aspect_ratio || raw.aspectRatio || raw.aspect_ratio),
    imageAspectMode: normalizeFlexAspectMode(raw.imageAspectMode || raw.image_aspect_mode || raw.aspectMode || raw.aspect_mode),
    buttons: buttons.map(normalizeCheckinTemplateButton).filter((button) => button.label).slice(0, 4),
  };
}

function normalizeCheckinTemplateButton(button) {
  const raw = button && typeof button === "object" ? button : {};
  const type = stringValue(raw.type || raw.actionType || "message").toLowerCase() === "uri" ? "uri" : "message";
  return {
    label: stringValue(raw.label || "按鈕").slice(0, 40),
    type,
    text: stringValue(raw.text || raw.message || (type === "message" ? "\u6703\u54e1\u6253\u5361" : "")).slice(0, 300),
    uri: stringValue(raw.uri || raw.url || "").trim(),
    color: normalizeHexColor(raw.color),
  };
}

function normalizeFlexBubbleSize(value) {
  const size = stringValue(value || "nano").trim().toLowerCase();
  return ["nano", "micro", "deca", "hecto", "kilo", "mega", "giga"].includes(size) ? size : "nano";
}

function normalizeFlexAspectRatio(value) {
  const ratio = stringValue(value || "400:600").trim().replace(/[：]/g, ":");
  return /^\d{1,4}:\d{1,4}$/.test(ratio) ? ratio : "400:600";
}

function normalizeFlexAspectMode(value) {
  const mode = stringValue(value || "cover").trim().toLowerCase();
  return ["cover", "fit"].includes(mode) ? mode : "cover";
}
function normalizeHexColor(value) {
  const text = stringValue(value).trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : "";
}

function isCheckinTemplateTrigger(template, text) {
  if (!template || template.active === false) return false;
  const normalizedText = normalizeTextKeyword(text);
  return (template.keywords || []).some((keyword) => normalizeTextKeyword(keyword) === normalizedText);
}

async function replyCheckinTemplateForPayload(env, floor, provider, payload) {
  let count = 0;
  for (const event of payload && payload.events || []) {
    if (!event || event.type !== "message" || !event.message || event.message.type !== "text") continue;
    const userId = event.source && event.source.userId ? event.source.userId : "";
    const text = stringValue(event.message.text);
    if (!userId || !text) continue;
    if (await maybeReplyCheckinTemplate(env, floor, provider, event, userId, text)) count += 1;
  }
  return count;
}
async function maybeReplyCheckinTemplate(env, floor, provider, event, userId, text) {
  if (floor !== FLOOR_MAIN && floor !== FLOOR_SMART) return false;
  const template = await getCheckinTemplate(env);
  if (!isCheckinTemplateTrigger(template, text)) return false;
  const flex = buildCheckinTemplateFlex(template);
  const delivery = await replyOrPushLineMessages(provider, event.replyToken, userId, [flex]);
  if (delivery && delivery.ok) {
    await saveAdminMessage(env, {
      floor,
      userId,
      text: lineMessagesDisplayText([flex]),
      messageType: "flex",
      lineMessages: [flex],
      rawJson: { direction: "outgoing", source: "checkin-template", lineMessages: [flex], delivery: { status: delivery.status } },
      createdAt: Date.now(),
      status: STATUS_DONE,
      category: "LINE Flex"
    });
  }
  return true;
}

function buildCheckinTemplateFlex(template) {
  const data = normalizeCheckinTemplate(template);
  return {
    type: "flex",
    altText: data.altText || "簽到贈點活動",
    contents: {
      type: "carousel",
      contents: data.pages.map(buildCheckinTemplateBubble),
    },
  };
}

function buildCheckinTemplateBubble(page) {
  const image = {
    type: "image",
    url: page.imageUrl,
    size: "full",
    aspectMode: normalizeFlexAspectMode(page.imageAspectMode),
    aspectRatio: normalizeFlexAspectRatio(page.imageAspectRatio),
    gravity: "top",
  };
  if (page.imageLink) image.action = { type: "uri", uri: page.imageLink };
  const bubble = {
    type: "bubble",
    size: normalizeFlexBubbleSize(page.bubbleSize),
    body: {
      type: "box",
      layout: "vertical",
      contents: [image],
      paddingAll: "0px",
    },
  };
  if (page.buttons && page.buttons.length) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: page.buttons.map(buildCheckinTemplateButton),
    };
  }
  return bubble;
}

function buildCheckinTemplateButton(button) {
  const action = button.type === "uri"
    ? { type: "uri", label: button.label, uri: button.uri || "https://liff.line.me/2007221311-c9SEkcRL" }
    : { type: "message", label: button.label, text: button.text || button.label };
  const item = { type: "button", action, height: "sm", style: "primary" };
  if (button.color) item.color = button.color;
  return item;
}
async function pushLineMessages(provider, userId, messages) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.accessToken}` },
    body: JSON.stringify({ to: userId, messages }),
  });
  const detail = await response.text();
  return { ok: response.ok, status: response.status, detail };
}

async function replyLineMessages(provider, replyToken, messages) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  if (!replyToken) return { ok: false, status: 400, detail: "reply token is empty" };
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.accessToken}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  const detail = await response.text();
  return { ok: response.ok, status: response.status, detail };
}

async function replyOrPushLineMessages(provider, replyToken, userId, messages) {
  const reply = await replyLineMessages(provider, replyToken, messages);
  if (reply.ok || !userId) return reply;
  return pushLineMessages(provider, userId, messages);
}

async function pushLineMessage(provider, userId, text) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.accessToken}` },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });
  const detail = await response.text();
  return { ok: response.ok, status: response.status, detail };
}

async function replyLineMessage(provider, replyToken, text) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  if (!replyToken) return { ok: false, status: 400, detail: "reply token is empty" };
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.accessToken}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  const detail = await response.text();
  return { ok: response.ok, status: response.status, detail };
}

async function replyOrPushLineMessage(provider, replyToken, userId, text) {
  const reply = await replyLineMessage(provider, replyToken, text);
  if (reply.ok || !userId) return reply;
  return pushLineMessage(provider, userId, text);
}

async function attachLineProfiles(payload, provider) {
  if (!provider.accessToken || !Array.isArray(payload.events)) return;
  const cache = new Map();
  await Promise.all(payload.events.map(async (event) => {
    const userId = event && event.source && event.source.userId;
    if (!userId) return;
    const cacheKey = `${event.source.type || "user"}:${event.source.groupId || event.source.roomId || ""}:${userId}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, fetchLineProfile(provider, userId, event.source));
    const profile = await cache.get(cacheKey);
    if (profile) event.userProfile = profile;
  }));
}

async function fetchLineProfile(provider, userId, source = {}) {
  const result = await fetchLineProfileWithDetail(provider, userId, source);
  return result.ok ? result.data : null;
}

async function fetchLineBotInfo(provider) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  try {
    const response = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${provider.accessToken}` },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_err) { data = text; }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, detail: err && err.message ? err.message : String(err) };
  }
}

async function fetchLineProfileWithDetail(provider, userId, source = {}) {
  if (!provider.accessToken) return { ok: false, status: 500, detail: "LINE channel access token is not configured" };
  const endpoints = [];
  if (source && source.type === "group" && source.groupId) endpoints.push({ kind: "groupMember", url: `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}` });
  if (source && source.type === "room" && source.roomId) endpoints.push({ kind: "roomMember", url: `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(userId)}` });
  endpoints.push({ kind: "userProfile", url: `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}` });

  const attempts = [];
  try {
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint.url, { headers: { Authorization: `Bearer ${provider.accessToken}` } });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
      attempts.push({ kind: endpoint.kind, status: response.status, detail: response.ok ? "" : text });
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          source: endpoint.kind,
          attempts,
          data: {
            displayName: data && data.displayName ? data.displayName : "",
            pictureUrl: data && data.pictureUrl ? data.pictureUrl : "",
            statusMessage: data && data.statusMessage ? data.statusMessage : "",
          },
        };
      }
    }
    const last = attempts[attempts.length - 1] || {};
    return { ok: false, status: last.status || 0, detail: last.detail || "LINE profile unavailable", attempts };
  } catch (err) {
    return { ok: false, status: 0, error: err && err.message ? err.message : String(err), attempts };
  }
}

async function callGas(env, payload) {
  if (!env.GAS_URL) throw new Error("GAS_URL is not configured");
  const response = await fetch(env.GAS_URL, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...payload, secret: env.GAS_SHARED_SECRET || "" }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = { status: "error", message: text }; }
  if (!response.ok || data.status === "error") throw new Error(data.message || `GAS request failed with HTTP ${response.status}`);
  return data;
}

async function backupGas(env, payload) {
  if (!env.GAS_URL) return null;
  try { return await callGas(env, payload); } catch (_err) { return null; }
}

function withThreadData(payload) {
  const data = payload && payload.data ? payload.data : {};
  return { ...(payload || {}), data: { ...data, threads: buildThreadsFromGas(data.chats || [], data.chatMeta || []) } };
}

function buildThreadsFromGas(chats, chatMeta) {
  const metaByUser = new Map();
  for (const row of chatMeta || []) {
    const userId = stringValue(row["\u7528\u6236ID"] || row.userId);
    if (userId) metaByUser.set(userId, row);
  }
  const groups = new Map();
  for (const row of (chats || []).slice().sort((a, b) => numberValue(a["\u6642\u9593"]) - numberValue(b["\u6642\u9593"]))) {
    const userId = stringValue(row["\u7528\u6236ID"] || row.userId || "unknown");
    if (!groups.has(userId)) groups.set(userId, []);
    groups.get(userId).push(row);
  }
  return Array.from(groups.entries()).map(([userId, messages]) => {
    const meta = metaByUser.get(userId) || {};
    const last = messages[messages.length - 1] || {};
    const name = chooseStableName(userId, meta["\u7528\u6236\u540d\u7a31"], last["\u7528\u6236\u540d\u7a31"]) || PENDING_DISPLAY_NAME;
    return {
      id: `user:${userId}`,
      userId,
      name,
      displayName: name,
      pictureUrl: stringValue(meta["\u982d\u50cfURL"] || last["\u982d\u50cfURL"]),
      summary: stringValue(last["\u5167\u5bb9"]),
      status: normalizeStatusForDisplay(meta["\u8655\u7406\u72c0\u614b"] || last["\u72c0\u614b"] || STATUS_PENDING),
      risk: messages.some((row) => row["\u91cd\u8981"] === "\u662f") ? "high" : "low",
      tags: normalizeTags(meta["\u6a19\u7c64"]),
      note: stringValue(meta["\u5099\u8a3b"]),
      lastMessageAt: numberValue(last["\u6642\u9593"]),
      hasRealName: !isPlaceholderName(name, userId),
      messages: messages.map((row, index) => ({
        id: `${userId}:${numberValue(row["\u6642\u9593"]) || index}`,
        type: "text",
        senderRole: row["\u8eab\u4efd"] === "admin" ? ADMIN_ROLE : USER_ROLE,
        senderId: userId,
        senderName: row["\u8eab\u4efd"] === "admin" ? "\u7ba1\u7406\u54e1" : name,
        text: stringValue(row["\u5167\u5bb9"]),
        createdAt: numberValue(row["\u6642\u9593"]),
        category: stringValue(row["\u985e\u5225"]),
        suggestions: parseJsonArray(row["AI\u5efa\u8b70"]),
        important: row["\u91cd\u8981"] === "\u662f",
        raw: row,
      })),
    };
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function threadToMetaRow(thread) {
  return {
    "\u7528\u6236ID": thread.userId,
    "\u7528\u6236\u540d\u7a31": thread.name,
    "\u8655\u7406\u72c0\u614b": thread.status,
    "\u6a19\u7c64": thread.tags.join(","),
    "\u5099\u8a3b": thread.note,
    "\u982d\u50cfURL": thread.pictureUrl,
  };
}

function metaToGasPayload(meta) {
  return {
    userId: meta.userId,
    userName: meta.userName,
    pictureUrl: meta.pictureUrl,
    status: meta.status,
    tags: meta.tags,
    note: meta.note,
  };
}

function normalizeStatusForDisplay(status) {
  const value = stringValue(status);
  if (!value || value === "pending") return STATUS_PENDING;
  if (value === "important") return STATUS_IMPORTANT;
  if (value === "done") return STATUS_DONE;
  return value;
}

function sourceFromD1(row) {
  if (row.source_type === "group" && row.source_id) return { type: "group", groupId: row.source_id };
  if (row.source_type === "room" && row.source_id) return { type: "room", roomId: row.source_id };
  return { type: "user" };
}

function chooseStableName(userId, incomingName, currentName) {
  const incoming = stringValue(incomingName);
  const current = stringValue(currentName);
  if (incoming && !isPlaceholderName(incoming, userId)) return incoming;
  if (current && !isPlaceholderName(current, userId)) return current;
  return "";
}

function isPlaceholderName(value, userId) {
  const text = stringValue(value);
  return !text || text === stringValue(userId) || /^U[a-z0-9]{8,}$/i.test(text) || /^user\s*[a-z0-9]{4,}$/i.test(text) || /^用戶\s*[a-z0-9]{4,}$/i.test(text);
}

function isImportantText(text) {
  return /客訴|投訴|負評|生氣|不滿|退貨|退款|詐騙|檢舉|違法|糾紛|爛|差評|抱怨|主管|媒體|消保|警察|法院/i.test(text);
}

function tokenize(text) {
  const raw = stringValue(text);
  const base = raw.split(/[\s,，。！？!?、/\\\-_:：;；()[\]{}「」『』【】《》〈〉.．]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
  const normalized = raw.replace(/[\s,，。！？!?、/\\\-_:：;；()[\]{}「」『』【】《》〈〉.．]+/g, "").trim();
  const grams = [];
  if (/[^\x00-\x7F]/.test(normalized)) {
    for (let size = Math.min(4, normalized.length); size >= 2; size -= 1) {
      for (let i = 0; i <= normalized.length - size; i += 1) grams.push(normalized.slice(i, i + size));
    }
  }
  return Array.from(new Set([...base, ...grams])).filter((item) => item.length >= 2).slice(0, 60);
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  return stringValue(value).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(stringValue).filter(Boolean) : [];
  } catch (_err) {
    return normalizeTags(value);
  }
}

function stringValue(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function numberValue(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatPoint(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function taipeiStartOfDay(now) {
  const offset = 8 * 60 * 60 * 1000;
  return Math.floor((Number(now) + offset) / 86400000) * 86400000 - offset;
}

async function countIfTableExists(env, tableName, whereClause, bindings = []) {
  const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(tableName).first();
  if (!table) return 0;
  const sql = `SELECT COUNT(*) AS count FROM ${tableName}${whereClause ? ` WHERE ${whereClause}` : ""}`;
  const row = await env.DB.prepare(sql).bind(...bindings).first();
  return numberOrZero(row && row.count);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(number, max));
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigin = env.ALLOWED_ORIGIN || "";
  const origin = allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Line-Id-Token, X-Operator-Id, X-Operator-Name, X-User-Id, X-Admin-User, X-Admin-Name",
    "Access-Control-Max-Age": "86400",
    ...JSON_HEADERS,
  };
}

function verifyPasswordLogin(body) {
  const username = stringValue(body && (body.username || body.account || body.user)).trim();
  const password = stringValue(body && body.password);
  const user = PASSWORD_LOGIN_USERS[username];
  if (!user || password !== user.password) return { ok: false, message: "帳號或密碼錯誤" };
  const floors = Array.isArray(user.floors) ? user.floors.slice() : [];
  const access = { allowed: true, admin: Boolean(user.admin), floors };
  return {
    ok: true,
    access,
    home: user.home || "/console",
    profile: {
      userId: `password:${username}`,
      displayName: user.name || username,
      pictureUrl: "",
    },
  };
}

function passwordLoginHtml(corsHeaders) {
  return new Response(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KLINK 客服系統登入</title>
  <style>
    :root{--line:#06c755;--ink:#0f172a;--muted:#64748b;--border:#d8e0eb;--bad:#b42318}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:var(--ink);font-family:"Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
    main{width:min(430px,100%);background:#fff;border:1px solid var(--border);border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.12);padding:28px}
    .brand{display:flex;align-items:center;gap:14px;margin-bottom:22px}.logo{width:52px;height:52px;border-radius:16px;background:var(--line);color:#fff;display:grid;place-items:center;font-weight:900;font-size:20px}h1{font-size:24px;margin:0}p{margin:5px 0 0;color:var(--muted);line-height:1.5}.field{display:grid;gap:7px;margin-top:14px;font-weight:800}.field input{height:46px;border:1px solid var(--border);border-radius:12px;padding:0 12px;font:inherit}.field input:focus{outline:0;border-color:var(--line);box-shadow:0 0 0 3px rgba(6,199,85,.14)}button{width:100%;height:48px;margin-top:18px;border:0;border-radius:12px;background:var(--line);color:#fff;font-weight:900;font-size:16px;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}.msg{min-height:20px;margin-top:12px;color:var(--bad);font-weight:800}.links{display:flex;justify-content:space-between;gap:10px;margin-top:16px}.links a{color:#2563eb;text-decoration:none;font-weight:800;font-size:13px}
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="logo">KL</div><div><h1>KLINK 客服系統</h1><p>請輸入帳號密碼登入</p></div></div>
    <form id="form">
      <label class="field">帳號<input id="username" name="username" autocomplete="username" required /></label>
      <label class="field">密碼<input id="password" name="password" type="password" autocomplete="current-password" required /></label>
      <button id="submit" type="submit">登入</button>
      <div id="message" class="msg"></div>
    </form>
    <div class="links"><a href="/console">主控台</a><a href="/dashboard?floor=main">產品客服</a><a href="/dashboard?floor=admin">行政客服</a></div>
  </main>
  <script>
    const form = document.getElementById("form");
    const button = document.getElementById("submit");
    const message = document.getElementById("message");
    function nextPath(home){
      const params = new URLSearchParams(location.search);
      const next = params.get("next") || home || "/console";
      if (!next.startsWith("/") || next.startsWith("//")) return home || "/console";
      return next;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      button.disabled = true;
      try {
        const response = await fetch("/api/auth/password-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== "success") throw new Error(data.message || "登入失敗");
        location.replace(nextPath(data.home));
      } catch (error) {
        message.textContent = error.message || String(error);
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}
async function assertDashboardAuth(request, env) {
  const tokens = [env.DASHBOARD_API_TOKEN, env.ADMIN_TOKEN].map((value) => String(value || "").trim()).filter(Boolean);
  const auth = String(request.headers.get("Authorization") || "").trim();
  const directToken = String(request.headers.get("X-Dashboard-Token") || request.headers.get("X-Admin-Token") || "").trim();
  const bearerToken = auth.replace(/^Bearer\s+/i, "").trim();
  if (tokens.includes(bearerToken) || tokens.includes(directToken)) {
    return { ok: true, token: bearerToken || directToken, adminToken: isAdminRequest(request, env), method: "token" };
  }
  const session = await verifyConsoleSession(request, env);
  if (session.ok) return { ok: true, method: "session", ...session.profile };
  const line = await verifyLineLoginRequest(request, env);
  if (line.ok) return { ok: true, method: "line", ...line.profile };
  if (!tokens.length && !dashboardLiffId(env)) throw httpError("DASHBOARD_API_TOKEN, ADMIN_TOKEN or DASHBOARD_LIFF_ID is not configured", 500);
  throw httpError(line.message || "Unauthorized dashboard request", 401);
}

async function assertPointAdminAuth(request, env) {
  return assertDashboardAuth(request, env);
}
async function assertPointStatsAdminAuth(request, env) {
  const auth = await assertDashboardAuth(request, env);
  if (auth.adminToken || auth.admin) return auth;
  throw httpError("只有系統管理員可查看點數統計", 403);
}

async function dashboardPageDeniedResponse(request, env, loginUrl, corsHeaders) {
  try {
    await assertDashboardAuth(request, env);
    return null;
  } catch (error) {
    const status = error && error.status ? Number(error.status) : 500;
    if (status === 401) return Response.redirect(loginUrl, 302);
    throw error;
  }
}
async function pointStatsPageDeniedResponse(request, env, origin, corsHeaders) {
  try {
    await assertPointStatsAdminAuth(request, env);
    return null;
  } catch (error) {
    const status = error && error.status ? Number(error.status) : 500;
    if (status === 401) return Response.redirect(`${origin}/login?next=/admin/points/stats`, 302);
    if (status === 403) return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>權限不足</title><style>body{margin:0;font-family:Arial,"Noto Sans TC",sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh}.box{background:#fff;border:1px solid #d8e0eb;border-radius:16px;padding:28px;max-width:520px}h1{margin:0 0 12px;font-size:26px}p{color:#64748b;line-height:1.7}a{display:inline-block;margin-top:12px;color:#057a38;font-weight:800}</style></head><body><div class="box"><h1>權限不足</h1><p>點數統計包含全站每日進出資料，請使用系統管理員帳號登入。</p><a href="/login?next=/admin/points/stats">重新登入</a></div></body></html>`, { status: 403, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    throw error;
  }
}
async function assertAccessManager(request, env) {
  const auth = await assertDashboardAuth(request, env);
  if (auth.adminToken || auth.admin) return auth;
  if (!env.DB) throw httpError("DB is not configured", 500);
  await ensureFloorAccessSchema(env);
  const operator = requestOperatorIdentity(request, auth);
  if (isBuiltinAdminOperator(operator)) return auth;
  const adminAllowed = await findFloorAccessEntry(env, FLOOR_SUPER_ADMIN, operator);
  if (!adminAllowed) throw httpError("只有 admin 可以管理權限", 403);
  return auth;
}

function dashboardLiffId(env) {
  return stringValue(env.DASHBOARD_LIFF_ID || env.LINE_DASHBOARD_LIFF_ID || "").trim();
}

function dashboardLineClientId(env) {
  const configured = stringValue(env.DASHBOARD_LINE_LOGIN_CHANNEL_ID || env.LINE_LOGIN_CHANNEL_ID || "").trim();
  if (configured) return configured;
  const liffId = dashboardLiffId(env);
  const match = liffId.match(/^(\d+)-/);
  return match ? match[1] : "";
}

async function verifyLineLoginRequest(request, env) {
  const idToken = stringValue(request.headers.get("X-Line-Id-Token")).trim();
  if (!idToken) return { ok: false, message: "LINE Login is required" };
  return verifyLineLoginIdToken(env, idToken);
}

async function buildConsoleSessionCookie(env, profile, access = null) {
  const maxAge = 7 * 24 * 60 * 60;
  const payload = {
    uid: stringValue(profile && profile.userId).trim(),
    name: stringValue(profile && profile.displayName).trim(),
    picture: stringValue(profile && profile.pictureUrl).trim(),
    admin: Boolean(access && access.admin),
    floors: Array.isArray(access && access.floors) ? access.floors.filter((floor) => ACCESS_LIST_IDS.has(floor)) : [],
    exp: Math.floor(Date.now() / 1000) + maxAge,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await signConsoleSession(env, encodedPayload);
  return `kl_console_session=${encodedPayload}.${signature}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function verifyConsoleSession(request, env) {
  const value = readCookie(request, "kl_console_session");
  if (!value || !value.includes(".")) return { ok: false, message: "Console session is required" };
  const parts = value.split(".");
  if (parts.length !== 2) return { ok: false, message: "Console session format is invalid" };
  const expected = await signConsoleSession(env, parts[0]);
  if (!constantTimeEqual(expected, parts[1])) return { ok: false, message: "Console session signature is invalid" };
  let payload = null;
  try { payload = JSON.parse(base64UrlDecode(parts[0])); } catch (_err) { payload = null; }
  if (!payload || !payload.uid) return { ok: false, message: "Console session payload is invalid" };
  if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return { ok: false, message: "Console session expired" };
  return {
    ok: true,
    profile: {
      userId: stringValue(payload.uid),
      displayName: stringValue(payload.name),
      pictureUrl: stringValue(payload.picture),
      admin: Boolean(payload.admin),
      floors: Array.isArray(payload.floors) ? payload.floors.filter((floor) => ACCESS_LIST_IDS.has(floor)) : [],
    },
  };
}

async function signConsoleSession(env, encodedPayload) {
  const secret = stringValue(env.ADMIN_TOKEN || env.DASHBOARD_API_TOKEN || env.OPENAI_API_KEY || "klink-console-session").trim();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function readCookie(request, name) {
  const cookie = stringValue(request.headers.get("Cookie"));
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyLineLoginIdToken(env, idToken) {
  const token = stringValue(idToken).trim();
  const clientId = dashboardLineClientId(env);
  if (!token) return { ok: false, message: "LINE idToken is required" };
  if (!clientId) return { ok: false, message: "DASHBOARD_LIFF_ID or DASHBOARD_LINE_LOGIN_CHANNEL_ID is not configured" };
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token, client_id: clientId }).toString(),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
    if (!response.ok || !data || !data.sub) {
      return { ok: false, status: response.status, message: data && (data.error_description || data.error) || text || "LINE idToken verify failed" };
    }
    return {
      ok: true,
      profile: {
        userId: data.sub,
        displayName: data.name || "",
        pictureUrl: data.picture || "",
        email: data.email || "",
      },
    };
  } catch (err) {
    return { ok: false, status: 0, message: err && err.message ? err.message : String(err) };
  }
}

async function resolveLineDashboardAccess(env, profile) {
  if (isBuiltinAdminProfile(profile)) return { allowed: true, admin: true, floors: [FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART] };
  if (!profile || !profile.userId || !env.DB) return { allowed: false, admin: false, floors: [] };
  await ensureFloorAccessSchema(env);
  const operator = { ids: [profile.userId], names: [profile.displayName].filter(Boolean), label: profile.userId };
  const adminAllowed = await findFloorAccessEntry(env, FLOOR_SUPER_ADMIN, operator);
  const floors = [];
  for (const floor of [FLOOR_MAIN, FLOOR_ADMIN, FLOOR_SMART]) {
    const allowed = adminAllowed || await findFloorAccessEntry(env, floor, operator);
    if (allowed) floors.push(floor);
  }
  return { allowed: Boolean(adminAllowed || floors.length), admin: Boolean(adminAllowed), floors };
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.code = arguments.length >= 3 ? arguments[2] : "";
  return err;
}

async function safeJson(request) {
  try { return await request.json(); } catch (_err) { throw new Error("Invalid JSON body"); }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, ...JSON_HEADERS } });
}

async function verifyLineSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return constantTimeEqual(expected, signature);
}

async function verifyGatewaySignature(rawBody, signature, token) {
  if (!rawBody || !signature || !token) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
