# KLINK LINE CRM / 點數模組

這個模組把 `wp-line-point-migrator` 的 LINE OA CRM / 點數 gateway 併入康立監看系統 Worker。

## Worker 路由

- `GET /admin/crm`
- `GET /admin/crm/members`
- `POST /admin/crm/sync-members`
- `POST /admin/crm/sync-points`
- `GET /admin/points/balance`
- `GET /admin/points/ledger`
- `POST /admin/points/grant`
- `POST /admin/points/deduct`
- `POST /admin/points/redeem`
- `POST /admin/points/binding-codes`
- `GET /admin/points/observations`
- `GET /admin/points/member-links`
- `POST /line-webhook/oa1`
- `POST /line-webhook/oa2`

`oa1` 預設對應 `1F 產品客服`，`oa2` 預設對應 `2F 行政客服`。

## Cloudflare 變數與機密

必要：

- `DASHBOARD_API_TOKEN` 或 `ADMIN_TOKEN`
- `CHANNEL_CONFIG_JSON`

建議：

- `POINT_API_KEY`
- `WETW_MEMBERS_URL`
- `WETW_POINTS_URL`
- `WETW_SHOP_ID`

`WETW_MEMBERS_URL`：

```text
https://k-link.cc/index.php/wp-json/wetw/v1/query-line-user-list
```

`WETW_SHOP_ID`：

```text
216
```

會員 API 使用 `POST JSON`，`api_key` 放在 body：

```json
{
  "api_key": "POINT_API_KEY",
  "shop_id": 216
}
```

`CHANNEL_CONFIG_JSON` 範例：

```json
{
  "oa1": {
    "label": "OA1 產品客服",
    "floor": "main",
    "channelSecret": "LINE_CHANNEL_SECRET_OA1",
    "channelAccessToken": "LINE_CHANNEL_ACCESS_TOKEN_OA1"
  },
  "oa2": {
    "label": "OA2 行政客服",
    "floor": "admin",
    "channelSecret": "LINE_CHANNEL_SECRET_OA2",
    "channelAccessToken": "LINE_CHANNEL_ACCESS_TOKEN_OA2"
  }
}
```

如果沒有設定 `CHANNEL_CONFIG_JSON`，Worker 會用既有的 LINE 變數作 fallback：

- `oa1`：`LINE_MAIN_CHANNEL_SECRET` / `LINE_MAIN_CHANNEL_ACCESS_TOKEN`，再 fallback 到舊的 `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`
- `oa2`：`LINE_ADMIN_CHANNEL_SECRET` / `LINE_ADMIN_CHANNEL_ACCESS_TOKEN`

## D1 Schema

執行：

```powershell
cd "D:\OneDrive\文件\New project 2"
npx.cmd wrangler d1 execute mlm_line_oa --remote --file "D:\OneDrive\文件\New project 2\worker\point-gateway.sql"
```

新增資料表：

- `line_channels`
- `webhook_events`
- `line_identity_observations`
- `binding_codes`
- `member_line_links`
- `point_accounts`
- `point_ledger`
- `crm_members`
- `crm_sync_logs`

## 同步策略

目前點數同步採讀取母站資料並寫入本系統 D1 快取，不會直接回寫母站。等 `+1 / -1` 贈扣點測試完成後，再接母站寫回 API。

`/admin/crm/sync-members` 和 `/admin/crm/sync-points` 支援兩種方式：

1. 設定 `WETW_MEMBERS_URL` / `WETW_POINTS_URL` 後由 Worker 拉取。
2. 直接 POST JSON 陣列到 Worker。

會員同步 body 範例：

```json
{
  "members": [
    {
      "member_ref": "M001",
      "name": "王小明",
      "phone": "0912345678",
      "email": "member@example.com",
      "level": "VIP"
    }
  ]
}
```

點數同步 body 範例：

```json
{
  "points": [
    {
      "channel_key": "oa1",
      "line_user_id": "Uxxxxxxxx",
      "point_type": "wetw_point",
      "balance": 100,
      "master_member_ref": "M001"
    }
  ]
}
```
