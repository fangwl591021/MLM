# Operations Guide

更新日期：2026-06-30

本文件給日常操作、驗證與故障排查使用。正式入口以 Worker 為準：

```text
https://mlm.fangwl591021.workers.dev
```

## 1. 每日入口

| 任務 | 路徑 |
| --- | --- |
| 主控台 | `/console` |
| 產品客服 | `/dashboard?floor=main` |
| 行政客服 | `/dashboard?floor=admin` |
| 康立智能監控 | `/admin/smart-monitor` |
| CRM / K 點工具 | `/admin/crm` |
| K 點統計 | `/admin/points/stats` |
| 行事曆 | `/console/calendar` |
| 活動與簽到 | `/console/events` |
| AI 穿戴設定 | `/console/ai-wear` |
| AI 穿戴會員端 | `/ai-wear` |

## 2. 健康檢查

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
```

重點看：

- `DB=true`
- `DASHBOARD_API_TOKEN=true`
- `ADMIN_TOKEN=true`
- `CHANNEL_CONFIG_JSON=true`
- `OPENAI_API_KEY=true`
- `POINT_API_KEY=true`
- `WETW_MEMBERS_URL=true`
- `WETW_POINTS_URL=true`
- `WETW_POINT_INSERT_URL=true`
- `WETW_SHOP_ID=true`
- `DASHBOARD_LIFF_ID=true`

若 `ALLOWED_ORIGIN=false`，正式營運要確認 CORS 開放範圍是否可接受。

若 `GAS_SHARED_SECRET=false`，先確認 Apps Script 是否仍是正式流程的一部分；若是，要補 secret。

## 3. LINE OA 收訊檢查

LINE Developers webhook URL 優先使用：

```text
OA1：https://mlm.fangwl591021.workers.dev/line-webhook/oa1
OA2：https://mlm.fangwl591021.workers.dev/line-webhook/oa2
```

若後台看不到新訊息，先分三層查：

1. LINE webhook 是否打到 Worker。
2. `webhook_events` 是否有寫入。
3. `threads` / `messages` 是否有寫入並被 `/api/data` 讀出。

D1 方向的快速檢查：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT channel_key,line_user_id,event_type,message_text,received_at FROM webhook_events ORDER BY id DESC LIMIT 10;"
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT floor_id,user_id,status,risk,last_message_at FROM threads ORDER BY updated_at DESC LIMIT 10;"
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT floor_id,user_id,sender_role,text,created_at FROM messages ORDER BY created_at DESC LIMIT 10;"
```

注意：`messages.created_at` 多半是 LINE event timestamp，不等於 Worker 實際收到時間。要看 ingress 延遲時，用 `webhook_events.line_timestamp` 和 `webhook_events.received_at`。

## 4. 客服回覆原則

- AI 建議只給管理員參考。
- 系統不應自動把 AI 建議推給客戶。
- 管理員在客服頁送出後，Worker 才呼叫 LINE push API。
- 回覆後應寫入 `messages`，並更新 thread 狀態或最後訊息時間。

## 5. CRM 同步

打開：

```text
https://mlm.fangwl591021.workers.dev/admin/crm
```

常用流程：

1. 輸入 `ADMIN_TOKEN` 或 `DASHBOARD_API_TOKEN`。
2. 按「同步會員」。
3. 按「同步點數」。
4. 搜尋會員或 LINE UID。

API 方式：

```powershell
curl.exe -H "Authorization: Bearer <ADMIN_TOKEN>" https://mlm.fangwl591021.workers.dev/admin/crm/members
curl.exe -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{}" https://mlm.fangwl591021.workers.dev/admin/crm/sync-members
curl.exe -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{}" https://mlm.fangwl591021.workers.dev/admin/crm/sync-points
```

## 6. K 點操作

查餘額：

```powershell
curl.exe -H "Authorization: Bearer <ADMIN_TOKEN>" "https://mlm.fangwl591021.workers.dev/admin/points/balance?channel_key=oa1&line_user_id=<LINE_UID>"
```

查流水：

```powershell
curl.exe -H "Authorization: Bearer <ADMIN_TOKEN>" "https://mlm.fangwl591021.workers.dev/admin/points/ledger?channel_key=oa1&line_user_id=<LINE_UID>"
```

贈點/扣點必須留下操作人：

```json
{
  "channel_key": "oa1",
  "line_user_id": "Uxxxxxxxx",
  "point_type": "gift_money",
  "points": 10,
  "note": "客服補點",
  "operator_name": "操作人姓名",
  "operator_id": "operator-id"
}
```

正式操作原則：

- 母站寫回成功後，才算本地 ledger 成功。
- 扣點前先查餘額。
- `oa1` 可贈點與扣點。
- `oa2` 只允許扣點，不應作為贈點來源。
- `gift_money` 是後台顯示的 K 點主餘額，`system_point` 不要與 K 點加總。

## 7. 行事曆與簽到

行事曆入口：`/console/calendar`

API：

```text
GET /api/calendar/events
POST /api/calendar/events
DELETE /api/calendar/events
POST /api/calendar/import-image
```

活動/簽到入口：

```text
/console/events
/checkin-template
```

若簽到成功但點數沒進，先查：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT * FROM reward_claims ORDER BY created_at DESC LIMIT 10;"
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT * FROM point_ledger ORDER BY created_at DESC LIMIT 10;"
```

## 8. AI 穿戴

後台設定：`/console/ai-wear`

會員端：`/ai-wear`

主要檢查：

- `AI_WEAR_BUCKET` R2 binding 是否存在。
- `OPENAI_API_KEY` 或 image2 provider 是否正確。
- AI 穿戴設定內 API URL / model / prompt 是否合理。
- 點數扣抵設定是否啟用。
- 會員 LINE Login 是否取得 UID。

生成失敗常見原因：

- image2 API key 錯誤。
- OpenAI 圖片功能地區/帳務/模型權限限制。
- R2 bucket 未設定，無法保存結果。
- 會員未登入，無法扣點。

## 9. 部署後 smoke test

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
curl.exe -I https://mlm.fangwl591021.workers.dev/console
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=main"
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=admin"
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/crm
curl.exe -I https://mlm.fangwl591021.workers.dev/ai-wear
```

如果頁面 200 但畫面仍舊，優先確認：

- 目前實際服務來源是 Worker-served HTML 還是 GitHub Pages。
- Worker 是否有快取或前端 build id。
- 瀏覽器 sessionStorage/localStorage 是否保留舊登入狀態。

## 10. 事故處理優先順序

1. 客服訊息收不到：先查 webhook route、`webhook_events`、`messages`。
2. 後台登入失敗：查 `/api/auth/session`、`DASHBOARD_LIFF_ID`、內建帳密/session cookie。
3. 點數異常：先查母站 API 回應，再查本地 `point_ledger`，不要只看畫面。
4. AI 建議失敗：查 `OPENAI_API_KEY`、API error、知識庫內容。
5. AI 穿戴失敗：查 image provider、R2、會員 UID、扣點 preflight。
