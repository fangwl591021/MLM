# 康立 AI 智慧營運桌面｜Phase 1

## 目標

在不影響既有 LINE 客服、活動報到、點數與 AI 眼鏡試戴功能的前提下，新增高層可使用的統一營運入口，並建立後續 AI Agent、任務交辦與決策追蹤所需的資料基礎。

## 本階段新增

### 1. 高層桌面入口

路徑：`/docs/executive.html`

目前功能：

- 驗證既有管理員 Session。
- 讀取 `/api/console/summary`。
- 顯示五類核心指標：會員互動、重要訊息、活動報到、點數異動、AI 使用。
- 產生規則式高層晨報。
- 顯示風險與機會。
- 提供不寫入資料的初步問答框。
- 顯示資料快照，方便核對 AI 摘要依據。
- 可快速返回原營運控制台、客服、活動及 AI 試戴模組。

> 此頁目前是 Phase 1 骨架。只讀取既有摘要 API，不會修改正式資料。

### 2. 四個核心資料模組

Migration：`migrations/20260711_ai_desktop_phase1.sql`

- `business_events`：統一收納 LINE、活動、報到、點數、AI 試戴及其他營運事件。
- `executive_insights`：保存每日晨報、風險、機會與建議。
- `tasks`：將 AI 建議或高層指示轉成可追蹤任務。
- `decisions`：保存決策內容、依據、預期成果與檢討日期。

另加入：

- `decision_tasks`：決策與任務關聯。
- `audit_logs`：記錄高層查詢、交辦與敏感操作。

## 建議部署順序

1. 在測試 D1 執行 migration。
2. 部署目前分支到測試 Worker。
3. 管理員登入後開啟 `/docs/executive.html`。
4. 檢查 `/api/console/summary` 回傳欄位，確認五類指標映射。
5. 確認既有 `/console`、`/dashboard`、活動與 AI 試戴功能皆正常。
6. 通過測試後再合併至正式環境。

## 下一個開發批次

### A. 正式摘要 API

新增：

- `GET /api/executive/overview`
- `GET /api/executive/insights`
- `POST /api/executive/ask`

回傳需包含：

- 統計期間與最後更新時間。
- KPI 數值及比較基準。
- 風險嚴重度。
- 資料來源與查詢條件。
- 建議行動。

### B. 統一事件寫入

將以下事件同步寫入 `business_events`：

- LINE 新訊息、重要訊息與客服結案。
- 活動建立、報名、報到與未到。
- 點數發放、扣除與異常。
- AI 眼鏡試戴生成、分享、成本與失敗。
- 管理員重要操作。

### C. 任務與決策 API

新增：

- `POST /api/tasks`
- `PATCH /api/tasks/:taskId`
- `GET /api/tasks`
- `POST /api/decisions`
- `GET /api/decisions`

### D. AI Router

第一批 Agent：

- 客服 Agent
- 活動 Agent
- 點數 Agent
- AI 試戴 Agent
- 營運分析 Agent
- 高層決策 Agent

每一個 AI 回答必須回傳資料來源，不允許直接修改正式資料；有寫入需求時，必須經過權限確認及稽核記錄。

## 驗收條件

- 高層桌面能在管理員登入狀態下開啟。
- 未登入者會被導向登入頁。
- 既有摘要 API 失敗時，頁面顯示錯誤但不影響其他模組。
- Migration 可重複執行，不會因資料表已存在而中斷。
- 不在前端或 migration 寫入任何正式 Token、密碼或 API Key。
