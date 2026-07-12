# KLINK / MLM 專案重新整理分析

更新日期：2026-06-30

## 1. 專案定位

這個 repo 目前已經不是單純的「LINE OA AI 建議後台」。現況比較接近 KLINK 的 LINE OA 營運中台，核心由 Cloudflare Worker 承接：

- LINE OA webhook 接收、驗簽、分流與監控。
- 產品客服、行政客服、康立智能監控三個主要後台視角。
- AI 建議回覆、重要訊息判斷、知識庫管理與回覆學習。
- CRM 會員同步、LINE UID 觀察與會員綁定。
- K 點查詢、贈點、扣點、兌換與點數流水。
- 行事曆、活動、簽到、每日打卡贈點。
- AI 穿戴設定、圖庫、生成結果保存與扣點。

目前部署目標以 Cloudflare Worker `mlm` 為主，D1 database 為 `mlm_line_oa`，R2 bucket 為 `k-linksaas-images`。

## 2. 主要檔案與責任

| 檔案 | 目前角色 |
| --- | --- |
| `worker/worker.js` | 主要 runtime。負責所有 Worker route、LINE webhook、後台頁面、API、AI、CRM、點數、行事曆、AI 穿戴。 |
| `wrangler.toml` | Worker 名稱、D1、R2 binding 與環境變數註記。 |
| `worker/schema.sql` | 基礎客服資料表：profiles、threads、messages、ai_logs、knowledge_items、app_meta。 |
| `worker/point-gateway.sql` | LINE channel、webhook event、會員綁定、CRM、點數帳戶與點數流水。 |
| `console.html` | 主控台靜態前端來源之一，Worker 會改寫部分路徑後提供。 |
| `dashboard.html` / `index.html` | 客服 dashboard 前端來源。 |
| `ai-wear.html` | AI 穿戴公開頁。 |
| `apps-script/Code.gs` | 舊版/補充的 Google Apps Script 分析與 Sheets 流程，現況不應視為唯一核心。 |
| `data/knowledge-base.json` | 初始知識庫資料。 |
| `docs/*.md` | 部署、CRM、權限與操作文件，但部分描述已落後於目前 Worker 功能。 |

## 3. 現場狀態檢查

2026-06-30 對 `https://mlm.fangwl591021.workers.dev` 做最小檢查：

- `/health` 回傳 `status: ok`。
- `/console` 回傳 200。
- `/dashboard?floor=main` 回傳 200。
- `/admin/crm` 回傳 200。
- `/ai-wear` 回傳 200。

`/health` 顯示已存在的核心設定：

- D1 DB、GAS_URL、LINE 主/行政 channel token、OA1/OA2 token。
- DASHBOARD_API_TOKEN、ADMIN_TOKEN、CHANNEL_CONFIG_JSON。
- POINT_API_KEY、WETW members/points/insert URLs、WETW_SHOP_ID。
- GATEWAY_FORWARD_TOKEN、OPENAI_API_KEY、CALENDAR_EVENTS_DB、DASHBOARD_LIFF_ID。

仍顯示 false 的項目：

- `GAS_SHARED_SECRET`
- `ALLOWED_ORIGIN`

這兩個不一定會讓系統不可用，但代表目前 CORS/Apps Script shared-secret 邊界不是完整設定狀態。

## 4. 目前功能地圖

### 登入與後台入口

- `/console`：主控台與 LINE 登入入口。
- `/dashboard?floor=main`：產品客服。
- `/dashboard?floor=admin`：行政客服。
- `/admin/smart-monitor`：康立智能監控。
- `/login`、`/api/auth/session`、`/api/auth/password-login`、`/api/auth/line-login`：登入與 session 流程。

目前程式內仍有內建帳密角色：

- `admin`：系統管理員，可看 main/admin/smart。
- `adservice`：行政客服。
- `pdservice`：產品客服。

### LINE OA 與客服

- `/line-webhook/oa1`、`/line-webhook/oa2`：新版多 channel webhook。
- `/webhook/line/main`、`/webhook/line/admin`：舊路徑相容。
- `/api/data`：dashboard 資料。
- `/api/send`：管理員手動發送 LINE 訊息。
- `/api/log-reply`：記錄回覆。
- `/api/conversation-meta`：對話狀態、標籤、備註。
- `/api/line-oa/threads`、`/api/line-oa/thread`：對話串 API。

重要設計邊界：AI 只給管理員建議，不應自動回覆終端客戶。

### AI 與知識庫

- `/api/knowledge`、`/api/knowledge/manifest`、`/api/knowledge/file`：知識庫上傳、檢視、檔案管理。
- `/api/reply-learning`、`/api/reply-learning/rebuild`：回覆學習。
- OpenAI Responses API 是目前 Worker 內分析與 JSON 修復的主要模型路徑。

### CRM 與點數

- `/admin/crm`：CRM 工具頁。
- `/admin/crm/members`、`/admin/crm/member-search`：會員查詢。
- `/admin/crm/sync-members`：同步 WETW 會員。
- `/admin/crm/sync-points`：同步 WETW 點數。
- `/admin/points/balance`、`/admin/points/ledger`：查餘額與流水。
- `/admin/points/grant`、`/admin/points/deduct`、`/admin/points/redeem`：贈點、扣點、兌換。
- `/admin/points/stats`、`/admin/points/stats-data`：點數統計。

資料表已具備 `crm_members`、`point_accounts`、`point_ledger`、`member_line_links`、`webhook_events`，代表系統已可從「聊天 UID」走向「會員與點數」的營運閉環。

### 行事曆、活動與簽到

- `/console/calendar`、`/api/calendar/events`：行事曆。
- `/api/calendar/import-image`：用圖片匯入行程。
- `/console/events`：活動視圖。
- `/checkin-template`、`/api/checkin-template`：簽到模板。
- `/api/reward/claim`、`/api/reward/calendar-events`：活動/行事曆贈點。
- `/liff/points`：點數 LIFF 頁。

### AI 穿戴

- `/ai-wear`：會員端 AI 穿戴頁。
- `/api/ai-wear-public`：公開設定與圖庫。
- `/api/ai-wear/upload-selfie`：自拍上傳。
- `/api/ai-wear/preflight`：生成前檢查。
- `/api/ai-wear/generate`：生成。
- `/api/ai-wear/member-points`：會員點數查詢。
- `/api/ai-wear-settings`、`/api/ai-wear-gallery`、`/api/ai-wear-results`：後台設定、圖庫與結果管理。

AI 穿戴目前已接 R2 保存與點數扣抵流程，不再只是展示頁。

## 5. 目前文件落差

`README.md` 與 `docs/DEPLOYMENT.md` 還停在早期三段式架構：

1. GitHub Pages dashboard。
2. Google Apps Script 分析。
3. Cloudflare Worker webhook/API。

但目前實際程式已經把大部分功能集中到 Worker。Apps Script 與 GitHub Pages 不應再被當作唯一部署主軸。文件應改成：

1. Cloudflare Worker 是主要 runtime 與頁面入口。
2. D1 是客服、AI、CRM、點數、活動資料主庫。
3. R2 是 AI 穿戴圖片保存。
4. WETW WordPress API 是會員與點數母站。
5. LINE OA channel 由 `CHANNEL_CONFIG_JSON` 或各 channel env var 管理。
6. `/console` 是管理入口，`/dashboard` 是客服操作入口。

## 6. 風險與待整理項

### 高優先

- 文件落後：README/DEPLOYMENT 會誤導部署者以為 GitHub Pages + Apps Script 是主路徑。
- CORS 邊界：`ALLOWED_ORIGIN=false`，目前現場回 `Access-Control-Allow-Origin: *`，正式營運應確認是否可接受。
- Shared secret：`GAS_SHARED_SECRET=false`，若仍有 Apps Script 互打需求，要補齊；若已不用，文件要明確降級為 legacy。
- 內建帳密：Worker 內有硬編碼帳號密碼，正式營運需要改成受控身份/雜湊/可停用機制。

### 中優先

- `worker/worker.js` 已超過單一檔案可維護範圍，客服、點數、AI 穿戴、行事曆可逐步拆模組。
- 多套前端來源並存，包含 `index.html`、`dashboard.html`、`console.html`、`frontend/index.html`，需要明確哪個是現場權威。
- Apps Script 內文與 README 使用 Gemini/OpenAI 描述混雜，容易讓維運者設定錯 secret。
- 點數與母站同步涉及真實會員資產，應補一份「只讀同步、寫回、扣點失敗回滾」的操作 SOP。

### 低優先

- `docs/MASTER_CONSOLE_PERMISSIONS.md` 是規劃文件，實作已部分落地但還沒有完整角色權限資料表。
- `frontend/src/ds_dashboard_v3.jsx` 看起來像設計/原型來源，需標記是否仍使用。

## 7. 建議下一步

1. 先更新 `README.md` 與 `docs/DEPLOYMENT.md`，把主架構改成 Worker-first。
2. 補一份 `docs/OPERATIONS.md`，寫明日常操作：登入、客服回覆、同步會員、同步點數、人工贈扣點、AI 穿戴扣點、故障檢查。
3. 補一份 `docs/ENVIRONMENT.md`，列出每個 env var 的用途、是否必填、影響功能、缺少時的降級行為。
4. 清點前端權威檔案，避免改錯 GitHub Pages 靜態頁或 Worker-served HTML。
5. 將 `worker/worker.js` 的點數、AI 穿戴、行事曆、LINE webhook 分段抽離，但每一步都要保持路由不變。

## 8. 一句話結論

目前 `fangwl591021/MLM` 已是可運作的 KLINK LINE OA 營運中台，現場 Worker 主要入口可正常回應；最大問題不是功能缺，而是文件與架構描述落後於實際程式，下一步應先把部署與操作文件改成 Worker-first，避免後續維運者照舊文件設定錯方向。
