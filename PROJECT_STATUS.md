# KLINK / MLM Project Status

最後更新日期：2026-07-10

## 當前版本

Cloudflare Worker `mlm` 為正式 runtime。

目前正式入口：

```text
https://mlm.fangwl591021.workers.dev
```

## 當前階段

營運中，持續修正與擴充。

系統已從單純 LINE OA AI 建議後台，擴展為 KLINK / AIWE 的 LINE OA 營運中台，包含客服、CRM、點數、活動簽到、AI 穿戴與成本監控。

## 已完成

- Cloudflare Worker `mlm` 作為主要後端與頁面入口。
- D1 `mlm_line_oa` 作為客服、CRM、點數、活動、AI 穿戴資料庫。
- R2 `k-linksaas-images` 保存 AI 穿戴自拍、參考圖、生成圖與分享圖。
- LINE OA1 / OA2 webhook 分流與客服後台。
- 康立智能監控、產品客服、行政客服後台。
- CRM 會員同步、LINE UID 對應、K 點查詢與流水。
- WETW WordPress 會員與點數 API 串接。
- 每日打卡、活動報到、行事曆簽到贈點。
- 簽到模板 Flex 設計與隨機輪動發送。
- AI 穿戴會員端、後台圖庫、分享頁、LINE Flex 分享。
- AI 穿戴扣點、生成紀錄與成本統計報表。

## 進行中

- 穩定化活動報到時間判斷與後台儲存提示。
- 穩定化 AI 穿戴自拍上傳、檢核、生成與舊照片快取問題。
- 釐清母站點數、子站 D1 快取與畫面顯示的一致性。
- 補齊專案文件，降低每次修正時重新理解系統的成本。

## 下一步

- 將近期修正過的 LINE、點數、AI 穿戴、活動簽到踩坑整理到 `KNOWN_ISSUES.md`。
- 將可重用規則回填到 `aiwe-dev-system` 的 `knowledge/` 與 `modules/` 索引。
- 逐步拆分 `worker/worker.js`，但必須保持現有 route 與行為不變。
- 為高風險流程補上診斷 API 或後台檢查區塊。

## 阻塞事項

- `worker/worker.js` 功能集中，改動容易互相影響。
- 母站 WETW API 是點數與會員資料權威來源，但本地 D1 仍保存快取與流水，需持續防止畫面誤讀。
- LINE in-app browser、LIFF、外部瀏覽器行為差異大，分享與登入流程需要實機驗證。
- AI 穿戴依賴外部 image provider、OpenAI API、R2、LINE UID 與點數扣抵，多個環節都可能失敗。

## 部署狀態

- Worker：`mlm`
- D1：`mlm_line_oa`
- R2：`k-linksaas-images`
- 主要 URL：`https://mlm.fangwl591021.workers.dev`

部署後基本驗證：

```powershell
node --check worker\worker.js
curl.exe https://mlm.fangwl591021.workers.dev/health
curl.exe -I https://mlm.fangwl591021.workers.dev/console
curl.exe -I "https://mlm.fangwl591021.workers.dev/dashboard?floor=main"
curl.exe -I https://mlm.fangwl591021.workers.dev/admin/crm
curl.exe -I https://mlm.fangwl591021.workers.dev/ai-wear
```
