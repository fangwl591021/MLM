const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export async function handleExecutiveApi({ request, env, url, session, corsHeaders = {} }) {
  if (!url.pathname.startsWith("/api/executive/")) return null;
  if (!session?.ok || !session?.profile?.admin) {
    return json({ status: "error", message: "需要高層或系統管理員權限" }, 403, corsHeaders);
  }
  if (!env.DB) return json({ status: "error", message: "D1 尚未綁定" }, 503, corsHeaders);

  try {
    if (url.pathname === "/api/executive/summary" && request.method === "GET") {
      return json({ status: "success", data: await buildExecutiveSummary(env.DB, url.searchParams) }, 200, corsHeaders);
    }
    if (url.pathname === "/api/executive/insights" && request.method === "GET") {
      return json({ status: "success", data: await listInsights(env.DB, url.searchParams) }, 200, corsHeaders);
    }
    if (url.pathname === "/api/executive/tasks" && request.method === "GET") {
      return json({ status: "success", data: await listTasks(env.DB, url.searchParams) }, 200, corsHeaders);
    }
    if (url.pathname === "/api/executive/tasks" && request.method === "POST") {
      const body = await safeJson(request);
      const task = await createTask(env.DB, body, session.profile);
      return json({ status: "success", data: task }, 201, corsHeaders);
    }
    if (url.pathname === "/api/executive/decisions" && request.method === "GET") {
      return json({ status: "success", data: await listDecisions(env.DB, url.searchParams) }, 200, corsHeaders);
    }
    if (url.pathname === "/api/executive/decisions" && request.method === "POST") {
      const body = await safeJson(request);
      const decision = await createDecision(env.DB, body, session.profile);
      return json({ status: "success", data: decision }, 201, corsHeaders);
    }
    if (url.pathname === "/api/executive/ask" && request.method === "POST") {
      const body = await safeJson(request);
      const data = await answerExecutiveQuestion(env.DB, body.question);
      await writeAudit(env.DB, session.profile, "executive.ask", "ai_query", data.query_id, { question: data.question });
      return json({ status: "success", data }, 200, corsHeaders);
    }
    return json({ status: "error", message: "找不到高層桌面 API" }, 404, corsHeaders);
  } catch (error) {
    return json({ status: "error", message: error?.message || "高層桌面服務發生錯誤" }, 500, corsHeaders);
  }
}

async function buildExecutiveSummary(db, params) {
  const days = clampInt(params.get("days"), 1, 90, 1);
  const since = `-${days - 1} days`;
  const tableNames = await getTableNames(db);
  const has = name => tableNames.has(name);

  const eventMetrics = has("business_events") ? await first(db, `
    SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN date(occurred_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS today_events,
      SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_events,
      SUM(CASE WHEN severity IN ('high','critical') AND status IN ('open','in_progress') THEN 1 ELSE 0 END) AS important_events
    FROM business_events
    WHERE datetime(occurred_at) >= datetime('now', ?)
  `, [since]) : emptyMetric(["total_events", "today_events", "open_events", "important_events"]);

  const taskMetrics = has("tasks") ? await first(db, `
    SELECT
      COUNT(*) AS total_tasks,
      SUM(CASE WHEN status IN ('todo','in_progress','blocked') THEN 1 ELSE 0 END) AS open_tasks,
      SUM(CASE WHEN status != 'done' AND due_at IS NOT NULL AND datetime(due_at) < datetime('now') THEN 1 ELSE 0 END) AS overdue_tasks,
      SUM(CASE WHEN priority = 'urgent' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS urgent_tasks
    FROM tasks
  `) : emptyMetric(["total_tasks", "open_tasks", "overdue_tasks", "urgent_tasks"]);

  const decisionMetrics = has("decisions") ? await first(db, `
    SELECT
      COUNT(*) AS total_decisions,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_decisions,
      SUM(CASE WHEN status = 'active' AND review_at IS NOT NULL AND datetime(review_at) <= datetime('now', '+7 days') THEN 1 ELSE 0 END) AS review_due
    FROM decisions
  `) : emptyMetric(["total_decisions", "active_decisions", "review_due"]);

  const insightMetrics = has("executive_insights") ? await first(db, `
    SELECT
      COUNT(*) AS total_insights,
      SUM(CASE WHEN status = 'active' AND insight_type = 'risk' THEN 1 ELSE 0 END) AS active_risks,
      SUM(CASE WHEN status = 'active' AND insight_type = 'opportunity' THEN 1 ELSE 0 END) AS active_opportunities
    FROM executive_insights
    WHERE date(insight_date) >= date('now', ?)
  `, [since]) : emptyMetric(["total_insights", "active_risks", "active_opportunities"]);

  const sourceMetrics = await collectExistingSourceMetrics(db, tableNames, since);
  const latestInsights = has("executive_insights") ? await all(db, `
    SELECT insight_id, insight_type, title, summary, severity, source_scope,
           source_refs_json, metrics_json, recommended_actions_json, generated_at
    FROM executive_insights
    WHERE status = 'active'
    ORDER BY CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC,
             generated_at DESC
    LIMIT 8
  `) : [];

  const generated = generateRuleInsights({ eventMetrics, taskMetrics, decisionMetrics, sourceMetrics });
  return {
    period: { days, timezone: "Asia/Taipei", generated_at: new Date().toISOString() },
    kpis: {
      interactions: number(eventMetrics.today_events) || number(sourceMetrics.messages_today),
      important: number(eventMetrics.important_events) || number(sourceMetrics.important_messages),
      events_checkins: number(sourceMetrics.events_checkins),
      points_changes: number(sourceMetrics.points_changes),
      ai_usage: number(sourceMetrics.ai_usage),
      ai_cost_twd: number(sourceMetrics.ai_cost_twd),
      open_tasks: number(taskMetrics.open_tasks),
      overdue_tasks: number(taskMetrics.overdue_tasks),
      active_decisions: number(decisionMetrics.active_decisions)
    },
    morning_brief: generated.brief,
    risks: mergeInsights(latestInsights.filter(x => x.insight_type === "risk"), generated.risks),
    opportunities: mergeInsights(latestInsights.filter(x => x.insight_type === "opportunity"), generated.opportunities),
    data_sources: sourceMetrics.data_sources,
    raw: { events: eventMetrics, tasks: taskMetrics, decisions: decisionMetrics, insights: insightMetrics, existing_modules: sourceMetrics }
  };
}

async function collectExistingSourceMetrics(db, tables, since) {
  const out = {
    messages_today: 0,
    important_messages: 0,
    events_checkins: 0,
    points_changes: 0,
    ai_usage: 0,
    ai_cost_twd: 0,
    data_sources: []
  };

  const candidates = [
    { tables: ["messages", "line_messages", "chat_messages"], key: "messages_today", dateColumns: ["created_at", "timestamp", "message_time"] },
    { tables: ["calendar_events", "events"], key: "events_checkins", dateColumns: ["start_at", "event_date", "created_at"] },
    { tables: ["checkins", "reward_checkins", "attendance_records"], key: "events_checkins", dateColumns: ["checked_in_at", "created_at"] },
    { tables: ["point_logs", "points_log", "reward_logs", "point_transactions"], key: "points_changes", dateColumns: ["created_at", "occurred_at"] },
    { tables: ["ai_wear_results", "ai_wear_generations", "ai_wear_usage"], key: "ai_usage", dateColumns: ["created_at", "generated_at"] }
  ];

  for (const candidate of candidates) {
    const table = candidate.tables.find(name => tables.has(name));
    if (!table) continue;
    const columns = await getColumns(db, table);
    const dateColumn = candidate.dateColumns.find(name => columns.has(name));
    const where = dateColumn ? ` WHERE datetime(${quoteId(dateColumn)}) >= datetime('now', ?)` : "";
    const args = dateColumn ? [since] : [];
    const row = await first(db, `SELECT COUNT(*) AS count FROM ${quoteId(table)}${where}`, args);
    out[candidate.key] += number(row.count);
    out.data_sources.push({ module: candidate.key, table, freshness_column: dateColumn || null, status: "connected" });
  }

  const messageTable = ["messages", "line_messages", "chat_messages"].find(name => tables.has(name));
  if (messageTable) {
    const columns = await getColumns(db, messageTable);
    const statusColumn = ["status", "classification", "priority"].find(name => columns.has(name));
    if (statusColumn) {
      const row = await first(db, `SELECT COUNT(*) AS count FROM ${quoteId(messageTable)} WHERE lower(CAST(${quoteId(statusColumn)} AS TEXT)) IN ('important','urgent','待處理','重要')`);
      out.important_messages = number(row.count);
    }
  }

  const costTable = ["ai_wear_cost_logs", "ai_usage_costs", "ai_wear_usage"].find(name => tables.has(name));
  if (costTable) {
    const columns = await getColumns(db, costTable);
    const costColumn = ["cost_twd", "amount_twd", "estimated_cost_twd"].find(name => columns.has(name));
    if (costColumn) {
      const row = await first(db, `SELECT COALESCE(SUM(CAST(${quoteId(costColumn)} AS REAL)),0) AS total FROM ${quoteId(costTable)}`);
      out.ai_cost_twd = number(row.total);
      out.data_sources.push({ module: "ai_cost_twd", table: costTable, freshness_column: null, status: "connected" });
    }
  }
  return out;
}

function generateRuleInsights({ eventMetrics, taskMetrics, decisionMetrics, sourceMetrics }) {
  const risks = [];
  const opportunities = [];
  const important = number(eventMetrics.important_events) || number(sourceMetrics.important_messages);
  const overdue = number(taskMetrics.overdue_tasks);
  const aiUsage = number(sourceMetrics.ai_usage);
  const checkins = number(sourceMetrics.events_checkins);

  if (important > 0) risks.push(insight("risk", "重要事件待處理", `目前有 ${important} 筆高嚴重度或重要訊息尚待確認。`, important >= 10 ? "high" : "medium", ["檢視來源內容", "指派責任部門", "設定處理期限"]));
  if (overdue > 0) risks.push(insight("risk", "任務已逾期", `目前有 ${overdue} 項任務超過期限且尚未完成。`, overdue >= 5 ? "high" : "medium", ["確認阻塞原因", "重新設定責任人或期限"]));
  if (!risks.length) risks.push(insight("risk", "尚未發現明確重大異常", "目前已接入的資料沒有形成高嚴重度警示；仍需持續擴充資料來源。", "info", ["確認資料來源更新時間"]));

  if (checkins > 0) opportunities.push(insight("opportunity", "活動資料可形成轉換漏斗", `已辨識 ${checkins} 筆活動或報到資料，可進一步分析報名、實到、回訪與成交。`, "medium", ["串接會員身份", "建立活動後七日互動率"]));
  if (aiUsage > 0) opportunities.push(insight("opportunity", "AI 試戴已有使用軌跡", `已辨識 ${aiUsage} 筆 AI 功能使用，可進一步連結分享、名單與購買意願。`, "medium", ["連結推薦人", "建立試戴到成交漏斗"]));
  if (!opportunities.length) opportunities.push(insight("opportunity", "建立統一事件層", "先將 LINE、活動、點數與 AI 試戴寫入 business_events，才能形成跨模組分析。", "medium", ["部署 Phase 1 migration", "啟用事件寫入器"]));

  const brief = `今日已整合 ${number(eventMetrics.today_events) || number(sourceMetrics.messages_today)} 筆互動或事件；` +
    `重要待處理 ${important} 筆，逾期任務 ${overdue} 項，進行中決策 ${number(decisionMetrics.active_decisions)} 項。` +
    `建議先處理高嚴重度事件，再確認活動轉換與 AI 功能使用成效。`;
  return { brief, risks, opportunities };
}

async function listInsights(db, params) {
  const limit = clampInt(params.get("limit"), 1, 100, 30);
  return all(db, `SELECT * FROM executive_insights ORDER BY generated_at DESC LIMIT ?`, [limit]);
}

async function listTasks(db, params) {
  const limit = clampInt(params.get("limit"), 1, 100, 50);
  const status = params.get("status");
  if (status) return all(db, `SELECT * FROM tasks WHERE status = ? ORDER BY due_at IS NULL, due_at, created_at DESC LIMIT ?`, [status, limit]);
  return all(db, `SELECT * FROM tasks ORDER BY CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, due_at IS NULL, due_at LIMIT ?`, [limit]);
}

async function createTask(db, body, profile) {
  requireText(body.title, "任務標題");
  const taskId = createId("task");
  const priority = allowed(body.priority, ["low", "medium", "high", "urgent"], "medium");
  await db.prepare(`INSERT INTO tasks (task_id,title,description,source_type,source_id,owner_user_id,owner_department,created_by,priority,status,due_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,'todo',?,?)`)
    .bind(taskId, body.title.trim(), text(body.description), text(body.source_type), text(body.source_id), text(body.owner_user_id), text(body.owner_department), actorId(profile), priority, text(body.due_at), JSON.stringify(body.metadata || {})).run();
  await writeAudit(db, profile, "task.create", "task", taskId, { title: body.title, priority });
  return first(db, `SELECT * FROM tasks WHERE task_id = ?`, [taskId]);
}

async function listDecisions(db, params) {
  const limit = clampInt(params.get("limit"), 1, 100, 50);
  return all(db, `SELECT * FROM decisions ORDER BY decided_at DESC LIMIT ?`, [limit]);
}

async function createDecision(db, body, profile) {
  requireText(body.title, "決策標題");
  requireText(body.decision_text, "決策內容");
  const decisionId = createId("decision");
  const decidedAt = body.decided_at || new Date().toISOString();
  await db.prepare(`INSERT INTO decisions (decision_id,title,context,decision_text,rationale,decided_by,decided_at,source_refs_json,expected_outcome,review_at,status,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`)
    .bind(decisionId, body.title.trim(), text(body.context), body.decision_text.trim(), text(body.rationale), actorId(profile), decidedAt, JSON.stringify(body.source_refs || []), text(body.expected_outcome), text(body.review_at), JSON.stringify(body.metadata || {})).run();
  await writeAudit(db, profile, "decision.create", "decision", decisionId, { title: body.title });
  return first(db, `SELECT * FROM decisions WHERE decision_id = ?`, [decisionId]);
}

async function answerExecutiveQuestion(db, rawQuestion) {
  const question = String(rawQuestion || "").trim();
  if (!question) throw new Error("請輸入問題");
  const summary = await buildExecutiveSummary(db, new URLSearchParams("days=30"));
  const k = summary.kpis;
  let answer;
  if (/風險|異常|注意|重要/.test(question)) {
    answer = `${summary.morning_brief}\n\n優先風險：\n${summary.risks.map((x, i) => `${i + 1}. ${x.title}：${x.summary}`).join("\n")}`;
  } else if (/活動|報到|課程/.test(question)) {
    answer = `目前辨識到 ${k.events_checkins} 筆活動或報到相關資料。建議下一步建立報名數、實到數、出席率、活動後七日互動率與成交率。`;
  } else if (/點數/.test(question)) {
    answer = `目前辨識到 ${k.points_changes} 筆點數異動。正式判斷異常前，仍需補上點數來源、發放人、使用人、活動與經銷商欄位。`;
  } else if (/試戴|眼鏡|AI/.test(question)) {
    answer = `目前辨識到 ${k.ai_usage} 筆 AI 功能使用，估算成本為新台幣 ${k.ai_cost_twd.toLocaleString("zh-TW")} 元。建議串接分享、推薦人、購買意願與成交資料。`;
  } else if (/任務|交辦|逾期/.test(question)) {
    answer = `目前有 ${k.open_tasks} 項未完成任務，其中 ${k.overdue_tasks} 項已逾期。`;
  } else {
    answer = summary.morning_brief;
  }
  return { query_id: createId("query"), question, answer, citations: summary.data_sources, generated_at: new Date().toISOString(), mode: "rule_engine" };
}

function insight(type, title, summary, severity, actions) {
  return { insight_type: type, title, summary, severity, recommended_actions: actions, source_scope: "rule_engine" };
}
function mergeInsights(stored, generated) {
  return [...stored.map(x => ({ ...x, recommended_actions: parseJson(x.recommended_actions_json, []) })), ...generated].slice(0, 6);
}
async function getTableNames(db) {
  const rows = await all(db, `SELECT name FROM sqlite_master WHERE type='table'`);
  return new Set(rows.map(x => x.name));
}
async function getColumns(db, table) {
  const rows = await all(db, `PRAGMA table_info(${quoteId(table)})`);
  return new Set(rows.map(x => x.name));
}
async function first(db, sql, args = []) {
  return (await db.prepare(sql).bind(...args).first()) || {};
}
async function all(db, sql, args = []) {
  const result = await db.prepare(sql).bind(...args).all();
  return result.results || [];
}
async function safeJson(request) {
  try { return await request.json(); } catch { throw new Error("JSON 格式錯誤"); }
}
async function writeAudit(db, profile, action, targetType, targetId, detail) {
  try {
    await db.prepare(`INSERT INTO audit_logs (actor_id,actor_role,action,target_type,target_id,request_id,detail_json) VALUES (?,?,?,?,?,?,?)`)
      .bind(actorId(profile), profile?.admin ? "admin" : "user", action, targetType, targetId, createId("req"), JSON.stringify(detail || {})).run();
  } catch { /* audit table may not be deployed yet; do not block read-only rollout */ }
}
function actorId(profile) { return String(profile?.userId || profile?.sub || profile?.username || profile?.name || "admin"); }
function quoteId(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function text(value) { const s = String(value ?? "").trim(); return s || null; }
function requireText(value, label) { if (!String(value || "").trim()) throw new Error(`${label}不可空白`); }
function allowed(value, values, fallback) { return values.includes(value) ? value : fallback; }
function clampInt(value, min, max, fallback) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function emptyMetric(keys) { return Object.fromEntries(keys.map(key => [key, 0])); }
function createId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`; }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function json(payload, status, corsHeaders) { return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...corsHeaders } }); }
