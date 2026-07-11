# 康立 AI 桌面 Phase 2：Worker 整合方式

本批次新增：

- `worker/executive-api.js`
- `docs/executive-v2.html`

## 1. 在 `worker/worker.js` 最上方加入

```js
import { handleExecutiveApi } from "./executive-api.js";
```

## 2. 將高層頁面加入前端路由

在既有 `/console`、`/dashboard` 頁面路由附近加入：

```js
if ((url.pathname === "/executive" || url.pathname === "/executive.html") &&
    (request.method === "GET" || request.method === "HEAD")) {
  const session = await verifyConsoleSession(request, env);
  if (!session.ok || !session.profile.admin) {
    return Response.redirect(`${url.origin}/login?next=${encodeURIComponent("/executive")}`, 302);
  }
  return serveFrontendAsset("docs/executive-v2.html", corsHeaders);
}
```

若 `serveFrontendAsset()` 無法讀取 `docs/`，可改用目前專案既有的：

```js
return serveFrontendHtml("executive-v2.html", corsHeaders);
```

並將檔案移至前端 HTML 所在目錄。

## 3. 在認證完成後加入 API Router

應放在 `verifyConsoleSession()` 可使用、但一般 dashboard floor routing 之前：

```js
if (url.pathname.startsWith("/api/executive/")) {
  const session = await verifyConsoleSession(request, env);
  const executiveResponse = await handleExecutiveApi({
    request,
    env,
    url,
    session,
    corsHeaders,
  });
  if (executiveResponse) return executiveResponse;
}
```

這樣可避免高層 API 被客服樓層權限誤判。

## 4. 部署 D1 migration

測試環境：

```bash
npx wrangler d1 migrations apply mlm_line_oa --local
```

正式環境：

```bash
npx wrangler d1 migrations apply mlm_line_oa --remote
```

若目前專案不是 Wrangler 標準 migration 目錄，直接執行：

```bash
npx wrangler d1 execute mlm_line_oa --remote \
  --file=migrations/20260711_ai_desktop_phase1.sql
```

## 5. API 清單

### 高層摘要

```http
GET /api/executive/summary?days=30
```

回傳：

- `kpis`
- `morning_brief`
- `risks`
- `opportunities`
- `data_sources`
- `raw`

### 高層洞察

```http
GET /api/executive/insights?limit=30
```

### 任務

```http
GET /api/executive/tasks
POST /api/executive/tasks
```

POST 範例：

```json
{
  "title": "確認獎金制度重複詢問原因",
  "description": "整理近 30 天相關訊息並提出統一說明",
  "owner_department": "行政部",
  "priority": "high",
  "due_at": "2026-07-15T18:00:00+08:00",
  "source_type": "executive_insight",
  "source_id": "insight_xxx"
}
```

### 決策

```http
GET /api/executive/decisions
POST /api/executive/decisions
```

POST 範例：

```json
{
  "title": "建立獎金制度統一說明頁",
  "decision_text": "由行政部在七日內完成，並同步 LINE OA 知識庫。",
  "rationale": "近期會員重複詢問增加。",
  "expected_outcome": "降低同類問題 30%",
  "review_at": "2026-08-01T10:00:00+08:00"
}
```

### 高層問答

```http
POST /api/executive/ask
```

```json
{
  "question": "今天最需要注意什麼？"
}
```

目前為規則引擎，先確保答案可追溯且不產生幻覺。後續再接 OpenAI／Gemini Agent。

## 6. 資料接入策略

`executive-api.js` 會先讀取 `sqlite_master` 與 `PRAGMA table_info`，辨識目前 D1 中可能存在的資料表與時間欄位。

支援候選表名：

- 訊息：`messages`、`line_messages`、`chat_messages`
- 活動：`calendar_events`、`events`
- 報到：`checkins`、`reward_checkins`、`attendance_records`
- 點數：`point_logs`、`points_log`、`reward_logs`、`point_transactions`
- AI 試戴：`ai_wear_results`、`ai_wear_generations`、`ai_wear_usage`
- AI 成本：`ai_wear_cost_logs`、`ai_usage_costs`

未辨識到的來源會回傳 0 並從 `data_sources` 缺席，不會用推測值填補。

## 7. 驗收清單

1. 管理員登入後可開啟 `/executive`。
2. 非管理員無法讀取 `/api/executive/*`。
3. 未部署 migration 時，API 清楚回報缺少資料表。
4. 部署後可建立任務與決策。
5. 高層問答會寫入 `audit_logs`。
6. 原 `/console`、`/dashboard`、活動、點數與 AI 試戴功能不受影響。
7. 所有高層數字均能在 `data_sources` 或 `raw` 中找到依據。
