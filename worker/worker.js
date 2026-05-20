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
const FLOOR_IDS = new Set([FLOOR_MAIN, FLOOR_ADMIN]);
const POINT_OA1 = "oa1";
const POINT_OA2 = "oa2";
const POINT_CHANNELS = new Set([POINT_OA1, POINT_OA2]);
const POINT_CHANNEL_FLOORS = { [POINT_OA1]: FLOOR_MAIN, [POINT_OA2]: FLOOR_ADMIN };
const D1_IN_QUERY_BATCH_SIZE = 50;
const POINT_SOURCE_META = {
  [POINT_OA1]: { label: "康立智能", shopId: 1086, loginUrl: "https://k-link.cc/index.php/line_login/1086/", canGrant: true },
  [POINT_OA2]: { label: "康立全球", shopId: 1584, loginUrl: "https://k-link.cc/index.php/line_login/1584/", canGrant: false, deductPriority: true },
};
const DEFAULT_WETW_POINT_INSERT_URL = "https://k-link.cc/index.php/wp-json/wetw-point/v1/insert-user-point";
const DEFAULT_WETW_POINT_QUERY_URL = "https://k-link.cc/index.php/wp-json/wetw-point/v1/query-user-point-list";
const REWARD_LIFF_ID = "2007221311-WjM9sZPz";
const REWARD_NFC_LIFF_ID = "2007221311-sqXIHCoK";
const POINTS_LIFF_ID = "2007221311-c9SEkcRL";
const DEFAULT_REWARD_POINTS = 1;
const REWARD_CAMPAIGN_POINTS = {
  smart_202605: 1,
  smart_202605_5: 5,
};
const REWARD_CALENDAR_AUTO = "calendar_auto";
const NFC_TEST_CAMPAIGN_PREFIX = "nfc_test_";
const DEFAULT_PUBLIC_BASE_URL = "https://mlm.fangwl591021.workers.dev";
const DEFAULT_REWARD_CALENDAR_ID = "e60890fdb27ca97452f32e6484c312ed029faef62a6ddd4fbbe753fa557bcde5@group.calendar.google.com";
const DEFAULT_REWARD_GEOFENCE_METERS = 300;
const DEFAULT_REWARD_CALENDAR_POINTS = 5;
const DEFAULT_REWARD_CHECKIN_EARLY_MINUTES = 90;

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
            ALLOWED_ORIGIN: Boolean(env.ALLOWED_ORIGIN),
          },
        }, 200, corsHeaders);
      }

      if (url.pathname === "/r/nfc" && (request.method === "GET" || request.method === "HEAD")) {
        if (url.searchParams.has("liff.state") || url.searchParams.has("campaign")) {
          return rewardCompactNfcLiffHtml(env, corsHeaders);
        }
        return redirectToRewardLiff(env, "calendar_auto", "nfc");
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

      if (url.pathname === "/api/console/summary" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const data = await fetchConsoleSummary(env);
        return jsonResponse({ status: "success", data }, 200, corsHeaders);
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
        assertDashboardAuth(request, env);
        const data = await fetchDashboardData(env, floor);
        if (env.DB && provider.accessToken) {
          ctx.waitUntil(backfillProfiles(env, floor, provider, 12, { force: false, staleMs: 6 * 60 * 60 * 1000 }));
        }
        return jsonResponse(data, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm" && request.method === "GET") {
        return crmAdminToolHtml(corsHeaders);
      }

      if (url.pathname === "/admin/crm/members" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const data = await listCrmMembers(env, url);
        return jsonResponse({ success: true, status: "success", data }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm/sync-members" && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const result = await syncCrmMembers(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/crm/sync-points" && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const result = await syncCrmPoints(env, body);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/binding-codes" && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const result = await createBindingCode(request, env);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/observations" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const observations = await listPointObservations(env, url);
        return jsonResponse({ success: true, status: "success", observations }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/member-links" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const links = await listPointMemberLinks(env, url);
        return jsonResponse({ success: true, status: "success", links }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/balance" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const result = await listPointBalances(env, url);
        const balances = Array.isArray(result) ? result : result.balances;
        const resolved = Array.isArray(result) ? null : result.resolved;
        return jsonResponse({ success: true, status: "success", balances, resolved }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/ledger" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const ledger = await listPointLedger(env, url);
        return jsonResponse({ success: true, status: "success", ledger }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/backfill-auto-rewards" && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const queryBody = Object.fromEntries(url.searchParams.entries());
        const result = await backfillMissingAutoRewards(env, { ...queryBody, ...body });
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/repair-daily-keyword-balances" && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const queryBody = Object.fromEntries(url.searchParams.entries());
        const result = await repairDailyKeywordBalances(env, { ...queryBody, ...body });
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
      }

      if ((url.pathname === "/admin/points/grant" || url.pathname === "/admin/points/deduct" || url.pathname === "/admin/points/redeem") && request.method === "POST") {
        assertPointAdminAuth(request, env);
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
        assertDashboardAuth(request, env);
        if (!env.DB) return jsonResponse({ status: "error", message: "DB is not configured" }, 500, corsHeaders);
        const result = await migrateGasToD1(env, floor);
        return jsonResponse(result, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/threads" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const data = await fetchDashboardData(env, floor);
        return jsonResponse({ success: true, status: "success", data: data.data.threads || [] }, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/thread" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const id = stringValue(url.searchParams.get("id"));
        if (!id) return jsonResponse({ success: false, status: "error", message: "id is required" }, 400, corsHeaders);
        const thread = await fetchThread(env, floor, id);
        if (!thread) return jsonResponse({ success: false, status: "error", message: "thread not found" }, 404, corsHeaders);
        return jsonResponse({ success: true, status: "success", data: thread }, 200, corsHeaders);
      }

      if (url.pathname === "/api/line-oa/thread" && request.method === "POST") {
        assertDashboardAuth(request, env);
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
        assertDashboardAuth(request, env);
        const userId = stringValue(url.searchParams.get("userId") || url.searchParams.get("uid"));
        if (!userId) return jsonResponse({ status: "error", message: "userId is required" }, 400, corsHeaders);
        const stored = await getProfile(env, floor, userId);
        const direct = await fetchLineProfileWithDetail(provider, userId);
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
        assertDashboardAuth(request, env);
        const channelKey = stringValue(url.searchParams.get("channel") || url.searchParams.get("channel_key"));
        const pointConfig = POINT_CHANNELS.has(channelKey) ? getPointChannelConfig(env, channelKey) : null;
        const botProvider = pointConfig
          ? { floor: pointConfig.floor, id: channelKey, label: pointConfig.label, channelSecret: pointConfig.channelSecret, accessToken: pointConfig.accessToken }
          : provider;
        const info = await fetchLineBotInfo(botProvider);
        return jsonResponse({ status: info.ok ? "success" : "error", data: info }, info.ok ? 200 : 502, corsHeaders);
      }

      if (url.pathname === "/api/backfill-profiles" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const limit = clampNumber(body.limit || 100, 1, 300);
        const results = await backfillProfiles(env, floor, provider, limit, { force: true });
        return jsonResponse({ status: "success", scanned: results.length, results }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        if (!body.knowledge) return jsonResponse({ status: "error", message: "knowledge is required" }, 400, corsHeaders);
        const result = await importKnowledge(env, floor, body.knowledge, stringValue(body.fileName || "dashboard-upload.json"));
        ctx.waitUntil(backupGas(env, {
          type: "IMPORT_KNOWLEDGE_BASE",
          data: { knowledge: body.knowledge, fileName: body.fileName || "dashboard-upload.json", source: "dashboard-upload" },
        }));
        return jsonResponse(result, 200, corsHeaders);
      }

      if (url.pathname === "/api/conversation-meta" && request.method === "POST") {
        assertDashboardAuth(request, env);
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
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId);
        const text = stringValue(body.text);
        if (!userId || !text) return jsonResponse({ status: "error", message: "userId and text are required" }, 400, corsHeaders);

        const lineResult = await pushLineMessage(provider, userId, text);
        if (!lineResult.ok) {
          return jsonResponse({ status: "error", message: "LINE push failed", detail: lineResult.detail }, lineResult.status || 502, corsHeaders);
        }

        const now = Date.now();
        await saveAdminMessage(env, { floor, userId, text, createdAt: now, status: STATUS_DONE });
        ctx.waitUntil(backupGas(env, {
          type: "SAVE_ADMIN_REPLY",
          data: { userId, userName: stringValue(body.userName), text, time: now, category: "\u4eba\u5de5\u56de\u8986", status: STATUS_DONE },
        }));
        return jsonResponse({ status: "success" }, 200, corsHeaders);
      }

      if (url.pathname === "/api/log-reply" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = stringValue(body.userId);
        const text = stringValue(body.text);
        if (!userId || !text) return jsonResponse({ status: "error", message: "userId and text are required" }, 400, corsHeaders);

        const now = Date.now();
        await saveAdminMessage(env, { floor, userId, text, createdAt: now, status: STATUS_DONE, category: "\u88dc\u8a18\u4e0d\u63a8\u9001" });
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
        routes: ["/health", "/api/console/summary", "/api/data?floor=main", "/api/data?floor=admin", "/admin/crm", "/admin/crm/members", "/admin/crm/sync-members", "/admin/crm/sync-points", "/admin/points/balance", "/admin/points/ledger", "/admin/points/backfill-auto-rewards", "/admin/points/repair-daily-keyword-balances", "/admin/points/grant", "/admin/points/deduct", "/admin/points/redeem", "/internal/line-webhook/oa1", "/internal/line-webhook/oa2", "/line-webhook/oa1", "/line-webhook/oa2", "/api/migrate-gas-to-d1", "/api/line-oa/threads", "/api/line-oa/thread", "/api/profile-debug", "/api/backfill-profiles", "/api/knowledge", "/api/conversation-meta", "/api/send", "/api/log-reply", "/webhook/line/main", "/webhook/line/admin"],
      }, 200, corsHeaders);
    } catch (err) {
      const payload = { status: "error", message: err && err.message ? err.message : String(err) };
      if (err && err.code) payload.code = err.code;
      return jsonResponse(payload, err.status || 500, corsHeaders);
    }
  },
};

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
      label: "\u884c\u653f\u5ba2\u670d",
      channelSecret: env.LINE_ADMIN_CHANNEL_SECRET || "",
      accessToken: env.LINE_ADMIN_CHANNEL_ACCESS_TOKEN || "",
    };
  }
  return {
    floor: FLOOR_MAIN,
    id: FLOOR_MAIN,
    label: "\u7522\u54c1\u5ba2\u670d",
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
  const floorNames = { [FLOOR_MAIN]: "\u7522\u54c1\u5ba2\u670d", [FLOOR_ADMIN]: "\u884c\u653f\u5ba2\u670d" };
  const floors = [];

  for (const floor of [FLOOR_MAIN, FLOOR_ADMIN]) {
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

  const [calendarCount, upcomingEvents, registrations, checkins, crmMembers, pointAccounts, pointLedgerToday] = await Promise.all([
    countIfTableExists(env, "calendar_events", "starts_at >= ? AND starts_at < ?", [todayStart, todayStart + 86400000]),
    countIfTableExists(env, "events", "status != 'archived' AND (starts_at IS NULL OR starts_at >= ?)", [todayStart]),
    countIfTableExists(env, "event_registrations", "registered_at >= ?", [todayStart]),
    countIfTableExists(env, "event_checkins", "checked_in_at >= ?", [todayStart]),
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
    calendar: { today: calendarCount },
    events: { upcoming: upcomingEvents, registrationsToday: registrations, checkinsToday: checkins },
    pointCrm: { members: crmMembers, pointAccounts, ledgerToday: pointLedgerToday },
  };
}

function getPointChannelConfig(env, channelKey) {
  let channelConfig = {};
  try {
    channelConfig = JSON.parse(env.CHANNEL_CONFIG_JSON || "{}")[channelKey] || {};
  } catch (_err) {
    channelConfig = {};
  }

  const floor = FLOOR_IDS.has(channelConfig.floor) ? channelConfig.floor : POINT_CHANNEL_FLOORS[channelKey] || FLOOR_MAIN;
  const provider = getProvider(env, floor);
  return {
    channelKey,
    floor,
    label: stringValue(channelConfig.label || (channelKey === POINT_OA2 ? "OA2 行政客服" : "OA1 產品客服")),
    channelSecret: stringValue(pointChannelEnv(env, channelKey, "SECRET") || channelConfig.channelSecret || provider.channelSecret),
    accessToken: stringValue(pointChannelEnv(env, channelKey, "ACCESS_TOKEN") || channelConfig.channelAccessToken || provider.accessToken),
    forwardUrl: stringValue(channelConfig.forwardUrl),
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
  ctx.waitUntil(processPointWebhook(env, channelKey, config, payload, rawBody, signature).catch((error) => {
    console.error("processPointWebhook failed", error && error.stack ? error.stack : error);
  }));

  return jsonResponse({
    success: true,
    status: "success",
    channel_key: channelKey,
    floor: config.floor,
    queued_events: Array.isArray(payload.events) ? payload.events.length : 0,
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
    await recordPointEvent(env, channelKey, event);
    await tryApplyBindingCode(env, channelKey, event.source && event.source.userId, event.message && event.message.text);
    const userId = event.source && event.source.userId ? event.source.userId : "";
    if (userId && await handleNfcTestConversation(env, channelKey, provider, event, userId)) {
      // consumed by the ad hoc NFC testing setup flow
    } else if (isSmartDailyRewardEvent(channelKey, event)) {
      if (userId) await handleSmartRewardBalanceDisplay(env, provider, event, userId);
    } else if (isSmartPointQueryEvent(channelKey, event)) {
      if (userId) await handlePointQueryKeyword(env, provider, event, userId);
    } else {
      monitorEvents.push(event);
    }
  }

  if (monitorEvents.length) await processLineWebhook(env, config.floor, provider, { ...payload, events: monitorEvents });
}

function isSmartDailyRewardEvent(channelKey, event) {
  return channelKey === POINT_OA1
    && event
    && event.type === "message"
    && event.message
    && event.message.type === "text"
    && normalizeTextKeyword(event.message.text) === normalizeTextKeyword("簽到贈K點");
}

function isSmartPointQueryEvent(channelKey, event) {
  if (channelKey !== POINT_OA1 || !event || event.type !== "message" || !event.message || event.message.type !== "text") return false;
  const text = normalizeTextKeyword(event.message.text);
  return ["k點查詢", "K點查詢", "點數查詢", "查詢k點", "查詢K點", "查詢點數"].map(normalizeTextKeyword).includes(text);
}

async function handleNfcTestConversation(env, channelKey, provider, event, userId) {
  if (channelKey !== POINT_OA1 || !env.DB || !event || event.type !== "message" || !event.message || event.message.type !== "text") return false;
  const text = stringValue(event.message.text).trim();
  if (!text) return false;
  await ensureNfcTestTables(env);

  if (normalizeTextKeyword(text) === normalizeTextKeyword("簽到測試")) {
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO nfc_test_flows (token, channel_key, user_id, stage, address, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(token, channelKey, userId, "address", "", calendarDefaultPoints(env), now, now).run();
    await replyOrPushLineMessage(provider, event.replyToken, userId, "請輸入地址");
    return true;
  }

  const flow = await latestOpenNfcTestFlow(env, channelKey, userId);
  if (!flow) return false;
  const now = Date.now();
  if (flow.stage === "address") {
    await env.DB.prepare(`
      UPDATE nfc_test_flows
      SET stage = ?, address = ?, updated_at = ?
      WHERE token = ?
    `).bind("time", text.slice(0, 300), now, flow.token).run();
    await replyOrPushLineMessage(provider, event.replyToken, userId, "請輸入簽到時間\n例：今天 18:00-21:00\n也可輸入：明天 13:00-16:00、2026-05-20 18:00-21:00");
    return true;
  }

  if (flow.stage === "time") {
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
    const liffUrl = buildRewardLiffUrl(env, campaign, "nfc");
    const backupUrl = `${publicBaseUrl(env)}/r/nfc-test?token=${encodeURIComponent(flow.token)}`;
    await replyOrPushLineMessage(provider, event.replyToken, userId, [
      "NFC 測試網址已建立：",
      liffUrl,
      "",
      `地址：${flow.address}`,
      `時間：${formatNfcTestTimeRange(parsed.startsAt, parsed.endsAt)}`,
      `點數：${calendarDefaultPoints(env)}點`,
      "",
      "請把上方 LIFF 網址寫入 NFC Tag。",
      `備用短網址：${backupUrl}`,
    ].join("\n"));
    return true;
  }

  return false;
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
      points INTEGER NOT NULL DEFAULT 5,
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

async function processPointWebhook(env, channelKey, config, payload, rawBody, signature) {
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
    await recordPointEvent(env, channelKey, event);
    await tryApplyBindingCode(env, channelKey, event.source && event.source.userId, event.message && event.message.text);
    const userId = event.source && event.source.userId ? event.source.userId : "";
    if (userId && await handleNfcTestConversation(env, channelKey, provider, event, userId)) {
      continue;
    }
    if (isSmartDailyRewardEvent(channelKey, event)) {
      if (userId) await handleSmartRewardBalanceDisplay(env, provider, event, userId);
      continue;
    }
    if (isSmartPointQueryEvent(channelKey, event)) {
      if (userId) await handlePointQueryKeyword(env, provider, event, userId);
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

  if (monitorEvents.length) await processLineWebhook(env, config.floor, provider, { ...payload, events: monitorEvents });

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

async function pointMutation(env, body, action) {
  const channelKey = stringValue(body.channel_key || body.channelKey);
  const lineUserId = stringValue(body.line_user_id || body.lineUserId || body.userId);
  const points = Math.abs(Number(body.points || body.point_delta || body.pointDelta));
  if (!channelKey || !lineUserId || !points) throw httpError("channel_key, line_user_id, and points are required", 400);
  if (!POINT_CHANNELS.has(channelKey)) throw httpError("Unsupported point source", 400);
  const sourceMeta = pointSourceMeta(channelKey);
  if (action === "grant" && sourceMeta && sourceMeta.canGrant === false) {
    throw httpError(`${sourceMeta.label} 來源只允許扣K點，不允許贈K點`, 400);
  }
  const operatorId = stringValue(body.operator_id || body.operatorId || body.admin_id || body.adminId);
  const operatorName = stringValue(body.operator_name || body.operatorName || body.operator || body.admin_name || body.adminName) || operatorId;
  if (!operatorId) throw httpError("請填寫操作人UID", 400);
  const delta = action === "grant" ? points : -points;
  const input = {
    channelKey,
    lineUserId,
    pointType: stringValue(body.point_type || body.pointType) || "gift_money",
    pointDelta: delta,
    action,
    source: "admin",
    businessKey: stringValue(body.business_key || body.businessKey),
    note: stringValue(body.note),
    operatorId,
    operatorName,
  };
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
      ? `${entryLabel}；Google日曆活動：${calendarContext.event.summary}；地點：${calendarContext.event.location}；距離：${Math.round(calendarContext.distanceMeters)}m`
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

function redirectToRewardLiff(env, campaign, entry) {
  return Response.redirect(buildRewardLiffUrl(env, campaign, entry), 302);
}

function buildRewardLiffUrl(env, campaign, entry) {
  const normalizedEntry = normalizeRewardEntry(entry || "qr");
  const liffId = normalizedEntry === "nfc"
    ? (stringValue(env.REWARD_NFC_LIFF_ID) || REWARD_NFC_LIFF_ID)
    : (stringValue(env.REWARD_LIFF_ID) || REWARD_LIFF_ID);
  const target = new URL(`https://liff.line.me/${encodeURIComponent(liffId)}`);
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
      <div class="brand"><div class="mark">KL</div><div><h1>康立智能 NFC 感應贈K點</h1><p>把短網址寫入 NFC Tag。會員手機感應後會開啟 LINE LIFF，系統依 Google 日曆活動時間、地點與手機定位自動判定是否發放 K點。</p></div></div>
      <div class="urlBox"><strong>NFC Tag 建議寫入網址</strong><code>${escapeHtml(nfcUrl)}</code></div>
      <a class="button" href="${escapeHtml(nfcUrl)}">測試 NFC 入口</a>
      <p class="muted">實際會轉到 LIFF：<br>${escapeHtml(liffUrl)}</p>
    </section>
    <section class="grid">
      <div class="card"><h2>NFC 寫入流程</h2><ol><li>手機安裝 NFC Tools 或同類型 NFC 寫入工具。</li><li>選擇 Write / Add a record / URL。</li><li>貼上上方短網址。</li><li>靠近 NFC Tag 寫入。</li><li>用另一支手機感應測試。</li></ol></div>
      <div class="card"><h2>發點判定流程</h2><ol><li>會員感應 NFC。</li><li>LINE LIFF 驗證會員 UID。</li><li>系統讀取 Google 日曆目前進行中的活動。</li><li>手機定位在活動地點範圍內才發放 K點。</li><li>同一活動同一會員只可領取一次。</li></ol></div>
      <div class="card warn"><h2>備用固定 5 K點入口</h2><p>如果某場活動暫時不使用日曆定位，可寫入固定活動入口。</p><code>${escapeHtml(fixedUrl)}</code></div>
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
  <title>NFC 贈K點</title>
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
  </main>
  <script>
    const API_BASE = "https://mlm.fangwl591021.workers.dev";
    const LIFF_ID = ${JSON.stringify(liffId)};
    const CLOSE_DELAY_MS = 2400;
    const params = mergedParams();
    const campaign = params.get("campaign") || "calendar_auto";
    const entry = params.get("entry") || "nfc";
    const appEl = document.getElementById("app");
    const titleEl = document.getElementById("title");
    const messageEl = document.getElementById("message");
    const loadingIconEl = document.getElementById("loadingIcon");
    const successIconEl = document.getElementById("successIcon");
    const plainIconEl = document.getElementById("plainIcon");
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
      await logStage("before_geolocation", "");
      const position = await getCurrentPosition();
      await logStage("geolocation_ok", "accuracy=" + position.coords.accuracy);
      const response = await fetch(API_BASE + "/api/reward/claim", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ campaign, entry, idToken, lat:position.coords.latitude, lng:position.coords.longitude, accuracy:position.coords.accuracy })
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || data.status !== "success"){
        await logStage("claim_failed", data.message || response.status);
        showClosed();
        return;
      }
      await logStage("claim_success", data.duplicate ? "duplicate" : "claimed", data.line_user_id);
      showSuccess(data.duplicate);
    }
    function showLoading(){
      appEl.classList.remove("error");
      loadingIconEl.classList.remove("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.add("hidden");
      titleEl.textContent = "請稍後，系統處理中"; messageEl.textContent = "正在確認課程時間";
    }
    function showSuccess(duplicate){
      appEl.classList.remove("error");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.remove("hidden"); plainIconEl.classList.add("hidden");
      titleEl.textContent = duplicate ? "已領取過本課程紅包" : "紅包已送出"; messageEl.textContent = duplicate ? "本課程已完成領取" : "已發送 5 K點"; closeSoon();
    }
    function showClosed(){
      appEl.classList.add("error");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.remove("hidden");
      titleEl.textContent = "目前非課程時間，請查看行事曆"; messageEl.textContent = ""; closeSoon();
    }
    function showOutsideLine(){
      appEl.classList.add("error");
      loadingIconEl.classList.add("hidden"); successIconEl.classList.add("hidden"); plainIconEl.classList.remove("hidden");
      titleEl.textContent = "請使用 LINE 開啟"; messageEl.textContent = "NFC 請寫入 LIFF 網址，不要寫入一般網頁短網址";
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
        <thead><tr><th>點數統計</th><th>活動名稱</th><th>日期時間</th><th>活動內容</th><th>消費店家</th></tr></thead>
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
          "<td class='amount " + amountClass + "'>" + esc(formatPoint(item.amount)) + "</td>" +
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
    function isExpiredTokenError(error){
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
    datetime: formatTaipeiDateTime(row.created_at || row.createdAt || row.date || row.datetime),
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

async function resolveCalendarRewardContext(env, body) {
  const userLat = Number(body.lat || body.latitude);
  const userLng = Number(body.lng || body.longitude);
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    throw httpError("請允許定位，系統才能確認是否在活動地點", 400);
  }
  const now = Date.now();
  const earlyMs = rewardCheckinEarlyMinutes(env) * 60 * 1000;
  const events = (await fetchRewardCalendarEvents(env)).filter((event) => event.startsAt - earlyMs <= now && event.endsAt >= now);
  if (!events.length) throw httpError("目前非課程時間，請查看行事曆", 400);

  const radius = rewardGeofenceMeters(env);
  const checked = [];
  for (const event of events) {
    const geo = await geocodeRewardLocation(env, event.location);
    if (!geo) {
      checked.push({ event, distanceMeters: Number.POSITIVE_INFINITY, geo: null });
      continue;
    }
    const distanceMeters = haversineMeters(userLat, userLng, geo.lat, geo.lng);
    checked.push({ event, distanceMeters, geo });
  }
  checked.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const best = checked[0];
  if (!best || !Number.isFinite(best.distanceMeters)) {
    throw httpError("目前活動沒有可判定的地址，請確認 Google 日曆地點欄位", 400);
  }
  if (best.distanceMeters > radius) {
    throw httpError(`您目前距離活動地點約 ${Math.round(best.distanceMeters)} 公尺，超過允許範圍 ${radius} 公尺`, 403);
  }
  const points = rewardPointsFromEvent(env, best.event);
  return {
    campaign: `calendar_${shortHash(best.event.uid || `${best.event.summary}:${best.event.startsAt}`)}`,
    event: best.event,
    points,
    userLat,
    userLng,
    userAccuracy: Number(body.accuracy || 0) || null,
    distanceMeters: best.distanceMeters,
    eventLat: best.geo.lat,
    eventLng: best.geo.lng,
  };
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
  if (!startsAt || !endsAt || startsAt > now || endsAt < now) {
    throw httpError("目前非測試簽到時間", 400);
  }
  const geo = await geocodeRewardLocation(env, flow.address);
  if (!geo) throw httpError("測試地址無法定位，請重新建立測試網址", 400);
  const distanceMeters = haversineMeters(userLat, userLng, geo.lat, geo.lng);
  const radius = rewardGeofenceMeters(env);
  if (distanceMeters > radius) {
    throw httpError(`您目前距離測試地點約 ${Math.round(distanceMeters)} 公尺，超過允許範圍 ${radius} 公尺`, 403);
  }
  const points = Number(flow.points || calendarDefaultPoints(env));
  return {
    campaign,
    event: {
      uid: `nfc-test:${token}`,
      summary: "NFC測試簽到",
      description: `測試贈點 ${points} K點`,
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
  const calendarId = stringValue(env.REWARD_GOOGLE_CALENDAR_ID) || DEFAULT_REWARD_CALENDAR_ID;
  const icsUrl = stringValue(env.REWARD_GOOGLE_CALENDAR_ICS_URL)
    || `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  const response = await fetch(icsUrl, {
    headers: { "Accept": "text/calendar,text/plain,*/*" },
  });
  if (!response.ok) throw httpError(`Google 日曆讀取失敗：${response.status}`, 502);
  const text = await response.text();
  return parseIcsEvents(text)
    .filter((event) => event.startsAt && event.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt);
}

function parseIcsEvents(text) {
  const lines = unfoldIcsLines(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const startsAt = current.DTSTART ? parseIcsDate(current.DTSTART.value, current.DTSTART.params) : 0;
        const endsAt = current.DTEND ? parseIcsDate(current.DTEND.value, current.DTEND.params) : startsAt + 2 * 60 * 60 * 1000;
        events.push({
          uid: unescapeIcs(current.UID && current.UID.value),
          summary: unescapeIcs(current.SUMMARY && current.SUMMARY.value) || "未命名活動",
          description: unescapeIcs(current.DESCRIPTION && current.DESCRIPTION.value),
          location: unescapeIcs(current.LOCATION && current.LOCATION.value),
          startsAt,
          endsAt,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseIcsProperty(line);
    if (parsed && !current[parsed.name]) current[parsed.name] = parsed;
  }
  return events;
}

function unfoldIcsLines(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line) {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsProperty(line) {
  const index = line.indexOf(":");
  if (index < 0) return null;
  const left = line.slice(0, index);
  const value = line.slice(index + 1);
  const parts = left.split(";");
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name, params, value };
}

function parseIcsDate(value, params = {}) {
  const text = stringValue(value);
  if (/^\d{8}$/.test(text)) {
    return Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8))) - 8 * 60 * 60 * 1000;
  }
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return Date.parse(text) || 0;
  const [, y, mo, d, h, mi, s, z] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (z === "Z") return utc;
  const tz = stringValue(params.TZID);
  return utc - (tz.includes("Taipei") || !tz ? 8 * 60 * 60 * 1000 : 0);
}

function unescapeIcs(value) {
  return stringValue(value)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

async function geocodeRewardLocation(env, location) {
  const text = stringValue(location);
  if (!text) return null;
  const direct = parseLatLng(text);
  if (direct) return direct;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "KLINK-reward-geofence/1.0",
    },
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => []);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
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

function publicCalendarEvent(event, now = Date.now(), context = null, env = {}) {
  const earlyMs = rewardCheckinEarlyMinutes(env) * 60 * 1000;
  return {
    uid: event.uid,
    title: event.summary,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    active: event.startsAt - earlyMs <= now && event.endsAt >= now,
    points: context && Number(context.points) > 0 ? Number(context.points) : rewardPointsFromEvent(env, event),
    distanceMeters: context && Number.isFinite(context.distanceMeters) ? Math.round(context.distanceMeters) : null,
  };
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
  const sorted = rows
    .filter((row) => !stringValue(row.point_type) || stringValue(row.point_type) === pointType)
    .sort((a, b) => wetwPointRowRank(b) - wetwPointRowRank(a));
  const effectiveRows = sorted.length ? sorted : rows;
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
  const masterMemberRef = link && link.master_member_ref ? link.master_member_ref : null;

  const existing = await env.DB.prepare("SELECT balance FROM point_accounts WHERE account_key = ?").bind(accountKey).first();
  const explicitBalanceAfter = Number(input.balanceAfter ?? input.balance_after);
  const balanceAfter = Number.isFinite(explicitBalanceAfter)
    ? explicitBalanceAfter
    : Number(existing && existing.balance || 0) + Number(input.pointDelta || 0);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(account_key) DO UPDATE SET
        master_member_ref = excluded.master_member_ref,
        balance = excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `).bind(accountKey, masterMemberRef, input.channelKey, input.lineUserId, pointType, balanceAfter),
    env.DB.prepare(`
      INSERT INTO point_ledger (account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, source_event_id, business_key, operator_id, operator_name, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(accountKey, masterMemberRef, input.channelKey, input.lineUserId, input.action, pointType, Number(input.pointDelta || 0), balanceAfter, input.source, input.sourceEventId || null, businessKey, input.operatorId || "", input.operatorName || "", input.note || null),
  ]);

  return { account_key: accountKey, master_member_ref: masterMemberRef, balance_after: balanceAfter };
}

async function listPointBalances(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  const userName = stringValue(url.searchParams.get("user_name") || url.searchParams.get("userName") || url.searchParams.get("name"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);

  if (channelKey && lineUserId) {
    return { balances: [await livePointBalanceRow(env, channelKey, lineUserId, "gift_money")] };
  }
  if (lineUserId) {
    const exactBalances = await livePointBalancesForUser(env, lineUserId);
    if (exactBalances.length) return { balances: exactBalances, resolved: { chat_line_user_id: lineUserId, point_line_user_id: lineUserId, source: "exact_wetw" } };
    const resolved = await resolvePointIdentity(env, { chatLineUserId: lineUserId, userName });
    if (resolved && resolved.pointLineUserId) {
      const resolvedRows = await livePointBalancesForUser(env, resolved.pointLineUserId);
      return {
        balances: resolvedRows.map((row) => ({
          ...row,
          chat_line_user_id: lineUserId,
          resolved_from_name: resolved.name,
          resolved_member_ref: resolved.memberRef,
        })),
        resolved: {
          chat_line_user_id: lineUserId,
          point_line_user_id: resolved.pointLineUserId,
          member_ref: resolved.memberRef,
          name: resolved.name,
          source: resolved.source,
        },
      };
    }
    return { balances: [], resolved: { chat_line_user_id: lineUserId, point_line_user_id: "", source: "not_found" } };
  }
  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
      FROM point_accounts
      WHERE master_member_ref = ?
      ORDER BY channel_key, point_type
      LIMIT ?
    `).bind(masterMemberRef, limit).all();
    return decoratePointBalances(rows.results || []);
  }
  if (channelKey) {
    const rows = await env.DB.prepare(`
      SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
      FROM point_accounts
      WHERE channel_key = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(channelKey, limit).all();
    return decoratePointBalances(rows.results || []);
  }
  const rows = await env.DB.prepare(`
    SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
    FROM point_accounts
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(limit).all();
  return decoratePointBalances(rows.results || []);
}

async function livePointBalancesForUser(env, lineUserId) {
  const balances = [];
  for (const channelKey of [POINT_OA1, POINT_OA2]) {
    try {
      balances.push(await livePointBalanceRow(env, channelKey, lineUserId, "gift_money"));
    } catch (_err) {
      // A LINE uid may not exist in every source. Keep the other source usable.
    }
  }
  return balances;
}

async function livePointBalanceRow(env, channelKey, lineUserId, pointType) {
  const snapshot = await fetchWetwPointSnapshot(env, channelKey, lineUserId, pointType, 20);
  return decoratePointBalances([{
    account_key: `${channelKey}:${lineUserId}:${pointType}`,
    master_member_ref: "",
    channel_key: channelKey,
    line_user_id: lineUserId,
    point_type: pointType,
    balance: snapshot.balance,
    updated_at: "mother-site-live",
    query_shop_id: snapshot.shop_id,
    live_rows: Array.isArray(snapshot.rows) ? snapshot.rows.length : 0,
  }])[0];
}

function pointSourceMeta(channelKey) {
  return POINT_SOURCE_META[channelKey] || null;
}

async function resolvePointIdentity(env, input) {
  const chatLineUserId = stringValue(input.chatLineUserId);
  const userName = stringValue(input.userName).trim();
  if (!env.DB) return null;

  if (chatLineUserId) {
    const linked = await env.DB.prepare(`
      SELECT master_member_ref, line_user_id
      FROM member_line_links
      WHERE line_user_id = ?
      LIMIT 1
    `).bind(chatLineUserId).first();
    if (linked && linked.master_member_ref) {
      const member = await env.DB.prepare(`
        SELECT member_ref, name, source_json
        FROM crm_members
        WHERE member_ref = ?
        LIMIT 1
      `).bind(linked.master_member_ref).first();
      const pointLineUserId = crmLineUserId(member) || await pointLineUserIdForMember(env, linked.master_member_ref);
      if (pointLineUserId) return { pointLineUserId, memberRef: linked.master_member_ref, name: member && member.name ? member.name : "", source: "member_link" };
    }
  }

  if (!userName) return null;
  const like = `%${userName}%`;
  const rows = await env.DB.prepare(`
    SELECT member_ref, name, source_json
    FROM crm_members
    WHERE name LIKE ? OR source_json LIKE ?
    ORDER BY
      CASE
        WHEN name = ? THEN 0
        WHEN name LIKE ? THEN 1
        ELSE 2
      END,
      updated_at DESC
    LIMIT 10
  `).bind(like, like, userName, like).all();
  for (const member of rows.results || []) {
    const pointLineUserId = crmLineUserId(member);
    if (pointLineUserId && pointLineUserId !== chatLineUserId) {
      return { pointLineUserId, memberRef: member.member_ref, name: member.name, source: "crm_name" };
    }
  }
  return null;
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

async function pointLineUserIdForMember(env, memberRef) {
  const ref = stringValue(memberRef);
  if (!ref) return "";
  const row = await env.DB.prepare(`
    SELECT line_user_id
    FROM point_accounts
    WHERE master_member_ref = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(ref).first();
  return row ? stringValue(row.line_user_id) : "";
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
  const metaShopId = Number(POINT_SOURCE_META[channelKey] && POINT_SOURCE_META[channelKey].shopId);
  if (Number.isFinite(metaShopId) && metaShopId > 0) return metaShopId;
  return wetwShopId(env);
}

async function listPointLedger(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);

  if (channelKey && lineUserId) {
    const snapshot = await fetchWetwPointSnapshot(env, channelKey, lineUserId, "gift_money", limit);
    return snapshot.rows.map((row) => wetwPointLedgerRow(channelKey, lineUserId, row));
  }
  if (lineUserId) {
    const ledgers = [];
    for (const sourceKey of [POINT_OA1, POINT_OA2]) {
      try {
        const snapshot = await fetchWetwPointSnapshot(env, sourceKey, lineUserId, "gift_money", limit);
        ledgers.push(...snapshot.rows.map((row) => wetwPointLedgerRow(sourceKey, lineUserId, row)));
      } catch (_err) {
        // Some members only exist in one source.
      }
    }
    return ledgers.sort((a, b) => wetwPointRowRankFromLedger(b) - wetwPointRowRankFromLedger(a)).slice(0, limit);
  }
  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT id, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, operator_id, operator_name, note, created_at
      FROM point_ledger
      WHERE master_member_ref = ?
      ORDER BY id DESC
      LIMIT ?
    `).bind(masterMemberRef, limit).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT id, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, operator_id, operator_name, note, created_at
    FROM point_ledger
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
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
    where.push("(LOWER(member_ref) LIKE ? OR LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ?)");
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
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
  const members = Array.isArray(body.members) ? body.members : await fetchWetwArray(env, "members");
  let count = 0;
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
    count += 1;
  }
  await writeCrmSyncLog(env, "members", count, "success", body.members ? "body" : "wetw");
  return { count, source: body.members ? "body" : "wetw" };
}

async function syncCrmPoints(env, body) {
  const rows = await resolvePointSyncRows(env, body || {});
  let count = 0;
  const latestAccountRows = new Map();
  for (const item of rows) {
    const channelKey = stringValue(item.channel_key || item.channelKey || item.oa || body.channel_key || POINT_OA1);
    const lineUserId = stringValue(item.line_user_id || item.lineUserId || item.LINE_user_id || item.userId);
    const pointType = stringValue(item.point_type || item.pointType || "wetw_point");
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
  if (type === "members") return fetchWetwMembersFromWordPress(env, url);
  return fetchWetwPointListFromWordPress(env, url, options);
}

async function fetchWetwMembersFromWordPress(env, url) {
  if (!env.POINT_API_KEY) throw httpError("POINT_API_KEY is not configured", 400);
  const shopId = wetwShopId(env);

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
  if (Array.isArray(data.members)) return data.members;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return list;
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

async function fetchDashboardData(env, floor = FLOOR_MAIN) {
  if (!env.DB) return withThreadData(await callGas(env, { type: "FETCH_DASHBOARD_DATA" }));
  const [threads, aiLogs, knowledgeMeta] = await Promise.all([
    fetchThreads(env, floor, 120),
    fetchAiLogs(env, floor, 100),
    getKnowledgeMeta(env, floor),
  ]);
  if (floor === FLOOR_MAIN && !threads.length && env.GAS_URL) {
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

async function fetchThreads(env, floor = FLOOR_MAIN, limit = 120) {
  const { results } = await env.DB.prepare(`
    SELECT t.*, p.profile_status, p.profile_error, p.last_profile_sync
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id AND p.floor_id = t.floor_id
    WHERE t.floor_id = ?
    ORDER BY t.last_message_at DESC, t.updated_at DESC
    LIMIT ?
  `).bind(floor, limit).all();
  if (!results.length) return [];
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
  return results
    .map((row) => threadFromD1(row, byThread.get(row.id) || []))
    .filter((thread) => thread.messages.length > 0);
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
    SELECT t.*, p.profile_status, p.profile_error, p.last_profile_sync
    FROM threads t
    LEFT JOIN profiles p ON p.user_id = t.user_id AND p.floor_id = t.floor_id
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
  const name = stringValue(row.display_name) || row.user_id;
  return {
    id: row.id,
    floor: row.floor_id || FLOOR_MAIN,
    userId: row.user_id,
    name,
    displayName: name,
    pictureUrl: stringValue(row.picture_url),
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

function messageFromD1(thread, message) {
  const suggestions = parseJsonArray(message.suggestions);
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
  };
  return {
    id: message.id,
    type: message.message_type || "text",
    senderRole: message.sender_role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
    senderId: message.user_id,
    senderName: message.sender_role === ADMIN_ROLE ? "\u7ba1\u7406\u54e1" : (thread.display_name || message.user_id),
    text: message.text,
    createdAt: message.created_at,
    category: message.category,
    suggestions,
    important: Boolean(message.important),
    raw,
  };
}

async function processLineWebhook(env, floor, provider, payload) {
  await attachLineProfiles(payload, provider);
  for (const event of payload.events || []) {
    if (!event || event.type !== "message" || !event.message || event.message.type !== "text") continue;
    const userId = event.source && event.source.userId ? event.source.userId : "";
    const text = stringValue(event.message.text);
    if (!userId || !text) continue;
    await saveIncomingMessage(env, floor, provider, event, userId, text);
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
    replyText = result.duplicate
      ? `您今天已經簽到過，目前累積 ${formatPoint(balance)} K點。`
      : `簽到成功，已贈送 ${formatPoint(result.points)} K點。目前累積 ${formatPoint(balance)} K點。`;
  } catch (error) {
    result = { error: error && error.message ? error.message : String(error) };
    replyText = "簽到暫時失敗，請稍後再試。";
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
  const points = Number(rule.points || 0) || 5;
  const channelKey = stringValue(rule.channel_key) || POINT_OA1;
  const pointType = stringValue(rule.point_type) || "gift_money";
  const keyword = stringValue(rule.keyword);
  const existingSameDay = await env.DB.prepare(`
    SELECT id, keyword, points, balance_after, status
    FROM daily_keyword_rewards
    WHERE line_user_id = ? AND channel_key = ? AND point_type = ? AND reward_date = ? AND status != 'failed'
    ORDER BY id ASC
    LIMIT 1
  `).bind(userId, channelKey, pointType, rewardDate).first();
  if (existingSameDay) {
    const snapshot = await fetchWetwPointSnapshot(env, channelKey, userId, pointType, 10);
    return { duplicate: true, points: Number(existingSameDay.points || points), balance_after: snapshot.balance };
  }
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO daily_keyword_rewards (rule_id, keyword, line_user_id, channel_key, point_type, points, reward_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(rule.id, keyword, userId, channelKey, pointType, points, rewardDate).run();
  const inserted = Boolean(insert && insert.meta && insert.meta.changes);
  if (!inserted) {
    const existing = await env.DB.prepare(`
      SELECT points, balance_after, status
      FROM daily_keyword_rewards
      WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
    `).bind(rule.id, userId, rewardDate).first();
    if (existing && existing.status === "failed") {
      await env.DB.prepare(`
        UPDATE daily_keyword_rewards
        SET status = 'pending', message = '', updated_at = CURRENT_TIMESTAMP
        WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
      `).bind(rule.id, userId, rewardDate).run();
    } else {
      const snapshot = await fetchWetwPointSnapshot(env, channelKey, userId, pointType, 10);
      return { duplicate: true, points: Number(existing && existing.points || points), balance_after: snapshot.balance };
    }
  }

  try {
    const mutation = await pointMutation(env, {
      channel_key: channelKey,
      line_user_id: userId,
      point_type: pointType,
      points,
      operator_id: `keyword:${keyword}`,
      operator_name: "關鍵字自動贈K點",
      event_name: keyword,
      event_content: `每日簽到 ${rewardDate}`,
      note: `每日簽到 ${rewardDate}`,
      business_key: `keyword:${keyword}:${userId}:${rewardDate}`,
    }, "grant");
    await env.DB.prepare(`
      UPDATE daily_keyword_rewards
      SET status = 'success', point_ledger_id = ?, balance_after = ?, message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
    `).bind(mutation.ledger_id || null, mutation.balance_after || null, "claimed", rule.id, userId, rewardDate).run();
    return { duplicate: false, points, balance_after: mutation.balance_after };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE daily_keyword_rewards
      SET status = 'failed', message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE rule_id = ? AND line_user_id = ? AND reward_date = ?
    `).bind(error && error.message ? error.message : String(error), rule.id, userId, rewardDate).run();
    throw error;
  }
}

function normalizeTextKeyword(value) {
  return stringValue(value).replace(/\s+/g, "").toLowerCase();
}

async function saveIncomingMessage(env, floor, provider, event, userId, text) {
  const now = Number(event.timestamp || Date.now());
  const sourceType = stringValue(event.source && event.source.type) || "user";
  const sourceId = stringValue((event.source && (event.source.groupId || event.source.roomId)) || userId);
  const threadId = threadIdFor(floor, userId);
  const profile = await resolveProfile(env, floor, provider, userId, event.source || {}, event.userProfile || null);
  const analysis = await analyzeMessage(env, floor, text, userId, profile.displayName || userId);
  const status = analysis.isImportant ? STATUS_IMPORTANT : STATUS_PENDING;
  const risk = analysis.isImportant ? "high" : "low";
  const messageId = stringValue(event.message.id) || `${threadId}:${now}:${crypto.randomUUID()}`;

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

  const current = await env.DB.prepare("SELECT tags, note FROM threads WHERE id = ? AND floor_id = ?").bind(threadId, floor).first();
  await env.DB.prepare(`
    INSERT INTO threads (id, floor_id, user_id, source_type, source_id, display_name, picture_url, summary, status, risk, tags, note, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE threads.display_name END,
      picture_url = CASE WHEN excluded.picture_url != '' THEN excluded.picture_url ELSE threads.picture_url END,
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
    profile.displayName || "",
    profile.pictureUrl || "",
    text,
    status,
    risk,
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
    "text",
    text,
    analysis.category,
    JSON.stringify(analysis.suggestions || []),
    analysis.isImportant ? 1 : 0,
    analysis.sentiment || "neutral",
    JSON.stringify(event),
    now,
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
  const text = stringValue(input.text);
  const now = Number(input.createdAt || Date.now());
  const threadId = threadIdFor(floor, userId);
  const profile = await getProfile(env, floor, userId);
  const name = profile && profile.display_name ? profile.display_name : "";
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

  await env.DB.prepare(`
    INSERT INTO messages (id, floor_id, thread_id, user_id, sender_role, message_type, text, category, suggestions, important, sentiment, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(`admin:${threadId}:${now}:${crypto.randomUUID()}`, floor, threadId, userId, ADMIN_ROLE, "text", text, input.category || "\u4eba\u5de5\u56de\u8986", "[]", 0, "neutral", "{}", now).run();
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
    LEFT JOIN profiles p ON p.user_id = t.user_id AND p.floor_id = t.floor_id
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
  const important = isImportantText(text);
  const fallback = {
    isImportant: important,
    category: local.category || (important ? "\u91cd\u8981\u8a0a\u606f" : "\u4e00\u822c\u8a0a\u606f"),
    sentiment: important ? "negative" : "neutral",
    suggestions: local.suggestions.length ? local.suggestions : ["\u60a8\u597d\uff0c\u611f\u8b1d\u60a8\u7684\u7559\u8a00\u3002\u8acb\u554f\u60a8\u5177\u9ad4\u60f3\u4e86\u89e3\u54ea\u65b9\u9762\u7684\u8cc7\u8a0a\uff1f"],
    summary: local.summary || "local fallback",
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
  const { results } = await env.DB.prepare("SELECT category, question, answer FROM knowledge_items WHERE floor_id = ? OR floor_id = 'main' ORDER BY CASE WHEN floor_id = ? THEN 0 ELSE 1 END, id ASC LIMIT 1000").bind(floor || FLOOR_MAIN, floor || FLOOR_MAIN).all();
  const terms = tokenize(text);
  const matches = (results || []).map((item) => {
    const haystack = `${item.category} ${item.question} ${item.answer}`;
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) + (text.includes(item.question) ? 5 : 0);
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (!matches.length) return { matches: [], suggestions: [] };
  return {
    matches,
    category: matches[0].category,
    suggestions: matches.slice(0, 2).map((item) => `\u60a8\u597d\uff0c\u95dc\u65bc${item.category}\uff0c${item.answer}`),
    summary: "local knowledge match",
  };
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
  if (body.output_text) return body.output_text;
  for (const item of body.output || []) {
    for (const part of item.content || []) {
      if (part.text) return part.text;
    }
  }
  throw new Error("OpenAI returned empty content");
}

async function importKnowledge(env, floor, payload, fileName) {
  const normalized = normalizeKnowledgePayload(typeof payload === "string" ? JSON.parse(payload) : payload);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM knowledge_items WHERE floor_id = ?").bind(floor || FLOOR_MAIN).run();
  const statements = normalized.items.map((item) => env.DB.prepare("INSERT INTO knowledge_items (floor_id, category, question, answer, source, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(floor || FLOOR_MAIN, item.category, item.question, item.answer, fileName, now));
  if (statements.length) await env.DB.batch(statements);
  const meta = { title: normalized.title, version: normalized.version, source: fileName, count: normalized.items.length, updatedAt: new Date(now).toISOString() };
  await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(`knowledge_meta:${floor || FLOOR_MAIN}`, JSON.stringify(meta), now).run();
  return { status: "success", count: normalized.items.length, meta };
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
  const items = Array.isArray(payload) ? payload : (Array.isArray(source.items) ? source.items : []);
  return {
    title: stringValue(source.title || source.name),
    version: stringValue(source.version || source.updatedAt),
    items: items.map((item, index) => {
      const category = stringValue(item.category || item.categoryName || "\u4e00\u822c");
      const question = stringValue(item.question || item.q || item["\u554f\u984c"]);
      const answer = stringValue(item.answer || item.a || item["\u7b54\u6848"]);
      if (!question || !answer) throw new Error(`Invalid knowledge item at index ${index}: question and answer are required`);
      return { category, question, answer };
    }),
  };
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
    const name = chooseStableName(userId, meta["\u7528\u6236\u540d\u7a31"], last["\u7528\u6236\u540d\u7a31"]) || userId;
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
  return Array.from(new Set(stringValue(text).split(/[\s,，。！？!?、/\\\-_:：;；()[\]{}]+/).map((item) => item.trim()).filter((item) => item.length >= 2).slice(0, 20)));
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    ...JSON_HEADERS,
  };
}

function assertDashboardAuth(request, env) {
  if (!env.DASHBOARD_API_TOKEN) throw httpError("DASHBOARD_API_TOKEN is not configured", 500);
  const expectedToken = String(env.DASHBOARD_API_TOKEN || "").trim();
  const auth = String(request.headers.get("Authorization") || "").trim();
  const directToken = String(request.headers.get("X-Dashboard-Token") || "").trim();
  const bearerToken = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearerToken !== expectedToken && directToken !== expectedToken) throw httpError("Unauthorized dashboard request", 401);
}

function assertPointAdminAuth(request, env) {
  const tokens = [env.ADMIN_TOKEN, env.DASHBOARD_API_TOKEN].map((value) => String(value || "").trim()).filter(Boolean);
  if (!tokens.length) throw httpError("ADMIN_TOKEN or DASHBOARD_API_TOKEN is not configured", 500);
  const auth = String(request.headers.get("Authorization") || "").trim();
  const directToken = String(request.headers.get("X-Dashboard-Token") || request.headers.get("X-Admin-Token") || "").trim();
  const bearerToken = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tokens.includes(bearerToken) && !tokens.includes(directToken)) throw httpError("Unauthorized dashboard request", 401);
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
