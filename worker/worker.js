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
            OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
            ALLOWED_ORIGIN: Boolean(env.ALLOWED_ORIGIN),
          },
        }, 200, corsHeaders);
      }

      const floor = resolveFloor(request);
      const provider = getProvider(env, floor);

      if (url.pathname === "/api/data" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const data = await fetchDashboardData(env, floor);
        if (env.DB && provider.accessToken) {
          ctx.waitUntil(backfillProfiles(env, floor, provider, 12, { force: false, staleMs: 6 * 60 * 60 * 1000 }));
        }
        return jsonResponse(data, 200, corsHeaders);
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
        routes: ["/health", "/api/data?floor=main", "/api/data?floor=admin", "/api/migrate-gas-to-d1", "/api/line-oa/threads", "/api/line-oa/thread", "/api/profile-debug", "/api/backfill-profiles", "/api/knowledge", "/api/conversation-meta", "/api/send", "/api/log-reply", "/webhook/line/main", "/webhook/line/admin"],
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
