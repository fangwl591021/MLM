# 主控台與權限規劃

## 目標

客服管理後台拆成「主控台 + 模組頁面 + 樓層權限」。主控台負責看整體成效，客服頁負責處理單一 LINE OA 對話，各模組依照角色開放。

## 樓層

| 樓層 | 名稱 | 用途 | LINE Provider |
| --- | --- | --- | --- |
| 1F | 產品客服 | 產品詢問、保健品、負離子眼鏡、訂單與售後 | `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` |
| 2F | 行政客服 | 入會、制度、獎金、文件補件、行政流程 | `LINE_ADMIN_CHANNEL_SECRET` / `LINE_ADMIN_CHANNEL_ACCESS_TOKEN` |

## 主控台頁面

| 頁面 | 路徑建議 | 內容 | 權限 key |
| --- | --- | --- | --- |
| 綜合主控台 | `/console.html` | 今日訊息量、待回覆、已完成、高風險、AI 建議命中率、活動報名/簽到摘要 | `console.view` |
| 產品客服 | `/index.html?floor=main` | 產品客服對話、標籤、狀態、AI 建議、備註 | `line.main.view` |
| 行政客服 | `/index.html?floor=admin` | 行政客服對話、標籤、狀態、AI 建議、備註 | `line.admin.view` |
| AI 監控報告 | `/ai-monitor.html` | 客訴、負評、建議、高風險訊息、AI 分類統計、通知紀錄 | `ai.monitor.view` |
| 行事曆 | `/calendar.html` | 課程、活動、提醒、客服排班、待辦 | `calendar.view` |
| 活動報名 | `/events.html` | 活動清單、報名人數、簽到率、來源追蹤 | `events.view` |
| 權限管理 | `/permissions.html` | 人員、角色、樓層、頁面權限、Token 管理 | `permissions.manage` |

## 角色分層

| 角色 | 說明 |
| --- | --- |
| `owner` | 系統最高管理者，可看全部、改權限、匯出資料 |
| `ops_manager` | 營運主管，可看全部成效與客服狀態，不一定能改權限 |
| `product_lead` | 產品客服主管，可管理產品客服與產品報表 |
| `product_agent` | 產品客服人員，只能看與回覆產品客服 |
| `admin_lead` | 行政客服主管，可管理行政客服與行政報表 |
| `admin_agent` | 行政客服人員，只能看與回覆行政客服 |
| `ai_supervisor` | AI 監控人員，可看 AI 分析、客訴、負評、風險報告 |
| `event_staff` | 活動人員，可看活動報名與簽到，不看客服內容 |
| `viewer` | 只讀觀察者，只能看被授權的摘要頁 |

## 權限表

| 權限 key | 說明 |
| --- | --- |
| `console.view` | 查看綜合主控台 |
| `line.main.view` | 查看產品客服 |
| `line.main.reply` | 從後台回覆產品客服 LINE 用戶 |
| `line.main.manage` | 編輯產品客服標籤、狀態、備註 |
| `line.admin.view` | 查看行政客服 |
| `line.admin.reply` | 從後台回覆行政客服 LINE 用戶 |
| `line.admin.manage` | 編輯行政客服標籤、狀態、備註 |
| `ai.monitor.view` | 查看 AI 監控報告 |
| `ai.monitor.manage` | 處理 AI 風險案件、改狀態、重送通知 |
| `calendar.view` | 查看行事曆 |
| `calendar.manage` | 新增、編輯、刪除行事曆事件 |
| `events.view` | 查看活動報名與簽到統計 |
| `events.manage` | 建立活動、修改報名資料、處理簽到 |
| `reports.export` | 匯出報表 |
| `knowledge.manage` | 上傳或替換知識庫 |
| `permissions.manage` | 管理人員、角色、Token 與頁面權限 |

## 角色預設權限矩陣

| 角色 | 主控台 | 產品客服 | 行政客服 | AI 監控 | 行事曆 | 活動 | 權限管理 | 匯出 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `owner` | 全部 | 全部 | 全部 | 全部 | 全部 | 全部 | 全部 | 可 |
| `ops_manager` | 查看 | 查看/管理 | 查看/管理 | 查看/管理 | 查看/管理 | 查看/管理 | 不可 | 可 |
| `product_lead` | 查看 | 查看/回覆/管理 | 不可 | 查看產品相關 | 查看 | 查看 | 不可 | 可 |
| `product_agent` | 不可 | 查看/回覆/管理 | 不可 | 不可 | 不可 | 不可 | 不可 | 不可 |
| `admin_lead` | 查看 | 不可 | 查看/回覆/管理 | 查看行政相關 | 查看 | 查看 | 不可 | 可 |
| `admin_agent` | 不可 | 不可 | 查看/回覆/管理 | 不可 | 不可 | 不可 | 不可 | 不可 |
| `ai_supervisor` | 查看 | 只讀 | 只讀 | 查看/管理 | 不可 | 不可 | 不可 | 可 |
| `event_staff` | 查看活動摘要 | 不可 | 不可 | 不可 | 查看 | 查看/管理 | 不可 | 可 |
| `viewer` | 查看 | 只讀授權樓層 | 只讀授權樓層 | 只讀 | 只讀 | 只讀 | 不可 | 不可 |

## 後端落地方式

目前只有單一 `DASHBOARD_API_TOKEN`，適合測試，不適合正式分權。正式版應改成：

1. 每位管理員一組登入身份或 API Token。
2. Token 不存明碼，只存 `token_hash`。
3. 每次 API 請求解析 Token，取得 `user_id`、角色與權限。
4. API 端依照 `floor` 與 `permission_key` 檢查可否操作。
5. 前端依權限隱藏不可用頁面與按鈕，但真正保護一定在 Worker API。

## 下一階段 API

| API | 用途 | 需要權限 |
| --- | --- | --- |
| `GET /api/me` | 取得目前登入者、角色、權限、可看樓層 | 有效 token |
| `GET /api/console/summary` | 主控台統計摘要 | `console.view` |
| `GET /api/ai-monitor` | AI 監控報告 | `ai.monitor.view` |
| `GET /api/calendar` | 行事曆事件 | `calendar.view` |
| `GET /api/events` | 活動清單與統計 | `events.view` |
| `POST /api/admin/users` | 建立或停用後台人員 | `permissions.manage` |
| `POST /api/admin/roles` | 修改角色權限 | `permissions.manage` |

## 主控台成效指標

| 指標 | 來源 |
| --- | --- |
| 今日總訊息 | `messages` |
| 待回覆數 | `threads.status` |
| 已完成數 | `threads.status` |
| 高風險數 | `threads.risk`、`ai_logs` |
| 平均回覆時間 | `messages.sender_role` 的 user/admin 時間差 |
| AI 建議數 | `messages.suggestions` |
| AI 風險通報 | `ai_logs` |
| 活動報名數 | `event_registrations` |
| 活動簽到數 | `event_checkins` |
| 今日行程 | `calendar_events` |

## 注意

主控台可以先做只讀摘要，等客服與活動資料穩定後再做圖表、匯出與細部鑽取。權限系統要先上，否則後面行事曆與活動報名資料一進來，會很難補安全邊界。
