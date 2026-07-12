# KLINK / MLM LINE OA 營運中台

這個專案目前是 KLINK 的 LINE OA 營運中台，主要 runtime 是 Cloudflare Worker `mlm`。

系統負責：

1. 接收 LINE OA webhook，分流產品客服、行政客服與康立智能監控。
2. 將聊天室、AI 建議、知識庫、回覆學習集中在後台處理。
3. 同步 CRM 會員與 WETW 點數資料，支援 K 點查詢、贈點、扣點、兌換與流水紀錄。
4. 管理行事曆、活動、簽到、每日打卡與活動贈點。
5. 管理 AI 穿戴圖庫、生成結果、R2 保存與會員扣點。

重要邊界：AI 只提供管理員建議，不會自動回覆 LINE 用戶。只有管理員在後台送出時，Worker 才會呼叫 LINE push API。

## 現場入口

正式 Worker：

```text
https://mlm.fangwl591021.workers.dev
```

主要頁面：

- `/console`：主控台與登入入口。
- `/dashboard?floor=main`：產品客服。
- `/dashboard?floor=admin`：行政客服。
- `/admin/smart-monitor`：康立智能監控。
- `/admin/crm`：CRM 與 K 點工具頁。
- `/admin/points/stats`：K 點統計。
- `/console/calendar`：行事曆。
- `/console/events`：活動與簽到。
- `/console/ai-wear`：AI 穿戴後台設定。
- `/ai-wear`：AI 穿戴會員端。
- `/health`：Worker 設定與 binding 健康檢查。

## 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `worker/worker.js` | 主要 Worker runtime，包含路由、API、LINE webhook、CRM、點數、行事曆、AI 穿戴。 |
| `wrangler.toml` | Worker 名稱、D1、R2 binding 與環境變數註記。 |
| `worker/schema.sql` | 客服、訊息、AI log、知識庫、app metadata 基礎表。 |
| `worker/point-gateway.sql` | LINE channel、webhook event、會員綁定、CRM、點數帳戶與流水表。 |
| `console.html` | 主控台前端來源。 |
| `dashboard.html` / `index.html` | 客服 dashboard 前端來源。 |
| `ai-wear.html` | AI 穿戴會員端頁面。 |
| `data/knowledge-base.json` | 初始知識庫資料。 |
| `apps-script/Code.gs` | 舊版/補充的 Apps Script 流程，不是目前唯一核心 runtime。 |

## 資料與外部服務

- Cloudflare D1：`mlm_line_oa`
- Cloudflare R2：`k-linksaas-images`
- LINE OA：產品客服 OA1、行政客服 OA2。
- WETW WordPress API：會員、點數查詢、點數寫回。
- OpenAI Responses API：客服分析、知識庫建議、行事曆圖片匯入 JSON 修復、AI 穿戴相關流程。
- Google Apps Script：保留作為舊版或補充同步/通知流程，是否啟用以現場 env 為準。

## 常用驗證

```powershell
curl.exe https://mlm.fangwl591021.workers.dev/health
curl.exe -I https://mlm.fangwl591021.workers.dev/console
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=main"
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/crm
curl.exe -I https://mlm.fangwl591021.workers.dev/ai-wear
node --check worker\worker.js
npx.cmd wrangler deploy
```

## 文件

- `docs/PROJECT_ANALYSIS.md`：目前架構與風險整理。
- `docs/DEPLOYMENT.md`：部署檢查表。
- `docs/ENVIRONMENT.md`：環境變數與 secret 說明。
- `docs/OPERATIONS.md`：日常操作與故障檢查。
- `docs/POINT_CRM_OPERATIONS.md`：CRM / K 點母站串接細節。
- `docs/MASTER_CONSOLE_PERMISSIONS.md`：主控台與權限規劃。
