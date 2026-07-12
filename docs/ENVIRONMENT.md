# Environment Variables

更新日期：2026-06-30

本文件整理 Worker `mlm` 的主要 secrets / variables。實際是否已設定，以 `/health` 現場回應為準。

## 1. 核心後台

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `DASHBOARD_API_TOKEN` | 必要 | Dashboard / 管理 API token。部分 API 會 fallback 使用它。 |
| `ADMIN_TOKEN` | 建議必要 | 管理 API token。正式操作 CRM、點數時建議使用。 |
| `DASHBOARD_LIFF_ID` | 必要 | `/console` LINE Login / LIFF 登入流程。 |
| `ALLOWED_ORIGIN` | 建議必要 | CORS 限制來源。未設定時現場可能回 `*`，正式環境需確認是否可接受。 |

## 2. LINE OA

優先使用 `CHANNEL_CONFIG_JSON` 管理多 channel。

```json
{
  "oa1": {
    "label": "OA1 產品客服",
    "floor": "main",
    "channelSecret": "OA1 Channel Secret",
    "channelAccessToken": "OA1 Channel Access Token"
  },
  "oa2": {
    "label": "OA2 行政客服",
    "floor": "admin",
    "channelSecret": "OA2 Channel Secret",
    "channelAccessToken": "OA2 Channel Access Token"
  }
}
```

Fallback 變數：

| 名稱 | 用途 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | 舊版/產品客服 channel secret fallback。 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 舊版/產品客服 channel token fallback。 |
| `LINE_MAIN_CHANNEL_SECRET` | 產品客服 channel secret。 |
| `LINE_MAIN_CHANNEL_ACCESS_TOKEN` | 產品客服 channel token。 |
| `LINE_ADMIN_CHANNEL_SECRET` | 行政客服 channel secret。 |
| `LINE_ADMIN_CHANNEL_ACCESS_TOKEN` | 行政客服 channel token。 |
| `LINE_OA1_CHANNEL_ACCESS_TOKEN` | OA1 token fallback。 |
| `LINE_OA2_CHANNEL_ACCESS_TOKEN` | OA2 token fallback。 |

## 3. AI / OpenAI

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 必要 | AI 建議、JSON 修復、行事曆圖片匯入、AI 穿戴流程。 |
| `OPENAI_MODEL` | 選填 | 預設使用程式內 fallback。 |
| `OPENAI_API_URL` | 選填 | 預設為 OpenAI Responses API。 |

## 4. WETW CRM / 點數母站

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `POINT_API_KEY` | 必要 | 呼叫 WETW 會員/點數 API。 |
| `WETW_MEMBERS_URL` | 必要 | WETW 會員查詢 API。 |
| `WETW_POINTS_URL` | 必要 | WETW 點數查詢 API。 |
| `WETW_POINT_INSERT_URL` | 必要 | WETW 點數新增/扣點 API。 |
| `WETW_SHOP_ID` | 必要 | 母站 API shop id，目前文件記錄為 `216`。 |
| `WETW_POINTS_MAX_PAGES` | 選填 | 點數同步最大頁數，避免 Worker 單次請求超限。 |
| `WETW_POINT_SHOP_ID_OA1` | 選填 | 未來若母站拆 OA1 點數 shop id 時使用。 |
| `WETW_POINT_SHOP_ID_OA2` | 選填 | 未來若母站拆 OA2 點數 shop id 時使用。 |

## 5. AI 穿戴

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `AI_IMAGE2_API_URL` | 視 provider | 非 OpenAI image provider 的 API URL。 |
| `AI_WEAR_LINE_LOGIN_CHANNEL_ID` | 選填 | AI 穿戴會員端 LINE Login Channel ID。 |
| `REWARD_LINE_LOGIN_CHANNEL_ID` | fallback | AI 穿戴/贈點流程可 fallback。 |
| `LINE_LOGIN_CHANNEL_ID` | fallback | 通用 LINE Login Channel ID fallback。 |

R2 binding：

```toml
binding = "AI_WEAR_BUCKET"
bucket_name = "k-linksaas-images"
```

## 6. Apps Script / legacy

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `GAS_URL` | 視是否使用 Apps Script | 舊版/補充 Google Apps Script Web App URL。 |
| `GAS_SHARED_SECRET` | 視是否使用 Apps Script | Worker 與 Apps Script shared secret。 |

如果 `/health` 顯示 `GAS_URL=true` 但 `GAS_SHARED_SECRET=false`，代表有設定 GAS URL 但 shared-secret 邊界不完整。若 Apps Script 已不再參與正式流程，建議在部署文件明確標示為 legacy。

## 7. Gateway / forwarding

| 名稱 | 用途 |
| --- | --- |
| `GATEWAY_FORWARD_TOKEN` | 內部 webhook gateway forwarding 驗證。 |

## 8. 設定指令範例

```powershell
npx.cmd wrangler secret put ADMIN_TOKEN --name mlm
npx.cmd wrangler secret put POINT_API_KEY --name mlm
npx.cmd wrangler secret put WETW_MEMBERS_URL --name mlm
npx.cmd wrangler secret put WETW_POINTS_URL --name mlm
npx.cmd wrangler secret put WETW_POINT_INSERT_URL --name mlm
npx.cmd wrangler secret put CHANNEL_CONFIG_JSON --name mlm
```

設定後用 `/health` 檢查是否生效：

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
```
