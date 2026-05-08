/**
 * Google Apps Script: LINE OA AI suggestion backend.
 * Never auto-reply to LINE users. Store messages, generate admin suggestions, notify Telegram for important items.
 */

const SHEETS = {
  chats: "對話紀錄",
  aiLogs: "AI監看紀錄",
  errors: "系統錯誤紀錄",
  knowledge: "知識庫",
  chatMeta: "對話管理",
};

const HEADERS = {
  chats: ["時間", "身份", "用戶ID", "內容", "類別", "AI建議", "重要", "情緒", "狀態", "用戶名稱"],
  aiLogs: ["時間", "用戶ID", "內容", "類別", "情緒", "原因", "狀態", "TG通知", "用戶名稱"],
  errors: ["時間", "來源", "訊息", "細節"],
  knowledge: ["category", "question", "answer"],
  chatMeta: ["用戶ID", "用戶名稱", "處理狀態", "標籤", "備註", "更新時間"],
};

function doPost(e) {
  try {
    const payload = parseRequest_(e);
    assertSharedSecret_(payload.secret);
    if (payload.type === "FETCH_DASHBOARD_DATA") return fetchDashboardData_();
    if (payload.type === "IMPORT_KNOWLEDGE_BASE") return importKnowledgeBase_(payload.data);
    if (payload.type === "LINE_WEBHOOK") return handleLineWebhook_(payload.data);
    if (payload.type === "SAVE_ADMIN_REPLY") return saveAdminReply_(payload.data);
    if (payload.type === "UPDATE_CONVERSATION_META") return updateConversationMeta_(payload.data);
    if (payload.type === "SETUP_SHEETS") return setupSheets();
    return json_({ status: "error", message: "Unknown request type: " + payload.type });
  } catch (err) {
    logError_("doPost", err.message || String(err), err.stack || "");
    return json_({ status: "error", message: err.message || String(err) });
  }
}

function setupSheets() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  ensureSheet_(ss, SHEETS.aiLogs, HEADERS.aiLogs);
  ensureSheet_(ss, SHEETS.errors, HEADERS.errors);
  ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  ensureSheet_(ss, SHEETS.chatMeta, HEADERS.chatMeta);
  return json_({ status: "success", message: "Sheets are ready" });
}

function updateKnowledgeBaseFromJson(jsonText) {
  return importKnowledgeBase_({ knowledge: JSON.parse(jsonText), source: "Apps Script editor" });
}

function importKnowledgeBase_(data) {
  const payload = data || {};
  const parsed = typeof payload.knowledge === "string" ? JSON.parse(payload.knowledge) : payload.knowledge;
  const normalized = normalizeKnowledgePayload_(parsed);
  if (!normalized.items.length) throw new Error("Knowledge base JSON has no valid Q&A items");

  const ss = getSpreadsheet_();
  const sheet = ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.knowledge.length).setValues([HEADERS.knowledge]);
  sheet.setFrozenRows(1);
  const values = normalized.items.map(function (item) { return [item.category, item.question, item.answer]; });
  sheet.getRange(2, 1, values.length, HEADERS.knowledge.length).setValues(values);

  const meta = {
    title: normalized.title || "",
    version: normalized.version || "",
    source: payload.source || payload.fileName || "dashboard-upload",
    count: normalized.items.length,
    updatedAt: new Date().toISOString(),
  };
  PropertiesService.getScriptProperties().setProperty("KNOWLEDGE_BASE_META", JSON.stringify(meta));
  PropertiesService.getScriptProperties().deleteProperty("KNOWLEDGE_BASE_JSON");
  return json_({ status: "success", count: normalized.items.length, meta: meta });
}

function normalizeKnowledgePayload_(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const items = Array.isArray(payload) ? payload : (Array.isArray(source.items) ? source.items : []);
  const normalizedItems = items.map(function (item, index) {
    const row = item || {};
    const category = String(row.category || row.categoryName || row.分類 || "未分類").trim();
    const question = String(row.question || row.q || row.問題 || "").trim();
    const answer = String(row.answer || row.a || row.答案 || "").trim();
    if (!question || !answer) throw new Error("Invalid knowledge item at index " + index + ": question and answer are required");
    return { category: category, question: question, answer: answer };
  });
  return {
    title: String(source.title || source.name || "").trim(),
    version: String(source.version || source.updatedAt || "").trim(),
    items: normalizedItems,
  };
}

function fetchDashboardData_() {
  const ss = getSpreadsheet_();
  setupSheets();
  return json_({
    status: "success",
    data: {
      chats: getSheetDataAsJson_(ss, SHEETS.chats, 200),
      aiLogs: getSheetDataAsJson_(ss, SHEETS.aiLogs, 100),
      chatMeta: getSheetDataAsJson_(ss, SHEETS.chatMeta, 500),
      systemErrors: getSheetDataAsJson_(ss, SHEETS.errors, 20),
      knowledgeMeta: getKnowledgeMeta_(),
    },
  });
}

function handleLineWebhook_(data) {
  if (!data || !Array.isArray(data.events)) return json_({ status: "success", message: "No LINE events" });
  const ss = getSpreadsheet_();
  const chatSheet = ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  const aiSheet = ensureSheet_(ss, SHEETS.aiLogs, HEADERS.aiLogs);

  data.events.forEach(function (event) {
    if (!event || event.type !== "message") return;
    if (!event.message || event.message.type !== "text") return;
    const text = String(event.message.text || "").trim();
    const userId = event.source && event.source.userId ? event.source.userId : "unknown";
    const userName = getEventDisplayName_(event, userId);
    if (!text) return;

    const analysis = performAIAnalysis_(text, userId, userName);
    const now = Date.now();
    chatSheet.appendRow([now, "user", userId, text, analysis.category, JSON.stringify(analysis.suggestions || []), analysis.isImportant ? "是" : "否", analysis.sentiment || "neutral", "待回覆", userName]);
    upsertConversationMeta_(ss, { userId: userId, userName: userName, status: analysis.isImportant ? "待處理" : "待回覆" });

    if (analysis.isImportant) {
      const tgStatus = sendTelegramAlert_(userId, userName, text, analysis);
      aiSheet.appendRow([now, userId, text, analysis.category, analysis.sentiment || "neutral", analysis.reportReason || analysis.summary || "", "待處理", tgStatus, userName]);
    }
  });

  return json_({ status: "success" });
}

function saveAdminReply_(data) {
  if (!data || !data.userId || !data.text) return json_({ status: "error", message: "userId and text are required" });
  const ss = getSpreadsheet_();
  const sheet = ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  const category = data.category || "人工回覆";
  const status = data.status || "處理完畢";
  sheet.appendRow([data.time || Date.now(), "admin", data.userId, data.text, category, "", "否", "neutral", status, data.userName || ""]);
  upsertConversationMeta_(ss, { userId: data.userId, userName: data.userName || "", status: status });
  return json_({ status: "success" });
}

function updateConversationMeta_(data) {
  if (!data || !data.userId) return json_({ status: "error", message: "userId is required" });
  const ss = getSpreadsheet_();
  const meta = upsertConversationMeta_(ss, data);
  return json_({ status: "success", meta: meta });
}

function upsertConversationMeta_(ss, data) {
  const sheet = ensureSheet_(ss, SHEETS.chatMeta, HEADERS.chatMeta);
  const userId = String(data.userId || "").trim();
  if (!userId) throw new Error("userId is required");

  const values = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][0] || "") === userId) {
      rowIndex = i + 1;
      break;
    }
  }

  const current = rowIndex > 0 ? sheet.getRange(rowIndex, 1, 1, HEADERS.chatMeta.length).getValues()[0] : [userId, "", "待回覆", "", "", ""];
  const tags = normalizeTags_(data.tags === undefined ? current[3] : data.tags).join(",");
  const row = [
    userId,
    data.userName !== undefined && data.userName !== "" ? String(data.userName) : String(current[1] || ""),
    data.status !== undefined && data.status !== "" ? String(data.status) : String(current[2] || "待回覆"),
    tags,
    data.note !== undefined ? String(data.note || "") : String(current[4] || ""),
    Date.now(),
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, HEADERS.chatMeta.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  const result = {};
  HEADERS.chatMeta.forEach(function (header, index) { result[header] = row[index]; });
  return result;
}

function normalizeTags_(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，]/);
  const seen = {};
  return source.map(function (tag) { return String(tag || "").trim(); }).filter(function (tag) {
    if (!tag || seen[tag]) return false;
    seen[tag] = true;
    return true;
  }).slice(0, 8);
}

function performAIAnalysis_(text, userId, userName) {
  const openAiKey = getConfigProperty_("OPENAI_API_KEY", "");
  const openAiModel = getConfigProperty_("OPENAI_MODEL", "gpt-5-mini");
  const openAiUrl = getConfigProperty_("OPENAI_API_URL", "https://api.openai.com/v1/responses");
  const prompt = buildPrompt_(text, userId, userName);
  if (openAiKey) return performOpenAIAnalysis_(prompt, openAiKey, openAiModel, openAiUrl, text);
  return performLocalKnowledgeFallback_(text, "OpenAI API Key missing");
}

function buildPrompt_(text, userId, userName) {
  return [
    "你是 LINE OA 後台管理員的 AI 助理，只提供管理員回應建議，絕對不要代表官方自動回覆用戶。",
    "請根據康立知識庫判斷用戶問題、分類、情緒與是否需要通報。",
    "重要訊息包含：客訴、負評、退貨爭議、獎金爭議、法規或價格違規、跨線搶線、產品不良、物流破損、公開社群抱怨、制度建議、重大風險。",
    "如果只是一般產品或制度詢問，isImportant 必須是 false。",
    "suggestions 是給管理員看的可複製回覆草稿，請保持禮貌、精準、不要誇大療效。",
    "只能輸出 JSON，不要輸出 Markdown。",
    "JSON schema: {\"isImportant\":true,\"category\":\"分類\",\"sentiment\":\"positive|neutral|negative|complaint\",\"summary\":\"一句摘要\",\"reportReason\":\"若重要，說明通報原因\",\"suggestions\":[\"建議回覆1\",\"建議回覆2\"]}",
    "康立知識庫 JSON:",
    JSON.stringify(getKnowledgeBase_()),
    "用戶ID: " + userId,
    "用戶名稱: " + (userName || userId),
    "用戶訊息: " + text,
  ].join("\n");
}

function performOpenAIAnalysis_(prompt, apiKey, model, apiUrl, originalText) {
  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: model,
        input: [
          { role: "system", content: "你是嚴謹的繁體中文客服助理。只輸出符合 schema 的 JSON。" },
          { role: "user", content: prompt },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "line_oa_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                isImportant: { type: "boolean" },
                category: { type: "string" },
                sentiment: { type: "string", enum: ["positive", "neutral", "negative", "complaint"] },
                summary: { type: "string" },
                reportReason: { type: "string" },
                suggestions: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
              },
              required: ["isImportant", "category", "sentiment", "summary", "reportReason", "suggestions"],
            },
          },
        },
        max_output_tokens: 900,
      }),
    });
    const body = response.getContentText();
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error("OpenAI HTTP " + response.getResponseCode() + ": " + body);
    const generated = extractOpenAIText_(JSON.parse(body));
    if (!generated) throw new Error("OpenAI returned empty content");
    return normalizeAnalysis_(JSON.parse(generated));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logError_("performOpenAIAnalysis", message, originalText);
    return performLocalKnowledgeFallback_(originalText, message);
  }
}

function performLocalKnowledgeFallback_(text, reason) {
  const matches = findKnowledgeMatches_(text, getKnowledgeBase_()).slice(0, 3);
  const important = isImportantLocal_(text);
  if (!matches.length) {
    return normalizeAnalysis_({
      isImportant: important,
      category: "一般查詢",
      sentiment: important ? "complaint" : "neutral",
      summary: "OpenAI fallback without knowledge match",
      reportReason: important ? "AI 連線失敗，但訊息含客訴或風險關鍵字" : "",
      suggestions: ["您好，這個問題我先為您確認，稍後由專人回覆您。"],
    });
  }
  const suggestions = matches.map(function (item) {
    return "您好，關於「" + item.question + "」，" + item.answer;
  });
  return normalizeAnalysis_({
    isImportant: important,
    category: matches[0].category || "知識庫查詢",
    sentiment: important ? "complaint" : "neutral",
    summary: "OpenAI fallback with knowledge match: " + (reason || ""),
    reportReason: important ? "AI 連線失敗，但訊息含客訴或風險關鍵字，已用知識庫先產生建議" : "",
    suggestions: suggestions,
  });
}

function findKnowledgeMatches_(text, brain) {
  const tokens = createSearchTokens_(text);
  const compactText = normalizeSearchText_(text);
  return (brain || []).map(function (item) {
    const question = String(item.question || "");
    const answer = String(item.answer || "");
    const category = String(item.category || "");
    const haystack = normalizeSearchText_(category + " " + question + " " + answer);
    let score = 0;
    if (compactText && (haystack.indexOf(compactText) >= 0 || compactText.indexOf(normalizeSearchText_(question)) >= 0)) score += 120;
    tokens.forEach(function (token) {
      if (haystack.indexOf(token) >= 0) score += Math.min(token.length * 8, 32);
    });
    return { category: category, question: question, answer: answer, score: score };
  }).filter(function (item) {
    return item.score > 0;
  }).sort(function (a, b) {
    return b.score - a.score;
  });
}

function createSearchTokens_(text) {
  const normalized = normalizeSearchText_(text);
  const set = {};
  const parts = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  parts.forEach(function (part) {
    if (part.length >= 2) set[part] = true;
    if (/^[\u4e00-\u9fff]+$/.test(part)) {
      for (let size = 2; size <= 4; size += 1) {
        for (let i = 0; i <= part.length - size; i += 1) set[part.slice(i, i + size)] = true;
      }
    }
  });
  return Object.keys(set).slice(0, 100);
}

function normalizeSearchText_(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function isImportantLocal_(text) {
  return /客訴|負評|抱怨|投訴|破損|瑕疵|退貨|退款|爭議|違規|檢舉|沒回|不滿|很糟|生氣/.test(String(text || ""));
}

function extractOpenAIText_(body) {
  if (!body) return "";
  if (body.output_text) return body.output_text;
  const output = body.output || [];
  for (let i = 0; i < output.length; i += 1) {
    const content = output[i].content || [];
    for (let j = 0; j < content.length; j += 1) {
      if (content[j].text) return content[j].text;
    }
  }
  return "";
}

function normalizeAnalysis_(value) {
  const result = value && typeof value === "object" ? value : {};
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  return {
    isImportant: result.isImportant === true,
    category: String(result.category || "一般查詢"),
    sentiment: String(result.sentiment || "neutral"),
    summary: String(result.summary || ""),
    reportReason: String(result.reportReason || ""),
    suggestions: suggestions.map(function (item) { return String(item || "").trim(); }).filter(function (item) { return item.length > 0; }).slice(0, 3),
  };
}

function sendTelegramAlert_(userId, userName, text, analysis) {
  const props = PropertiesService.getScriptProperties();
  const botToken = props.getProperty("TELEGRAM_BOT_TOKEN");
  const chatId = props.getProperty("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) return "未設定";
  const message = ["LINE OA 重要訊息通報", "分類：" + analysis.category, "情緒：" + analysis.sentiment, "用戶：" + (userName || userId), "用戶ID：" + userId, "原因：" + (analysis.reportReason || analysis.summary || "AI 判定需人工關注"), "原文：" + text, "建議：" + ((analysis.suggestions || [])[0] || "請管理員查看後台")].join("\n");
  try {
    const response = UrlFetchApp.fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", { method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify({ chat_id: chatId, text: message }) });
    return response.getResponseCode() >= 200 && response.getResponseCode() < 300 ? "已通知" : "通知失敗:" + response.getResponseCode();
  } catch (err) {
    logError_("sendTelegramAlert", err.message || String(err), message);
    return "通知失敗";
  }
}

function getEventDisplayName_(event, userId) {
  const profile = event && event.userProfile ? event.userProfile : {};
  return profile.displayName ? String(profile.displayName) : userId;
}

function getKnowledgeBase_() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  return getSheetDataAsJson_(ss, SHEETS.knowledge, 1000).map(function (row) {
    return { category: row.category || "", question: row.question || "", answer: row.answer || "" };
  }).filter(function (row) { return row.question && row.answer; });
}

function getKnowledgeMeta_() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty("KNOWLEDGE_BASE_META");
  let meta = {};
  if (json) {
    try { meta = JSON.parse(json); } catch (_err) { meta = {}; }
  }
  if (!meta.count) meta.count = getKnowledgeBase_().length;
  return meta;
}

function getSheetDataAsJson_(ss, sheetName, limit) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (header, index) { obj[header] = row[index]; });
    return obj;
  }).reverse().slice(0, limit || 100);
}

function ensureSheet_(ss, sheetName, headers) {
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every(function (header, index) { return firstRow[index] === header; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSpreadsheet_() {
  const id = getConfigProperty_("SPREADSHEET_ID", "");
  if (!id) throw new Error("SPREADSHEET_ID is not configured in Script Properties");
  return SpreadsheetApp.openById(id);
}

function assertSharedSecret_(secret) {
  const expected = getConfigProperty_("GAS_SHARED_SECRET", "");
  if (expected && secret !== expected) throw new Error("Invalid GAS shared secret");
}

function getConfigProperty_(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(key) || fallback;
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("Missing POST body");
  try { return JSON.parse(e.postData.contents); } catch (_err) { throw new Error("Invalid JSON body"); }
}

function logError_(source, message, detail) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ensureSheet_(ss, SHEETS.errors, HEADERS.errors);
    sheet.appendRow([Date.now(), source, message, detail || ""]);
  } catch (_err) {}
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
