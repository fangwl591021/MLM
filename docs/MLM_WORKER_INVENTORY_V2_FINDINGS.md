# MLM Worker Inventory V2：盤點結果與第一批安全重構清單

## 1. 執行結果

GitHub Actions `MLM Worker Inventory` 已成功完成 V2 AST 掃描。

- 原始檔：`worker/worker.js`
- 行數：10,236
- 大小：約 528 KB
- 路由：113
- 函式／方法：634
- 環境變數／Bindings：61
- SQL `prepare()`：240
- 外部 `fetch()`：25
- R2／儲存操作：4
- 函式依賴邊：1,206
- 高風險路由：47
- Parser：Acorn AST

## 2. V1 / V2 差異

V2 修正了 V1 的主要誤判：

- 函式數由 766 降至 634，排除把內嵌 HTML／JavaScript 與控制語句誤判成 Worker 函式。
- 最長函式回到合理範圍；主 `fetch` handler 為約 784 行。
- SQL 由 237 修正為 240。
- R2 操作由 0 修正為 4。
- 函式依賴邊由 1,525 修正為 1,206。

## 3. 主要複雜度熱點

### 3.1 主 fetch handler

- 範圍：約第 108～891 行
- 約 784 行
- 同時承載 113 條路由的入口判斷
- 所有路由在盤點中暫時顯示為 `<anonymous@108>`，代表下一階段需要建立 Route Registry，才能把每條路由映射到實際 handler

### 3.2 最長業務函式

| 函式 | 行數 | SQL | 主要風險 |
|---|---:|---:|---|
| `rewardCompactNfcLiffHtml` | 181 | 0 | 大型 HTML 內嵌、NFC 流程 |
| `pointsTallLiffHtml` | 153 | 0 | 大型 HTML 內嵌、點數身份 |
| `crmAdminToolHtml` | 149 | 0 | 大型管理頁內嵌 |
| `saveAiWearResult` | 143 | 4 | AI 試戴結果與儲存 |
| `listPointDailyStats` | 127 | 4 | 點數統計 |
| `saveIncomingMessage` | 127 | 6 | LINE 訊息主要寫入 |
| `resolvePointIdentity` | 116 | 5 | 點數身份解析 |
| `listSmartMonitorData` | 107 | 5 | 管理監看資料 |
| `ensureAiWearSchema` | 100 | 11 | 執行時 Schema 建立 |
| `generateAiWearImage` | 98 | 2 | OpenAI、成本、圖片、點數 |

## 4. 已確認 R2 操作

| 函式 | 操作 | Binding |
|---|---|---|
| `storeAiWearGeneratedResult` | put | `env.AI_WEAR_BUCKET` |
| `createAiWearShare` | put | `env.AI_WEAR_BUCKET` |
| `serveAiWearShareImage` | get | `env.AI_WEAR_BUCKET` |
| `serveAiWearResultImage` | get | `env.AI_WEAR_BUCKET` |

R2 目前集中在 AI 試戴結果與分享圖片，邊界相對清楚。

## 5. 已確認外部服務呼叫

### LINE

- ID Token 驗證
- Push Message
- Reply Message
- Bot Info
- Profile

### WordPress／點數

- 點數插入
- 會員建立或確認
- 會員清單
- 點數清單

### AI

- OpenAI 文字／圖片 API
- AI 試戴 Image API
- 模型診斷
- 行事曆圖片辨識與 JSON 修復

### 其他

- GAS 備援
- GitHub Raw／GitHub API 前端檔案載入
- 地理編碼

## 6. 風險分類修正

V2 的自動風險分數只能作為提示，不能直接將 `low` 視為可安全搬移。例如下列路由雖被規則標記為低風險，實際上仍屬高風險：

- `POST /api/send`
- `POST /api/calendar/events`
- `DELETE /api/calendar/events`
- `POST /api/migrate-gas-to-d1`
- `POST /api/knowledge/file`
- `POST /api/ai-wear-results`

原因是目前 heuristic 對 route 名稱與 HTTP method 的加權仍不足。後續應新增：

- 非 GET／HEAD 一律至少中風險
- 包含 `send`、`sync`、`migrate`、`backfill`、`repair`、`delete`、`upload`、`generate` 一律提升風險
- 函式內有 SQL `INSERT/UPDATE/DELETE`、外部 fetch、R2 put/delete 時提升風險
- 涉及 LINE Push、點數、身份、登入、Webhook、報到時列為高或極高

## 7. 第一批可安全重構清單

### Batch A：純系統與靜態讀取

建議第一個正式重構 PR 只處理以下內容：

1. `GET /health`
2. `GET /docs/*`
3. `GET /knowledge-base`
4. `GET /knowledge-base.html`
5. `GET /calendar` 的 redirect
6. 前端靜態資源讀取 helper

限制：

- 不修改回應格式
- 不修改 CORS
- 不改 GitHub Raw 載入策略
- 不引入新資料表
- 不碰 Session、LINE、點數、AI 試戴生成

### Batch B：唯讀摘要 API

在 Batch A 通過後再處理：

1. `GET /api/console/summary`
2. `GET /api/calendar/events`
3. `GET /api/knowledge/manifest`
4. `GET /api/knowledge/file`
5. `GET /api/ai-wear-public`
6. `GET /api/ai-wear-gallery`
7. `GET /api/ai-wear-results`
8. `GET /api/ai-wear-cost-summary`
9. `GET /api/line-oa/threads`
10. `GET /api/line-oa/thread`

限制：

- 只抽 Route、Controller、Repository，不改 SQL
- 新舊結果使用 snapshot 比對
- 先 Shadow Read，不直接切換正式回應

### Batch C：大型 HTML 產生器

第三批可抽離但不改功能：

- `rewardCompactNfcLiffHtml`
- `pointsTallLiffHtml`
- `crmAdminToolHtml`
- 登入頁、點數頁、NFC 說明頁等 HTML generator

目標：

- 從 Worker 主檔移到 `frontend-generators/`
- 僅搬移字串與模板，不改 UI、不改 JavaScript 行為
- 建立輸出快照測試，確保 HTML byte-level 或 normalized output 一致

## 8. 暫時禁止重構區域

以下區域在測試、安全網與 Route Registry 完成前禁止搬動：

- `/webhook/line*`
- `/api/reward/claim`
- `/admin/points/grant`
- `/admin/points/deduct`
- `/admin/points/redeem`
- 點數 backfill／repair
- NFC／QR 報到
- Password Login／LINE Login／Session Cookie
- `saveIncomingMessage`
- `resolvePointIdentity`
- `processPointWebhook`
- `claimQrReward`
- `generateAiWearImage`
- AI 試戴扣點與成本控制
- GAS → D1 migration

## 9. 第一個重構 PR 建議範圍

名稱：`refactor: extract health and static document routes`

只包含：

- 建立 `src/router/` 最小 Router
- 建立 `src/modules/system/health.routes.js`
- 建立 `src/modules/static/static.routes.js`
- 建立 `src/legacy/legacy-fetch.js`
- 其餘 100+ 路由全部 fallback 至 legacy handler
- Characterization tests：`/health`、`/docs/*`、`/knowledge-base`

禁止同時做：

- 修改 wrangler bindings
- 修改正式 API response
- 拆 D1 Repository
- 重做 UI
- 更改登入流程
- 更改 Worker 部署名稱

## 10. 驗收條件

- Worker 正式入口 URL 不變
- `/health` 的 status、headers、body 與舊版一致
- `/docs/*` 的內容與 cache headers 一致
- 未命中新 Router 的請求 100% 落回 legacy handler
- LINE Webhook、點數、報到、AI 試戴沒有任何 diff
- CI 同時跑 Inventory V2 與 characterization tests
- 可用單一 commit 回滾

## 11. 下一步

先改善 V2 risk scoring，加入 SQL／fetch／storage 與 method-aware 評分，再建立第一批 characterization tests。完成後才開始第一個低風險重構 PR。
