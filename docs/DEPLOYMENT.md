# Deployment Checklist

更新日期：2026-06-30

目前部署主軸是 Cloudflare Worker `mlm`。GitHub Pages 與 Apps Script 仍可保留為舊版/補充流程，但正式入口應以 Worker-served pages 為準。

## 1. 部署目標

| 目標 | 狀態 | 用途 |
| --- | --- | --- |
| Cloudflare Worker `mlm` | 主要 | 後台頁面、API、LINE webhook、AI、CRM、點數、行事曆、AI 穿戴。 |
| Cloudflare D1 `mlm_line_oa` | 主要 | 客服、訊息、知識庫、CRM、點數、活動資料。 |
| Cloudflare R2 `k-linksaas-images` | 主要 | AI 穿戴參考圖、自拍、生成結果。 |
| Google Apps Script | 補充/legacy | 舊版 Sheets、Telegram、AI 分析流程。 |
| GitHub Pages | 補充/legacy | 早期 dashboard 靜態頁，不應當作正式唯一入口。 |

## 2. Worker 設定

`wrangler.toml` 目前設定：

```toml
name = "mlm"
main = "worker/worker.js"
compatibility_date = "2026-05-06"
```

D1 binding：

```toml
[[d1_databases]]
binding = "DB"
database_name = "mlm_line_oa"
database_id = "319f701f-e60e-46f1-b62a-48e44102bf79"
```

R2 binding：

```toml
[[r2_buckets]]
binding = "AI_WEAR_BUCKET"
bucket_name = "k-linksaas-images"
```

## 3. D1 初始化 / 遷移

至少需要套用：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --file worker\schema.sql
npx.cmd wrangler d1 execute mlm_line_oa --remote --file worker\point-gateway.sql
```

如有後續 migration，依實際功能再套用：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --file worker\multi-floor-migration.sql
npx.cmd wrangler d1 execute mlm_line_oa --remote --file worker\admin-console-permissions.sql
```

## 4. 必要 secrets / variables

完整說明見 `docs/ENVIRONMENT.md`。最少需要：

```text
DASHBOARD_API_TOKEN
ADMIN_TOKEN
CHANNEL_CONFIG_JSON
OPENAI_API_KEY
POINT_API_KEY
WETW_MEMBERS_URL
WETW_POINTS_URL
WETW_POINT_INSERT_URL
WETW_SHOP_ID
DASHBOARD_LIFF_ID
```

LINE fallback secrets：

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_ADMIN_CHANNEL_SECRET
LINE_ADMIN_CHANNEL_ACCESS_TOKEN
LINE_OA1_CHANNEL_ACCESS_TOKEN
LINE_OA2_CHANNEL_ACCESS_TOKEN
```

建議補齊：

```text
ALLOWED_ORIGIN=https://mlm.fangwl591021.workers.dev
GAS_SHARED_SECRET
```

若不再使用 Apps Script，`GAS_SHARED_SECRET` 可以保留未設定，但文件要明確標示 Apps Script 為 legacy。

## 5. Webhook URL

新版多 channel 路徑：

```text
OA1 產品客服：https://mlm.fangwl591021.workers.dev/line-webhook/oa1
OA2 行政客服：https://mlm.fangwl591021.workers.dev/line-webhook/oa2
```

舊路徑仍相容：

```text
https://mlm.fangwl591021.workers.dev/webhook/line/main
https://mlm.fangwl591021.workers.dev/webhook/line/admin
```

設定 LINE Developers 時，優先使用新版 `/line-webhook/{channel_key}`。

## 6. 部署前檢查

```powershell
node --check worker\worker.js
git status --short
rg -n "/console|/dashboard|/api/data|/api/send" console.html dashboard.html index.html
```

## 7. 部署

```powershell
npx.cmd wrangler deploy
```

部署完成後確認 Worker 版本已生效：

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
```

## 8. 部署後驗證

```powershell
curl.exe -I https://mlm.fangwl591021.workers.dev/console
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=main"
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=admin"
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/smart-monitor
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/crm
curl.exe -I https://mlm.fangwl591021.workers.dev/ai-wear
```

需要登入或 token 的 JSON API，不要只看 HTTP status。要用管理 token 實測：

```powershell
curl.exe -H "Authorization: Bearer <ADMIN_TOKEN>" https://mlm.fangwl591021.workers.dev/admin/crm/members
curl.exe -H "Authorization: Bearer <ADMIN_TOKEN>" https://mlm.fangwl591021.workers.dev/admin/points/stats-data
```

## 9. 行為保證

- LINE webhook 不應自動把 AI 建議回覆給客戶。
- AI 建議只顯示給管理員。
- 重要訊息可寫入 AI log 並觸發通知流程。
- LINE push 只能由管理員操作或明確的活動/簽到規則觸發。
- 點數寫回母站失敗時，不應先寫入本地成功 ledger。
