/**
 * Cloudflare Worker: LINE OA webhook relay + dashboard API.
 *
 * Core rule:
 * - Incoming LINE messages are never auto-replied.
 * - The Worker verifies LINE, forwards events to Google Apps Script, and returns OK.
 * - Only an authenticated dashboard admin can manually push a LINE message or import knowledge JSON.
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

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
            GAS_URL: Boolean(env.GAS_URL),
            GAS_SHARED_SECRET: Boolean(env.GAS_SHARED_SECRET),
            LINE_CHANNEL_SECRET: Boolean(env.LINE_CHANNEL_SECRET),
            LINE_CHANNEL_ACCESS_TOKEN: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
            DASHBOARD_API_TOKEN: Boolean(env.DASHBOARD_API_TOKEN),
            ALLOWED_ORIGIN: Boolean(env.ALLOWED_ORIGIN),
          },
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/data" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const data = await callGas(env, { type: "FETCH_DASHBOARD_DATA" });
        return jsonResponse(data, 200, corsHeaders);
      }

      if (url.pathname === "/api/profile-debug" && request.method === "GET") {
        assertDashboardAuth(request, env);
        const userId = String(url.searchParams.get("userId") || url.searchParams.get("uid") || "").trim();
        if (!userId) return jsonResponse({ status: "error", message: "userId is required" }, 400, corsHeaders);
        const gasMeta = await callGas(env, { type: "GET_CONVERSATION_META", data: { userId } });
        const direct = await fetchLineProfileWithDetail(env, userId);
        return jsonResponse({
          status: "success",
          userId,
          stored: gasMeta.meta || null,
          placeholderDetected: isPlaceholderName(gasMeta.meta && gasMeta.meta["用戶名稱"], userId),
          profileChecks: { direct },
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/backfill-profiles" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request).catch(() => ({}));
        const limit = Math.max(1, Math.min(Number(body.limit || 100), 300));
        const targets = await callGas(env, { type: "FETCH_PROFILE_BACKFILL_TARGETS", data: { limit } });
        const results = [];

        for (const target of targets.targets || []) {
          const userId = String(target.userId || target["用戶ID"] || "").trim();
          if (!userId) continue;
          const profile = await fetchLineProfileWithDetail(env, userId);
          const result = { userId, profileStatus: profile.status, updated: false };
          if (profile.ok && profile.data && (profile.data.displayName || profile.data.pictureUrl)) {
            const updated = await callGas(env, {
              type: "UPDATE_CONVERSATION_META",
              data: {
                userId,
                userName: profile.data.displayName || "",
                pictureUrl: profile.data.pictureUrl || "",
              },
            });
            result.updated = updated.status === "success";
            result.displayName = profile.data.displayName || "";
            result.pictureUrl = profile.data.pictureUrl || "";
          } else {
            result.error = profile.detail || profile.error || "LINE profile unavailable";
          }
          results.push(result);
        }

        return jsonResponse({ status: "success", scanned: (targets.targets || []).length, results }, 200, corsHeaders);
      }

      if (url.pathname === "/api/knowledge" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const knowledge = body.knowledge;
        if (!knowledge) return jsonResponse({ status: "error", message: "knowledge is required" }, 400, corsHeaders);

        const data = await callGas(env, {
          type: "IMPORT_KNOWLEDGE_BASE",
          data: {
            knowledge,
            fileName: String(body.fileName || "dashboard-upload.json"),
            source: "dashboard-upload",
          },
        });
        return jsonResponse(data, 200, corsHeaders);
      }

      if (url.pathname === "/api/conversation-meta" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = String(body.userId || "").trim();
        if (!userId) return jsonResponse({ status: "error", message: "userId is required" }, 400, corsHeaders);

        const data = await callGas(env, {
          type: "UPDATE_CONVERSATION_META",
          data: {
            userId,
            userName: String(body.userName || "").trim(),
            pictureUrl: String(body.pictureUrl || "").trim(),
            status: body.status === undefined ? undefined : String(body.status || "").trim(),
            tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : body.tags,
            note: body.note === undefined ? undefined : String(body.note || ""),
          },
        });
        return jsonResponse(data, 200, corsHeaders);
      }

      if (url.pathname === "/api/send" && request.method === "POST") {
        assertDashboardAuth(request, env);

        const body = await safeJson(request);
        const userId = String(body.userId || "").trim();
        const text = String(body.text || "").trim();
        const userName = String(body.userName || "").trim();

        if (!userId || !text) {
          return jsonResponse({ status: "error", message: "userId and text are required" }, 400, corsHeaders);
        }

        const lineResult = await pushLineMessage(env, userId, text);
        if (!lineResult.ok) {
          return jsonResponse({ status: "error", message: "LINE push failed", detail: lineResult.detail }, lineResult.status || 502, corsHeaders);
        }

        ctx.waitUntil(callGas(env, {
          type: "SAVE_ADMIN_REPLY",
          data: { userId, userName, text, time: Date.now(), category: "人工回覆", status: "處理完畢" },
        }));

        return jsonResponse({ status: "success" }, 200, corsHeaders);
      }

      if (url.pathname === "/api/log-reply" && request.method === "POST") {
        assertDashboardAuth(request, env);
        const body = await safeJson(request);
        const userId = String(body.userId || "").trim();
        const text = String(body.text || "").trim();
        const userName = String(body.userName || "").trim();
        if (!userId || !text) return jsonResponse({ status: "error", message: "userId and text are required" }, 400, corsHeaders);

        const data = await callGas(env, {
          type: "SAVE_ADMIN_REPLY",
          data: { userId, userName, text, time: Date.now(), category: "客服補記", status: "處理完畢" },
        });
        return jsonResponse(data, 200, corsHeaders);
      }

      if ((url.pathname === "/" || url.pathname === "/webhook/line") && request.method === "POST") {
        const rawBody = await request.text();
        const signature = request.headers.get("x-line-signature") || "";
        const validLine = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);

        if (!validLine) return new Response("Invalid LINE signature", { status: 401, headers: corsHeaders });

        const payload = JSON.parse(rawBody);
        if (Array.isArray(payload.events) && payload.events.length > 0) {
          await attachLineProfiles(payload, env);
          ctx.waitUntil(callGas(env, { type: "LINE_WEBHOOK", data: payload }));
        }

        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      return jsonResponse({
        status: "active",
        service: "line-oa-ai-suggestion-worker",
        routes: ["/health", "/api/data", "/api/profile-debug", "/api/backfill-profiles", "/api/knowledge", "/api/conversation-meta", "/api/send", "/api/log-reply", "/webhook/line"],
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ status: "error", message: err && err.message ? err.message : String(err) }, err.status || 500, corsHeaders);
    }
  },
};

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
  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.DASHBOARD_API_TOKEN}`;
  if (auth !== expected) throw httpError("Unauthorized dashboard request", 401);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
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

async function pushLineMessage(env, userId, text) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, status: 500, detail: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
  });
  const detail = await response.text();
  return { ok: response.ok, status: response.status, detail };
}

async function attachLineProfiles(payload, env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !Array.isArray(payload.events)) return;
  const cache = new Map();
  await Promise.all(payload.events.map(async (event) => {
    const userId = event && event.source && event.source.userId;
    if (!userId) return;
    if (!cache.has(userId)) cache.set(userId, fetchLineProfile(env, userId));
    const profile = await cache.get(userId);
    if (profile) event.userProfile = profile;
  }));
}

async function fetchLineProfile(env, userId) {
  const result = await fetchLineProfileWithDetail(env, userId);
  return result.ok ? result.data : null;
}

async function fetchLineProfileWithDetail(env, userId) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, status: 500, detail: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_err) { data = null; }
    if (!response.ok) return { ok: false, status: response.status, detail: text };
    return {
      ok: true,
      status: response.status,
      data: {
        displayName: data && data.displayName ? data.displayName : "",
        pictureUrl: data && data.pictureUrl ? data.pictureUrl : "",
        statusMessage: data && data.statusMessage ? data.statusMessage : "",
      },
    };
  } catch (err) {
    return { ok: false, status: 0, error: err && err.message ? err.message : String(err) };
  }
}

function isPlaceholderName(value, userId) {
  const text = String(value || "").trim();
  return !text || text === String(userId || "") || /^U[a-z0-9]{8,}$/i.test(text) || /^用戶\s*[a-z0-9]{4,}$/i.test(text);
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
