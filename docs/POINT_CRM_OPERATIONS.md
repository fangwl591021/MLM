# KLINK CRM / 點數模組操作表

## 目前狀態

Worker 已有路由，D1 已有表，GitHub 已推送。

可直接打開：

- `https://mlm.fangwl591021.workers.dev/admin/crm`

目前 `/health` 仍會顯示以下項目為 `false`，代表尚未接母站：

- `ADMIN_TOKEN`
- `CHANNEL_CONFIG_JSON`
- `POINT_API_KEY`
- `WETW_MEMBERS_URL`
- `WETW_POINTS_URL`
- `WETW_SHOP_ID`

`ADMIN_TOKEN` 不是必填，因為管理 API 會 fallback 使用既有 `DASHBOARD_API_TOKEN`。

## Cloudflare 變數建議

在 PowerShell 執行：

```powershell
cd "D:\OneDrive\文件\New project 2"
```

設定管理 Token：

```powershell
npx.cmd wrangler secret put ADMIN_TOKEN --name mlm
```

設定母站 API Key：

```powershell
npx.cmd wrangler secret put POINT_API_KEY --name mlm
```

設定母站會員 API：

```powershell
npx.cmd wrangler secret put WETW_MEMBERS_URL --name mlm
```

貼入：

```text
https://k-link.cc/index.php/wp-json/wetw/v1/query-line-user-list
```

設定店家 ID：

```powershell
npx.cmd wrangler secret put WETW_SHOP_ID --name mlm
```

貼入：

```text
216
```

設定母站點數 API：

```powershell
npx.cmd wrangler secret put WETW_POINTS_URL --name mlm
```

貼入：

```text
https://k-link.cc/index.php/wp-json/wetw-point/v1/query-user-point-list
```

設定母站新增點數 API：

```powershell
npx.cmd wrangler secret put WETW_POINT_INSERT_URL --name mlm
```

貼入：

```text
https://k-link.cc/index.php/wp-json/wetw-point/v1/insert-user-point
```

設定 OA1 / OA2 詳細設定：

```powershell
npx.cmd wrangler secret put CHANNEL_CONFIG_JSON --name mlm
```

`CHANNEL_CONFIG_JSON` 建議內容：

```json
{
  "oa1": {
    "label": "OA1 產品客服",
    "floor": "main",
    "channelSecret": "OA1 的 Channel Secret",
    "channelAccessToken": "OA1 的 Channel Access Token"
  },
  "oa2": {
    "label": "OA2 行政客服",
    "floor": "admin",
    "channelSecret": "OA2 的 Channel Secret",
    "channelAccessToken": "OA2 的 Channel Access Token"
  }
}
```

如果不設定 `CHANNEL_CONFIG_JSON`，目前 Worker 會 fallback：

- `oa1` 使用 `LINE_MAIN_CHANNEL_SECRET` / `LINE_MAIN_CHANNEL_ACCESS_TOKEN`，再 fallback 舊的 `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`
- `oa2` 使用 `LINE_ADMIN_CHANNEL_SECRET` / `LINE_ADMIN_CHANNEL_ACCESS_TOKEN`

## LINE Webhook URL

OA1 產品客服：

```text
https://mlm.fangwl591021.workers.dev/line-webhook/oa1
```

OA2 行政客服：

```text
https://mlm.fangwl591021.workers.dev/line-webhook/oa2
```

## 驗證指令

健康檢查：

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
```

開 CRM 工具頁：

```powershell
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/crm
```

確認資料表：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT COUNT(*) AS crm_members FROM crm_members; SELECT COUNT(*) AS point_accounts FROM point_accounts; SELECT COUNT(*) AS point_ledger FROM point_ledger;"
```

## 不動母站的測試方式

先用 POST body 匯入一筆測試會員，不會呼叫母站：

```powershell
$token = "你的 Dashboard Token 或 ADMIN_TOKEN"
$body = @{
  members = @(
    @{
      member_ref = "TEST001"
      name = "測試會員"
      phone = "0900000000"
      email = "test@example.com"
      level = "VIP"
    }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "https://mlm.fangwl591021.workers.dev/admin/crm/sync-members" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body
```

查會員：

```powershell
Invoke-RestMethod -Uri "https://mlm.fangwl591021.workers.dev/admin/crm/members" -Headers @{ Authorization = "Bearer $token" }
```

測試贈點：

```powershell
$pointBody = @{
  channel_key = "oa1"
  line_user_id = "U_TEST_LINE_ID"
  point_type = "manual_point"
  points = 1
  note = "smoke test"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "https://mlm.fangwl591021.workers.dev/admin/points/grant" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $pointBody
```

查點數：

```powershell
Invoke-RestMethod -Uri "https://mlm.fangwl591021.workers.dev/admin/points/balance?channel_key=oa1&line_user_id=U_TEST_LINE_ID" -Headers @{ Authorization = "Bearer $token" }
```

## 注意

點數來源固定標示如下：

- `oa1`：康立智能，來源網址 `https://k-link.cc/index.php/line_login/1086/`，可贈點也可扣點。
- `oa2`：康立全球，來源網址 `https://k-link.cc/index.php/line_login/1584/`，只允許扣點，不允許贈點。

注意：`1086` / `1584` 是前台 LINE login 來源標示，不等於目前 WETW 會員/點數 API 的 `shop_id`。目前母站 API 回傳資料使用 `WETW_SHOP_ID=216`；若之後母站提供兩個來源各自的點數 `shop_id`，再另外設定 `WETW_POINT_SHOP_ID_OA1`、`WETW_POINT_SHOP_ID_OA2`。

後台點數彈窗會同時顯示兩個來源的餘額。扣點時優先選康立全球，目標是未來康立全球不再贈點前先把可扣點數處理完。

目前 `/admin/crm/sync-points` 是讀母站並寫入本系統 D1 快取，不會回寫母站。等 `grant / deduct` 小額測試完成後，再接母站寫回 API。

目前 `/admin/points/grant`、`/admin/points/deduct`、`/admin/points/redeem` 會先呼叫 k-link.cc 的 `insert-user-point`，成功後才寫入本系統 D1 ledger。

點數查詢列表可能很多頁，Worker 預設每次只同步 5 頁，避免 Cloudflare 單次請求超限。可在呼叫 `/admin/crm/sync-points` 時傳：

```json
{
  "page": 1,
  "per_page": 100,
  "max_pages": 5
}
```

下一批可改：

```json
{
  "page": 6,
  "per_page": 100,
  "max_pages": 5
}
```

## WETW 會員 API 格式

母站會員 API 使用 `POST JSON`，不是 `GET + Bearer Token`。

Worker 會送出：

```json
{
  "api_key": "POINT_API_KEY",
  "shop_id": 216
}
```

如果要查單一 LINE uid，後續可再加 `LINE_user_id` 查詢參數。

## WETW 點數 API 格式

點數查詢 API：

```text
https://k-link.cc/index.php/wp-json/wetw-point/v1/query-user-point-list
```

Worker 會送出：

```json
{
  "api_key": "POINT_API_KEY",
  "shop_id": 216,
  "page": 1,
  "per_page": 100
}
```

新增點數 API：

```text
https://k-link.cc/index.php/wp-json/wetw-point/v1/insert-user-point
```

Worker 會送出：

```json
{
  "api_key": "POINT_API_KEY",
  "LINE_user_id": "Uxxxxxxxx",
  "shop_id": 216,
  "event_name": "客服贈點",
  "event_content": "由 KLINK 客服系統操作",
  "point_type": "system_point",
  "get_point": 100
}
```

扣點時 `get_point` 會是負數。
