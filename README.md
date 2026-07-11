# LINE OA AI 建議後台

這個專案完成三件事：

1. 將 LINE OA 聊天內容同步到管理員對話框。
2. AI 讀取聊天室內容與 `data/knowledge-base.json` 知識庫後，只提供管理員回應建議。
3. 系統全程不自動回覆客戶；只有客訴、負評、建議、退貨爭議、獎金爭議等重要訊息會發 Telegram 通知並記錄在 Google Sheets。

## 康立 AI 智慧營運桌面

目前開發分支已加入高層 AI 桌面 Phase 1／2：

- `docs/executive.html`：第一版只讀高層桌面。
- `docs/executive-v2.html`：改接獨立 `/api/executive/*` 的第二版桌面。
- `worker/executive-api.js`：高層摘要、洞察、任務、決策與問答模組。
- `migrations/20260711_ai_desktop_phase1.sql`：統一事件、洞察、任務、決策與稽核資料表。
- `docs/AI_DESKTOP_PHASE2_INTEGRATION.md`：接入現有巨型 Worker 的完整步驟。

高層桌面目前採增量方式開發，不修改既有 LINE 客服、活動、點數與 AI 眼鏡試戴流程。

## 檔案

- `worker/worker.js`：Cloudflare Worker，負責 LINE webhook 驗簽、Dashboard API、管理員手動發 LINE。
- `worker/executive-api.js`：康立 AI 高層桌面獨立 API 模組。
- `apps-script/Code.gs`：Google Apps Script，負責 Gemini 分析、Google Sheets 紀錄、Telegram 通知。
- `frontend/index.html`：管理員對話框，可查看聊天室、AI 建議與重要訊息。
- `data/knowledge-base.json`：康立知識庫，共 48 筆。

## Google Sheets

建立一份 Google Sheet，Apps Script 會自動建立這些工作表：

- `對話紀錄`
- `AI監看紀錄`
- `系統錯誤紀錄`
- `知識庫`

## Apps Script 設定

1. 建立 Google Apps Script 專案。
2. 貼上 `apps-script/Code.gs`。
3. 到「專案設定」新增 Script Properties：

```text
SPREADSHEET_ID=你的 Google Sheet ID
GEMINI_API_KEY=你的 Gemini API Key
GAS_SHARED_SECRET=自訂一組很長的密鑰
TELEGRAM_BOT_TOKEN=Telegram Bot Token
TELEGRAM_CHAT_ID=Telegram 通知目標 Chat ID
GEMINI_MODEL=gemini-2.5-flash
```

4. 執行 `setupSheets()`。
5. 將 `data/knowledge-base.json` 內容貼進 `updateKnowledgeBaseFromJson(jsonText)` 的參數執行一次，或把資料手動貼進 `知識庫` 工作表。
6. 部署成 Web App，權限選擇「任何知道連結的人可存取」，取得 Web App URL，填到 Worker 的 `GAS_URL`。

## Cloudflare Worker 環境變數

在 Cloudflare Worker 設定：

```text
GAS_URL=Apps Script Web App URL
GAS_SHARED_SECRET=與 Apps Script 相同的密鑰
LINE_CHANNEL_SECRET=LINE Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=LINE Channel Access Token
DASHBOARD_API_TOKEN=管理員後台 API Token
ALLOWED_ORIGIN=管理員前端網域，測試時可先留空
```

LINE Developers 的 Webhook URL 設為：

```text
https://你的-worker.workers.dev/webhook/line
```

## 管理員後台

直接開啟 `frontend/index.html`，填入：

- Worker API URL，例如 `https://你的-worker.workers.dev`
- Dashboard Token，也就是 Worker 的 `DASHBOARD_API_TOKEN`

後台會每 5 秒同步：

- LINE 使用者對話
- 每則訊息的 AI 分類與建議
- 重要訊息紀錄與 Telegram 通知狀態

## 行為保證

- LINE webhook 進來後只寫入 Google Sheets 與產生 AI 建議。
- 系統不呼叫 LINE reply API。
- 系統不會自動把 Gemini 內容傳給客戶。
- 只有管理員在後台按送出，Worker 才會呼叫 LINE push API。
