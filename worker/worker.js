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
            DASHBOARD_API_TOKEN: Boolean(env.DASHBOARD_API_TOKEN),
            ADMIN_TOKEN: Boolean(env.ADMIN_TOKEN),
            CHANNEL_CONFIG_JSON: Boolean(env.CHANNEL_CONFIG_JSON),
            POINT_API_KEY: Boolean(env.POINT_API_KEY),
            WETW_MEMBERS_URL: Boolean(env.WETW_MEMBERS_URL),
            WETW_POINTS_URL: Boolean(env.WETW_POINTS_URL),
            WETW_SHOP_ID: Boolean(env.WETW_SHOP_ID),
            OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
            ALLOWED_ORIGIN: Boolean(env.ALLOWED_ORIGIN),
          },
        }, 200, corsHeaders);
      }

      const floor = resolveFloor(request);
      const provider = getProvider(env, floor);

      if (url.pathname === "/api/console/summary" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const data = await fetchConsoleSummary(env);
        return jsonResponse({ status: "success", data }, 200, corsHeaders);
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
        const balances = await listPointBalances(env, url);
        return jsonResponse({ success: true, status: "success", balances }, 200, corsHeaders);
      }

      if (url.pathname === "/admin/points/ledger" && request.method === "GET") {
        assertPointAdminAuth(request, env);
        const ledger = await listPointLedger(env, url);
        return jsonResponse({ success: true, status: "success", ledger }, 200, corsHeaders);
      }

      if ((url.pathname === "/admin/points/grant" || url.pathname === "/admin/points/deduct" || url.pathname === "/admin/points/redeem") && request.method === "POST") {
        assertPointAdminAuth(request, env);
        const action = url.pathname.endsWith("/grant") ? "grant" : url.pathname.endsWith("/deduct") ? "deduct" : "redeem";
        const body = await safeJson(request);
        const result = await pointMutation(env, body, action);
        return jsonResponse({ success: true, status: "success", ...result }, 200, corsHeaders);
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
        const info = await fetchLineBotInfo(provider);
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
        routes: ["/health", "/api/console/summary", "/api/data?floor=main", "/api/data?floor=admin", "/admin/crm", "/admin/crm/members", "/admin/crm/sync-members", "/admin/crm/sync-points", "/admin/points/balance", "/admin/points/ledger", "/admin/points/grant", "/admin/points/deduct", "/admin/points/redeem", "/line-webhook/oa1", "/line-webhook/oa2", "/api/migrate-gas-to-d1", "/api/line-oa/threads", "/api/line-oa/thread", "/api/profile-debug", "/api/backfill-profiles", "/api/knowledge", "/api/conversation-meta", "/api/send", "/api/log-reply", "/webhook/line/main", "/webhook/line/admin"],
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ status: "error", message: err && err.message ? err.message : String(err) }, err.status || 500, corsHeaders);
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
    channelSecret: stringValue(channelConfig.channelSecret || provider.channelSecret),
    accessToken: stringValue(channelConfig.channelAccessToken || provider.accessToken),
    forwardUrl: stringValue(channelConfig.forwardUrl),
  };
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

async function processPointWebhook(env, channelKey, config, payload, rawBody, signature) {
  await upsertPointChannel(env, config);
  let checkinEvents = 0;

  for (const event of payload.events || []) {
    await recordPointEvent(env, channelKey, event);
    await tryApplyBindingCode(env, channelKey, event.source && event.source.userId, event.message && event.message.text);
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
  }

  const provider = {
    floor: config.floor,
    id: config.floor,
    label: config.label,
    channelSecret: config.channelSecret,
    accessToken: config.accessToken,
  };
  await processLineWebhook(env, config.floor, provider, payload);

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
  const delta = action === "grant" ? points : -points;
  return applyPointMutation(env, {
    channelKey,
    lineUserId,
    pointType: stringValue(body.point_type || body.pointType) || "manual_point",
    pointDelta: delta,
    action,
    source: "admin",
    businessKey: stringValue(body.business_key || body.businessKey),
    note: stringValue(body.note),
  });
}

async function applyPointMutation(env, input) {
  const pointType = input.pointType || "system_point";
  const accountKey = `${input.channelKey}:${input.lineUserId}:${pointType}`;
  const businessKey = input.businessKey || `${input.source}:${input.action}:${crypto.randomUUID()}`;
  const link = await env.DB.prepare(`
    SELECT master_member_ref
    FROM member_line_links
    WHERE channel_key = ? AND line_user_id = ?
  `).bind(input.channelKey, input.lineUserId).first();
  const masterMemberRef = link && link.master_member_ref ? link.master_member_ref : null;

  const existing = await env.DB.prepare("SELECT balance FROM point_accounts WHERE account_key = ?").bind(accountKey).first();
  const balanceAfter = Number(existing && existing.balance || 0) + Number(input.pointDelta || 0);

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
      INSERT INTO point_ledger (account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, source_event_id, business_key, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(accountKey, masterMemberRef, input.channelKey, input.lineUserId, input.action, pointType, Number(input.pointDelta || 0), balanceAfter, input.source, input.sourceEventId || null, businessKey, input.note || null),
  ]);

  return { account_key: accountKey, master_member_ref: masterMemberRef, balance_after: balanceAfter };
}

async function listPointBalances(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);

  if (channelKey && lineUserId) {
    const rows = await env.DB.prepare(`
      SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
      FROM point_accounts
      WHERE channel_key = ? AND line_user_id = ?
      ORDER BY point_type
      LIMIT ?
    `).bind(channelKey, lineUserId, limit).all();
    return rows.results || [];
  }
  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
      FROM point_accounts
      WHERE master_member_ref = ?
      ORDER BY channel_key, point_type
      LIMIT ?
    `).bind(masterMemberRef, limit).all();
    return rows.results || [];
  }
  if (channelKey) {
    const rows = await env.DB.prepare(`
      SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
      FROM point_accounts
      WHERE channel_key = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(channelKey, limit).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at
    FROM point_accounts
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
}

async function listPointLedger(env, url) {
  const channelKey = stringValue(url.searchParams.get("channel_key"));
  const lineUserId = stringValue(url.searchParams.get("line_user_id") || url.searchParams.get("userId"));
  const masterMemberRef = stringValue(url.searchParams.get("master_member_ref"));
  const limit = clampNumber(url.searchParams.get("limit") || 100, 1, 500);

  if (channelKey && lineUserId) {
    const rows = await env.DB.prepare(`
      SELECT id, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, note, created_at
      FROM point_ledger
      WHERE channel_key = ? AND line_user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).bind(channelKey, lineUserId, limit).all();
    return rows.results || [];
  }
  if (masterMemberRef) {
    const rows = await env.DB.prepare(`
      SELECT id, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, note, created_at
      FROM point_ledger
      WHERE master_member_ref = ?
      ORDER BY id DESC
      LIMIT ?
    `).bind(masterMemberRef, limit).all();
    return rows.results || [];
  }
  const rows = await env.DB.prepare(`
    SELECT id, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, note, created_at
    FROM point_ledger
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all();
  return rows.results || [];
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
  const rows = Array.isArray(body.points) ? body.points : await fetchWetwArray(env, "points");
  let count = 0;
  for (const item of rows) {
    const channelKey = stringValue(item.channel_key || item.channelKey || item.oa || POINT_OA1);
    const lineUserId = stringValue(item.line_user_id || item.lineUserId || item.userId);
    const pointType = stringValue(item.point_type || item.pointType || "wetw_point");
    const balance = Number(item.balance || item.points || 0);
    if (!channelKey || !lineUserId || !Number.isFinite(balance)) continue;
    const accountKey = `${channelKey}:${lineUserId}:${pointType}`;
    const masterMemberRef = stringValue(item.master_member_ref || item.member_ref || item.memberRef) || null;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO point_accounts (account_key, master_member_ref, channel_key, line_user_id, point_type, balance, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(account_key) DO UPDATE SET
          master_member_ref = excluded.master_member_ref,
          balance = excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `).bind(accountKey, masterMemberRef, channelKey, lineUserId, pointType, balance),
      env.DB.prepare(`
        INSERT OR IGNORE INTO point_ledger (account_key, master_member_ref, channel_key, line_user_id, action, point_type, point_delta, balance_after, source, business_key, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(accountKey, masterMemberRef, channelKey, lineUserId, "sync", pointType, 0, balance, "wetw", `sync:${accountKey}:${Date.now()}`, "WETW read-only sync"),
    ]);
    count += 1;
  }
  await writeCrmSyncLog(env, "points", count, "success", body.points ? "body" : "wetw");
  return { count, source: body.points ? "body" : "wetw" };
}

async function fetchWetwArray(env, type) {
  const url = type === "members" ? env.WETW_MEMBERS_URL : env.WETW_POINTS_URL;
  if (!url) throw httpError(`${type === "members" ? "WETW_MEMBERS_URL" : "WETW_POINTS_URL"} is not configured. You can POST an array in the request body first.`, 400);
  if (type === "members") return fetchWetwMembersFromWordPress(env, url);

  const headers = { "Accept": "application/json" };
  if (env.POINT_API_KEY) headers.Authorization = `Bearer ${env.POINT_API_KEY}`;
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(`WETW ${type} sync failed: ${response.status}`, 502);
  const direct = data[type];
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return Array.isArray(data) ? data : [];
}

async function fetchWetwMembersFromWordPress(env, url) {
  if (!env.POINT_API_KEY) throw httpError("POINT_API_KEY is not configured", 400);
  const shopId = Number(env.WETW_SHOP_ID || 216);
  if (!Number.isFinite(shopId) || shopId <= 0) throw httpError("WETW_SHOP_ID must be a positive integer", 400);

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
  <title>KLINK CRM / 點數模組</title>
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
    <div class="brand"><div class="logo">KL</div><div><h1>KLINK CRM</h1><p>LINE 會員與點數模組</p></div></div>
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
      <button id="syncPoints" class="secondary" style="margin-top:10px">同步 WETW 點數</button>
      <p style="margin-top:10px">會員 API 已支援 WETW POST JSON 格式。點數 API 等文件確認後再正式校正。</p>
    </section>
    <section class="panel">
      <h2>手動點數</h2>
      <label>OA</label><select id="channel"><option value="oa1">OA1 產品客服</option><option value="oa2">OA2 行政客服</option></select>
      <label>LINE User ID</label><input id="lineUserId" placeholder="U...">
      <label>Point Type</label><input id="pointType" value="manual_point">
      <label>點數</label><input id="points" type="number" value="10">
      <label>備註</label><input id="note" placeholder="例如：活動補點 / 商品核銷">
      <div class="row" style="margin-top:12px">
        <button id="grant">贈點</button>
        <button id="deduct" class="warn">扣點</button>
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
  const placeholders = ids.map(() => "?").join(",");
  const messageRows = await env.DB.prepare(`SELECT * FROM messages WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC`).bind(...ids).all();
  const byThread = new Map(ids.map((id) => [id, []]));
  for (const row of messageRows.results || []) {
    if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, []);
    byThread.get(row.thread_id).push(row);
  }
  return results.map((row) => threadFromD1(row, byThread.get(row.id) || []));
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
  return threadFromD1(row, messages.results || []);
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
  }
  if (floor === FLOOR_MAIN) await backupGas(env, { type: "LINE_WEBHOOK", data: payload });
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

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
