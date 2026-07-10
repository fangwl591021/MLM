# KLINK / MLM Architecture

最後更新日期：2026-07-10

## 系統定位

本專案是 KLINK / AIWE 的 LINE OA 營運中台。正式 runtime 以 Cloudflare Worker `mlm` 為主，負責頁面、API、LINE webhook、CRM、點數、行事曆、活動簽到與 AI 穿戴。

此 repo 不是單純前端頁，也不是只靠 Apps Script 的舊系統。現況是 Worker-first。

## 核心邊界

- AI 只提供後台建議，不自動回覆一般 LINE 客戶。
- 客服手動送出訊息時，才由 Worker 呼叫 LINE push API。
- WETW WordPress API 是會員與點數的外部權威來源。
- 本地 D1 保存營運快取、對話、活動、點數流水與 AI 穿戴結果。
- R2 保存 AI 穿戴圖片與分享資產。
- Apps Script 保留為舊版或補充流程，不是唯一正式 runtime。

## 主要入口

| 路徑 | 用途 |
| --- | --- |
| `/console` | 主控台與登入入口 |
| `/dashboard?floor=main` | 產品客服 |
| `/dashboard?floor=admin` | 行政客服 |
| `/admin/smart-monitor` | 康立智能監控 |
| `/admin/crm` | CRM 與 K 點工具 |
| `/admin/points/stats` | 點數統計 |
| `/console/calendar` | 行事曆 |
| `/console/events` | 活動與簽到 |
| `/checkin-template` | 簽到模板 |
| `/console/ai-wear` | AI 穿戴後台設定 |
| `/console/ai-wear-cost` | AI 生成費用報表 |
| `/ai-wear` | AI 穿戴會員端 |
| `/health` | Worker binding 與設定檢查 |

## 主要檔案

| 檔案 | 角色 |
| --- | --- |
| `worker/worker.js` | 主要 Worker runtime，包含路由、API、LINE webhook、點數、AI 穿戴與行事曆 |
| `wrangler.toml` | Worker、D1、R2 binding 設定 |
| `console.html` | 主控台、行事曆、簽到模板、AI 穿戴後台 |
| `dashboard.html` / `index.html` | 客服 dashboard |
| `ai-wear.html` | AI 穿戴會員端 |
| `worker/schema.sql` | 基礎客服與知識庫 schema |
| `worker/point-gateway.sql` | CRM、會員綁定、點數帳戶與流水 schema |
| `apps-script/Code.gs` | 舊版或補充 Apps Script 流程 |

## 資料儲存

### Cloudflare D1：`mlm_line_oa`

主要保存：

- `threads`、`messages`：LINE 對話與客服處理狀態。
- `webhook_events`：LINE webhook 收訊紀錄。
- `crm_members`、`member_line_links`：會員與 LINE UID 對應。
- `point_accounts`、`point_ledger`：本地點數快取與流水。
- `calendar_events`、`reward_claims`、`reward_client_logs`：行事曆活動、報到與 LIFF 階段紀錄。
- `ai_wear_*`：AI 穿戴設定、圖庫、自拍、生成結果、分享與成本事件。

### Cloudflare R2：`k-linksaas-images`

主要保存：

- AI 穿戴參考圖。
- 客戶自拍。
- AI 生成結果。
- 社群分享圖與 Open Graph 圖片。

## 外部服務

| 服務 | 用途 |
| --- | --- |
| LINE Messaging API | webhook、客服手動回覆、Flex 訊息 |
| LINE LIFF / Login | 會員 UID、AI 穿戴、簽到、分享追蹤 |
| WETW WordPress API | 會員建立、會員查詢、點數查詢與寫回 |
| OpenAI / image provider | AI 建議、圖片分析、AI 穿戴生成 |
| Cloudflare Workers / D1 / R2 | 正式執行、資料庫與檔案保存 |

## 點數架構

點數以母站 WETW 為權威來源。本地 D1 保存快取與流水，方便後台查詢與營運統計。

重要規則：

- `gift_money` 是目前畫面顯示的 K 點主餘額。
- `system_point` 不應與 K 點加總。
- 贈點與扣點要走 WETW 寫回 API，成功後再更新本地狀態。
- 子站畫面如與母站不同，應先查母站 API，再查本地 D1 快取。

## LINE 架構

- OA1：產品客服與主要會員互動。
- OA2：行政客服。
- `/line-webhook/oa1`、`/line-webhook/oa2` 是目前優先 webhook route。
- 舊 route `/webhook/line/main`、`/webhook/line/admin` 保留相容。

回覆權限：

- AI 不直接回覆客戶。
- 後台手動回覆才會送出 LINE push。
- 活動、簽到、模板等明確規則觸發的訊息，需保留紀錄。

## AI 穿戴架構

流程：

1. 會員以 LINE 進入 `/ai-wear`。
2. 上傳自拍並保存到本系統。
3. 選擇眼鏡款式。
4. preflight 檢查會員、點數、圖片有效性。
5. 呼叫 image provider 生成。
6. 保存結果到 R2 / D1。
7. 生成分享圖、分享頁與 LINE Flex。
8. 記錄扣點與成本事件。

成本統計：

- 生成完成後寫入 `ai_wear_cost_events`。
- 後台 `/console/ai-wear-cost` 顯示每日、本月、會員、模型與最近紀錄。
- 單價由後台設定，不應寫死在程式中。

## 活動簽到架構

流程：

1. 後台建立或匯入 `calendar_events`。
2. 固定 QR / LIFF 進入報到頁。
3. LIFF 取得 LINE UID。
4. Worker 判斷當日活動與有效報到時間。
5. 成功後寫入 `reward_claims` 並走點數贈送。

已知注意：

- 後台顯示的預設報到時間可能是系統推算值；正式有效值應以 D1 與掃碼 API 判斷為準。
- 若現場改時間後立即成功，要檢查是否原本未真正寫入 `checkin_starts_at`。

## 修改原則

- 優先修改既有流程，不建立第二套同功能實作。
- 不任意更換資料庫、部署平台、登入方式或 LINE 架構。
- 高風險修改後必須做 smoke test。
- 與點數、LINE 發送、AI 扣點相關的修改，要能回查紀錄。
