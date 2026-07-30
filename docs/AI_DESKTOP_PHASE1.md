# 康立 AI 智慧營運桌面

## 目標

在不破壞既有 LINE 客服、活動、點數與 AI 試戴功能的前提下，將 MLM 後台升級為高層可直接使用的 AI 營運桌面。

## Phase 1 已完成

- 建立高層桌面 UI 骨架。
- 建立 `business_events`、`executive_insights`、`tasks`、`decisions`、`audit_logs`。
- 先以既有 `/api/console/summary` 驗證資料可視化方向。
- 所有功能只讀，不影響正式資料。

## Phase 2 已完成的程式骨架

- 新增 `worker/executive-api.js`，將高層 API 從巨型 Worker 中獨立。
- 新增 `docs/executive-v2.html`，改接 `/api/executive/*`。
- 建立以下 API：
  - `GET /api/executive/summary`
  - `GET /api/executive/insights`
  - `GET/POST /api/executive/tasks`
  - `GET/POST /api/executive/decisions`
  - `POST /api/executive/ask`
- 加入資料表與欄位自動辨識，容許現有 D1 表名差異。
- 未串接資料明確顯示為 0／未連接，不產生推測數字。
- 高層問答先採規則引擎，確保答案可追溯。
- 任務、決策與高層問答加入稽核紀錄。

## 待整合到 `worker.js`

因現有 `worker.js` 同時負責 LINE、點數、行事曆、報到、AI 試戴、登入與前端路由，Phase 2 採獨立模組方式建立，正式接入時只需：

1. 匯入 `handleExecutiveApi`。
2. 新增 `/executive` 頁面路由。
3. 在客服 floor routing 前加入 `/api/executive/*` Router。
4. 在測試 D1 執行 migration。

完整片段見 `docs/AI_DESKTOP_PHASE2_INTEGRATION.md`。

## 資料來源策略

第一批整合現有系統已掌握的資料：

- LINE／客服互動。
- 重要訊息與客訴。
- 行事曆與報到。
- 點數異動。
- AI 眼鏡試戴。
- AI 使用成本。
- 高層任務與決策。

第二批再串接康立其他正式系統：

- 經銷商組織。
- 銷售與訂單。
- 商品、退貨與庫存。
- 獎金與晉升。
- 區域營運數據。

## AI 架構

目前：

```text
高層問題
  ↓
規則引擎
  ↓
可追溯 KPI／資料來源
```

下一階段：

```text
高層問題
  ↓
AI Router
  ├─ 客服 Agent
  ├─ 活動 Agent
  ├─ 點數 Agent
  ├─ AI 試戴 Agent
  ├─ 會員 Agent
  └─ 高層決策 Agent
```

模型不能直接任意查詢或修改正式資料；所有操作需透過白名單 API、角色權限與 audit log。

## 上線順序

1. 測試 D1 執行 migration。
2. 接入 `executive-api.js`。
3. 僅開放系統管理員測試 `/executive`。
4. 驗證所有 KPI 的資料來源。
5. 測試建立任務、決策與問答稽核。
6. 再開放康立指定高層帳號。
7. 最後才導入生成式 AI Agent。

## 驗收原則

- 不影響既有客服與 LINE webhook。
- 不影響活動、點數與 AI 試戴。
- 高層看到的每個數字都能追溯來源。
- 未接入資料不得用猜測值補足。
- 所有寫入行為都有權限控管及稽核。
- 高層桌面首先解決「今天發生什麼、為什麼、該做什麼、誰負責」。
