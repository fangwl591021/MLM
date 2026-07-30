# MLM Modular Staging 部署手冊

> 本文件只適用測試環境。禁止直接套用正式 D1、R2、LINE OA、WordPress 點數或正式 Secrets。

## 1. 建立獨立資源

```bash
npx wrangler d1 create mlm_staging
npx wrangler r2 bucket create k-linksaas-images-staging
```

將 D1 建立後回傳的 `database_id` 填入 `wrangler.staging.toml`。

## 2. 安全檢查

```bash
node tools/staging-preflight.mjs wrangler.staging.toml
node --test tests/modular-router.test.mjs
```

Preflight 不允許：

- Worker 名稱未含 `staging`
- D1 名稱未含 `staging`
- R2 名稱未含 `staging`
- main 未指向 `src/index.js`
- 出現正式資源名稱

## 3. 測試 Secrets

只設定測試用值。第一輪不需設定 LINE、OpenAI、WordPress 或 GAS 正式金鑰。

```bash
npx wrangler secret put STAGING_MARKER --config wrangler.staging.toml
```

## 4. 預覽部署

先執行 dry-run：

```bash
npx wrangler deploy --dry-run --config wrangler.staging.toml
```

確認打包入口為 `src/index.js`，且 bindings 全部是 staging 資源。

## 5. 正式部署 staging

```bash
npx wrangler deploy --config wrangler.staging.toml
```

此動作只能由人工在已登入 Cloudflare 的受控環境執行。GitHub Actions 目前不自動部署。

## 6. 驗收

```bash
curl -i https://<staging-worker>.workers.dev/health-modular
curl -i https://<staging-worker>.workers.dev/calendar-modular
curl -i https://<staging-worker>.workers.dev/health
```

預期：

- `/health-modular`：`x-mlm-router: modular`
- `/calendar-modular`：302 並帶 `x-mlm-router: modular`
- `/health`：仍走 Legacy，帶 `x-mlm-router: legacy`
- 所有回應都有 `x-mlm-request-id`

## 7. 禁止測試

第一輪 staging 禁止執行：

- LINE Webhook 寫入
- 點數贈送、扣除、修復、回填
- QR／NFC 報到
- AI 試戴生成與會員扣點
- 正式 LINE Login
- 正式 WordPress 點數 API

## 8. 回滾

若 staging 新入口異常：

1. 不修改正式 Worker。
2. 將 staging `main` 暫時改回 `worker/worker.js`，或刪除 staging Worker。
3. 保留 D1／R2 staging 資源供調查。
4. 使用 request ID 與 `x-mlm-router` 追蹤錯誤來源。
