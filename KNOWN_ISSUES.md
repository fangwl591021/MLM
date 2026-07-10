# KLINK / MLM Known Issues

最後更新日期：2026-07-10

## 1. 行事曆報到開始時間可能被誤認為已寫入

狀態：已補部分防護，需持續觀察。

現象：

- 後台看起來報到開始已是活動前時間，例如 18:30。
- 但 18:40 掃碼仍回覆「目前不在報名時間」。
- 現場進後台隨便往前調整並儲存後，馬上成功。

目前判斷：

- 舊資料可能只在前端顯示推算時間，D1 實際 `checkin_starts_at` 仍是活動開始時間。
- 掃碼端已補防護：若報到開始空值、等於活動開始、或晚於活動開始，改用活動前 N 分鐘。
- 後台已補提示：若顯示的是系統推算有效時間，提示建議儲存一次寫入資料庫。

排查：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT id,title,datetime(starts_at/1000,'unixepoch','+8 hours') AS starts_tw,datetime(checkin_starts_at/1000,'unixepoch','+8 hours') AS checkin_starts_tw,datetime(updated_at/1000,'unixepoch','+8 hours') AS updated_tw FROM calendar_events ORDER BY starts_at DESC LIMIT 20;"
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT id,campaign,entry,stage,message,created_at FROM reward_client_logs ORDER BY id DESC LIMIT 30;"
```

## 2. AI 穿戴可能吃到舊自拍

狀態：曾多次修正，仍需實機觀察。

現象：

- 客戶上傳新照片，但生成結果仍像舊人物。
- 或圖片檢核不合格，但照片其實清楚。

注意：

- 需確認目前上傳 authority 是最新自拍，不是 localStorage/sessionStorage 或舊 D1/R2 紀錄。
- 不能過度嚴格擋圖，否則有正常背景的自拍也會被擋。
- 生成前應以當次上傳檔案與後端保存結果為準。

排查：

- 查 `ai_wear_selfies` 最新紀錄。
- 查 `ai_wear_results.person_image_url` 是否對應當次自拍。
- 查瀏覽器是否保留舊自拍狀態。
- 查 R2 圖片路徑是否可正常讀取。

## 3. AI 穿戴圖庫破圖

狀態：曾發生，需部署後 smoke test。

現象：

- 眼鏡款式卡片顯示破圖。
- 新用戶進入選眼鏡頁面時看不到圖片。

常見原因：

- R2 參考圖不存在或路徑錯誤。
- Worker route 沒有正確 serve `.jpg` / `.png` asset。
- 前端快取或舊版本 HTML 指向已失效圖片。

排查：

- 後台 `/console/ai-wear` 檢查圖庫 URL。
- 直接開圖片 URL。
- 查 `ai_wear_references` 與 R2 object key。

## 4. AI 穿戴成本統計可能顯示 0

狀態：已建立成本事件表與報表，仍需確認每次生成都有寫入。

現象：

- 剛生成後 `/console/ai-wear-cost` 仍顯示 0。
- 或成本來源不清楚是估算或實際 usage。

規則：

- 真實生成完成後應寫入 `ai_wear_cost_events`。
- 若 API 有 usage，來源標記為 `openai_usage`。
- 若只有後台單價，來源標記為 `estimate`。
- 單價需由後台設定，不寫死。

排查：

```powershell
npx.cmd wrangler d1 execute mlm_line_oa --remote --command "SELECT result_id,model_title,ai_model,estimated_cost_twd,cost_source,status,created_at FROM ai_wear_cost_events ORDER BY created_at DESC LIMIT 20;"
```

## 5. 母站點數與子站快取不一致

狀態：高風險，需以母站 WETW API 為準。

現象：

- 母站會員打卡顯示點數與子站 CRM 顯示不同。
- 子站簽到後看似沒有更新。
- 新會員初始 5 點、每日簽到、課程掃碼贈點互相對不上。

規則：

- `gift_money` 是畫面 K 點主餘額。
- `system_point` 不要和 K 點加總。
- 母站 WETW API 是最終權威。
- 本地 D1 是快取與流水，不應單獨作為最終餘額判斷。

排查：

- 先查母站 API 回應。
- 再查 `point_accounts`。
- 再查 `point_ledger`。
- 查該 LINE UID 是否已有 `crm_members` / `member_line_links` 對應。

## 6. LINE 後台聊天不應被當成 push 廣播

狀態：已釐清原則。

原則：

- 後台客服回覆雖然技術上透過 LINE Messaging API 送出，但業務上是單一對話回覆，不是大量推播。
- 不應把客服回覆流程改成廣播型推送。
- 需注意 LINE 月額限制與 replyToken 可用時間。

## 7. LINE 分享與 FB / IG 分享限制

狀態：功能已做多種 fallback，但平台限制仍存在。

注意：

- 手機 FB app / in-app browser 不一定能直接開貼文編輯器。
- FB 網頁 sharer 可能要求重新登入。
- IG 不能直接把圖與文案完整帶進貼文。
- LINE Flex 分享可用，但需在 LIFF 支援環境中測試。

目前策略：

- LINE 使用 Flex Card / shareTargetPicker。
- FB 手機可改成複製文案與連結，使用者自行貼上。
- IG 以下載分享圖與複製文案為主。

## 8. Worker 單檔過大

狀態：技術債。

現象：

- `worker/worker.js` 包含路由、客服、AI、CRM、點數、行事曆、AI 穿戴等大量功能。
- 小修容易影響其他區域。

原則：

- 不為了漂亮重構而一次大拆。
- 後續可逐步抽出 LINE、點數、AI 穿戴、行事曆模組。
- 每次拆分都必須保持原 route、資料表與使用者流程不變。
