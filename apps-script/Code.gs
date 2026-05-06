/**
 * Google Apps Script: AI suggestion brain + Google Sheets persistence.
 *
 * Core rule:
 * - Never reply to LINE users automatically.
 * - Store every text message.
 * - Generate admin-only reply suggestions.
 * - Send Telegram notifications only for important messages.
 */

const SHEETS = {
  chats: "對話紀錄",
  aiLogs: "AI監看紀錄",
  errors: "系統錯誤紀錄",
  knowledge: "知識庫",
};

const HEADERS = {
  chats: ["時間", "身份", "用戶ID", "內容", "類別", "AI建議", "重要", "情緒", "狀態"],
  aiLogs: ["時間", "用戶ID", "內容", "類別", "情緒", "原因", "狀態", "TG通知"],
  errors: ["時間", "來源", "訊息", "細節"],
  knowledge: ["category", "question", "answer"],
};

function doPost(e) {
  try {
    const payload = parseRequest_(e);
    assertSharedSecret_(payload.secret);

    const type = payload.type;
    if (type === "FETCH_DASHBOARD_DATA") return fetchDashboardData_();
    if (type === "LINE_WEBHOOK") return handleLineWebhook_(payload.data);
    if (type === "SAVE_ADMIN_REPLY") return saveAdminReply_(payload.data);
    if (type === "SETUP_SHEETS") return setupSheets();

    return json_({ status: "error", message: "Unknown request type: " + type });
  } catch (err) {
    logError_("doPost", err && err.message ? err.message : String(err), err && err.stack ? err.stack : "");
    return json_({ status: "error", message: err && err.message ? err.message : String(err) });
  }
}

/**
 * Run once from Apps Script editor after setting Script Properties.
 */
function setupSheets() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  ensureSheet_(ss, SHEETS.aiLogs, HEADERS.aiLogs);
  ensureSheet_(ss, SHEETS.errors, HEADERS.errors);
  ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  return json_({ status: "success", message: "Sheets are ready" });
}

/**
 * Optional helper: paste the JSON text from data/knowledge-base.json here in the Apps Script editor.
 * Example:
 *   updateKnowledgeBaseFromJson('[{"category":"...","question":"...","answer":"..."}]');
 */
function updateKnowledgeBaseFromJson(jsonText) {
  const rows = JSON.parse(jsonText);
  if (!Array.isArray(rows)) throw new Error("Knowledge base JSON must be an array");

  const ss = getSpreadsheet_();
  const sheet = ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  sheet.clearContents();
  sheet.appendRow(HEADERS.knowledge);

  rows.forEach(function (item) {
    sheet.appendRow([
      item.category || "",
      item.question || "",
      item.answer || "",
    ]);
  });

  PropertiesService.getScriptProperties().setProperty("KNOWLEDGE_BASE_JSON", JSON.stringify(rows));
  return json_({ status: "success", count: rows.length });
}

function fetchDashboardData_() {
  const ss = getSpreadsheet_();
  setupSheets();

  return json_({
    status: "success",
    data: {
      chats: getSheetDataAsJson_(ss, SHEETS.chats, 200),
      aiLogs: getSheetDataAsJson_(ss, SHEETS.aiLogs, 100),
    },
  });
}

function handleLineWebhook_(data) {
  if (!data || !Array.isArray(data.events)) {
    return json_({ status: "success", message: "No LINE events" });
  }

  const ss = getSpreadsheet_();
  const chatSheet = ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  const aiSheet = ensureSheet_(ss, SHEETS.aiLogs, HEADERS.aiLogs);

  data.events.forEach(function (event) {
    if (!event || event.type !== "message") return;
    if (!event.message || event.message.type !== "text") return;

    const text = String(event.message.text || "").trim();
    const userId = event.source && event.source.userId ? event.source.userId : "unknown";
    if (!text) return;

    const analysis = performAIAnalysis_(text, userId);
    const now = Date.now();

    chatSheet.appendRow([
      now,
      "user",
      userId,
      text,
      analysis.category,
      JSON.stringify(analysis.suggestions || []),
      analysis.isImportant ? "是" : "否",
      analysis.sentiment || "neutral",
      "待回覆",
    ]);

    if (analysis.isImportant) {
      const tgStatus = sendTelegramAlert_(userId, text, analysis);
      aiSheet.appendRow([
        now,
        userId,
        text,
        analysis.category,
        analysis.sentiment || "neutral",
        analysis.reportReason || analysis.summary || "",
        "待處理",
        tgStatus,
      ]);
    }
  });

  return json_({ status: "success" });
}

function saveAdminReply_(data) {
  if (!data || !data.userId || !data.text) {
    return json_({ status: "error", message: "userId and text are required" });
  }

  const ss = getSpreadsheet_();
  const sheet = ensureSheet_(ss, SHEETS.chats, HEADERS.chats);
  sheet.appendRow([
    data.time || Date.now(),
    "admin",
    data.userId,
    data.text,
    "人工回覆",
    "",
    "否",
    "neutral",
    "已回覆",
  ]);

  return json_({ status: "success" });
}

function performAIAnalysis_(text, userId) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("GEMINI_API_KEY");
  const model = props.getProperty("GEMINI_MODEL") || "gemini-2.5-flash";
  const brain = getKnowledgeBase_();

  if (!apiKey) {
    return normalizeAnalysis_({
      isImportant: false,
      category: "未設定 Gemini",
      sentiment: "neutral",
      suggestions: ["系統尚未設定 Gemini API Key，請管理員先完成後台設定。"],
    });
  }

  const prompt = [
    "你是 LINE OA 後台管理員的 AI 助理，只提供管理員回應建議，絕對不要代表官方自動回覆用戶。",
    "請根據康立知識庫判斷用戶問題、分類、情緒與是否需要通報。",
    "重要訊息包含：客訴、負評、退貨爭議、獎金爭議、法規或價格違規、跨線搶線、產品不良、物流破損、公開社群抱怨、制度建議、重大風險。",
    "如果只是一般產品或制度詢問，isImportant 必須是 false。",
    "suggestions 是給管理員看的可複製回覆草稿，請保持禮貌、精準、不要誇大療效。",
    "只能輸出 JSON，不要輸出 Markdown。",
    "JSON schema:",
    '{"isImportant":true,"category":"分類","sentiment":"positive|neutral|negative|complaint","summary":"一句摘要","reportReason":"若重要，說明通報原因","suggestions":["建議回覆1","建議回覆2"]}',
    "康立知識庫 JSON:",
    JSON.stringify(brain),
    "用戶ID: " + userId,
    "用戶訊息: " + text,
  ].join("\n");

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });

    const body = response.getContentText();
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error("Gemini HTTP " + response.getResponseCode() + ": " + body);
    }

    const outer = JSON.parse(body);
    const generated = outer.candidates &&
      outer.candidates[0] &&
      outer.candidates[0].content &&
      outer.candidates[0].content.parts &&
      outer.candidates[0].content.parts[0] &&
      outer.candidates[0].content.parts[0].text;

    if (!generated) throw new Error("Gemini returned empty content");
    return normalizeAnalysis_(JSON.parse(generated));
  } catch (err) {
    logError_("performAIAnalysis", err && err.message ? err.message : String(err), text);
    return normalizeAnalysis_({
      isImportant: false,
      category: "一般查詢",
      sentiment: "neutral",
      suggestions: ["您好，這個問題我先為您確認，稍後由專人回覆您。"],
    });
  }
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
    suggestions: suggestions
      .map(function (item) { return String(item || "").trim(); })
      .filter(function (item) { return item.length > 0; })
      .slice(0, 3),
  };
}

function sendTelegramAlert_(userId, text, analysis) {
  const props = PropertiesService.getScriptProperties();
  const botToken = props.getProperty("TELEGRAM_BOT_TOKEN");
  const chatId = props.getProperty("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) return "未設定";

  const message = [
    "LINE OA 重要訊息通報",
    "分類：" + analysis.category,
    "情緒：" + analysis.sentiment,
    "用戶：" + userId,
    "原因：" + (analysis.reportReason || analysis.summary || "AI 判定需人工關注"),
    "原文：" + text,
    "建議：" + ((analysis.suggestions || [])[0] || "請管理員查看後台"),
  ].join("\n");

  try {
    const response = UrlFetchApp.fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
    return response.getResponseCode() >= 200 && response.getResponseCode() < 300 ? "已通知" : "通知失敗:" + response.getResponseCode();
  } catch (err) {
    logError_("sendTelegramAlert", err && err.message ? err.message : String(err), message);
    return "通知失敗";
  }
}

function getKnowledgeBase_() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty("KNOWLEDGE_BASE_JSON");
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      logError_("getKnowledgeBase", "Invalid KNOWLEDGE_BASE_JSON", err.message);
    }
  }

  const ss = getSpreadsheet_();
  const sheet = ensureSheet_(ss, SHEETS.knowledge, HEADERS.knowledge);
  const rows = getSheetDataAsJson_(ss, SHEETS.knowledge, 500);
  return rows
    .map(function (row) {
      return {
        category: row.category || "",
        question: row.question || "",
        answer: row.answer || "",
      };
    })
    .filter(function (row) {
      return row.question && row.answer;
    });
}

function getSheetDataAsJson_(ss, sheetName, limit) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (header, index) {
      obj[header] = row[index];
    });
    return obj;
  }).reverse().slice(0, limit || 100);
}

function ensureSheet_(ss, sheetName, headers) {
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every(function (header, index) {
    return firstRow[index] === header;
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID is not configured in Script Properties");
  return SpreadsheetApp.openById(id);
}

function assertSharedSecret_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty("GAS_SHARED_SECRET");
  if (expected && secret !== expected) throw new Error("Invalid GAS shared secret");
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("Missing POST body");
  try {
    return JSON.parse(e.postData.contents);
  } catch (_err) {
    throw new Error("Invalid JSON body");
  }
}

function logError_(source, message, detail) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ensureSheet_(ss, SHEETS.errors, HEADERS.errors);
    sheet.appendRow([Date.now(), source, message, detail || ""]);
  } catch (_err) {
    // Avoid recursive failures when the spreadsheet itself is not configured yet.
  }
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
