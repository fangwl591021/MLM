# MLM Worker Batch A：模組化 Staging 入口

## 目的

驗證「新 Router + Legacy fallback」架構，不修改正式 `worker/worker.js`，也不變更正式 `wrangler.toml`。

## 新增檔案

- `src/index.js`：staging 專用入口。
- `src/router/router.js`：極簡 Router。
- `src/modules/system/system.routes.js`：低風險測試路由。
- `src/legacy/legacy-fetch.js`：未遷移路由轉交原 Worker。
- `wrangler.staging.toml`：獨立 staging 設定範本。

## 目前接管路由

- `GET /health-modular`
- `GET /calendar-modular`

刻意使用新路徑，避免在尚未完成契約比對前覆蓋正式 `/health` 與 `/calendar`。

## Legacy fallback

除上述兩條路由外，所有請求都轉交：

```text
worker/worker.js → default export.fetch(request, env, ctx)
```

因此現有 LINE Webhook、登入、點數、報到、客服及 AI 試戴邏輯皆未搬移。

## 回應識別

staging 入口增加：

- `x-mlm-request-id`
- `x-mlm-router: modular | legacy`
- `server-timing`

用於比較新舊 Router，不改變 JSON body。

## 部署前必要條件

1. 建立獨立 `mlm_staging` D1。
2. 建立獨立 staging R2 bucket。
3. 使用測試 LINE OA、測試 LIFF 與測試 API Key。
4. WordPress 點數 API 必須指向 sandbox 或完全停用。
5. 將 `wrangler.staging.toml` 的 placeholder D1 ID 換成測試資源。

## 驗收

- `/health-modular` 回傳 200，且 header 為 `x-mlm-router: modular`。
- `/calendar-modular` 302 到 `/console/calendar`。
- `/health`、`/dashboard` 等舊路徑仍由 `legacy` 處理。
- 未部署 staging 前，不合併、不修改正式入口。
