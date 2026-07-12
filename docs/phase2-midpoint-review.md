# MLM Phase 2 中期架構盤點

日期：2026-07-12
Repository：fangwl591021/MLM
分支：refactor/phase2-module-split

## 1. 已完成成果

| 批次 | 模組 | Commit | 狀態 |
|---|---|---|---|
| Batch A | Points 統計核心 | d237412 | 完成 |
| Batch B | Reward Read Core | 156738d | 完成 |
| Batch C | AI Wear Read Core | 1c960bf | 完成 |

目前 worker/worker.js 共 10,261 行。三批都只有純 Core、Candidate、測試與 Local Shadow Harness，正式 Worker 尚未接線。

結論：

- 實際移除 worker.js 行數：0
- 理論可移除 Legacy Read 邏輯：約 450-570 行
- Legacy 仍是正式 Response owner
- Feature Flag 預設 false
- 沒有新增 Write API
- 沒有 production deployment
- 正式 Route 尚未變更

## 2. 已建立模組盤點

### Points

檔案：
- src/modules/points/point-stats-core.js：216 行
- src/modules/points/point-stats-candidate.js：143 行
- tests/modules/points/point-stats-core.test.cjs：6 tests
- tests/modules/points/point-stats-candidate.test.cjs：3 tests

Export 與用途：
- Core：日期、範圍、WHERE、姓名 fallback、統計結果與 empty/default mapping。
- Candidate：daily、breakdown、recent、members 四組 Read SQL。

Legacy：
- listPointDailyStats：worker.js 5234-5445。
- 共用 helper：worker.js 5139-5233。
- SQL：4 組，已納入 SQL parity。
- 已有 Candidate、Tests、Dry Run、Boundary、Inventory。
- 可替代邏輯估計 210-220 行；Points mutation、account、identity、WETW sync 不在本批。

### Reward

檔案：
- src/modules/reward/reward-read-core.js：166 行
- src/modules/reward/reward-read-candidate.js：25 行
- tests/modules/reward/reward-read-core.test.cjs：5 tests
- tests/modules/reward/reward-read-candidate.test.cjs：3 tests

Export 與用途：
- calendar event parser、event order、reward points parser、check-in window、public event mapping、default/empty/invalid handling。
- Candidate 執行 calendar Read SQL，維持 binding 順序。

Legacy：
- fetchRewardCalendarEvents：worker.js 3757-3771。
- calendarEventRowToRewardEvent：3773-3786。
- calendarEventCheckinWindow/publicCalendarEvent：4186-4209。
- config/parser helper：4222-4235。
- SQL：1 組，已納入 SQL parity。
- 已有 Candidate、Tests、Dry Run、Boundary、Inventory。
- 可替代 Read/parser 邏輯估計 80-110 行；claim、NFC、geocode、point mutation、calendar import 不在本批。

### AI Wear

檔案：
- src/modules/ai-wear/ai-wear-read-core.js：248 行
- src/modules/ai-wear/ai-wear-read-candidate.js：93 行
- tests/modules/ai-wear/ai-wear-read-core.test.cjs：5 tests
- tests/modules/ai-wear/ai-wear-read-candidate.test.cjs：4 tests

Export 與用途：
- settings normalize、public private-field sanitizer、gallery/result/share mapping、cost summary、Taipei day/month。
- Candidate 執行 settings、gallery、results、share card、cost summary Read SQL。

Legacy：
- settings/public：worker.js 8028-8045。
- gallery：8814-8841。
- share card：9114-9128。
- results：9193-9198。
- cost summary：9373-9403。
- SQL parity：9 組，已全部一致。
- 已有 Candidate、Tests、Dry Run、Boundary、Inventory。
- 可替代 Read/helper 邏輯估計 180-230 行。
- generate、upload、preflight、share/referral、point deduction、R2/OpenAI 流程仍不可刪除。

### System

檔案：
- src/modules/system/shadow-compare.js：54 行
- tests/modules/system/shadow-compare.test.cjs：2 tests

用途：
- 比較 status、型別、key、順序、長度與 nested value。
- 不對應單一 Legacy handler。
- 無 SQL、無 Candidate；作為既有 Boundary、Dry Run、Local Shadow Harness 共用基礎設施。

## 3. 已抽離與尚未接線

已抽離：三個 Read Core 的純解析、映射、預設值、SQL Candidate 與測試。
已測試：28 tests、14 組 SQL parity、Boundary、Inventory、Dry Run。
已建立 Candidate：全部三個 domain，Feature Flag 都預設 false。
尚未接線：正式 route 仍直接走 Legacy。
可安全刪除：目前沒有任何 worker.js 行可直接刪除，因為尚未完成正式切換。
目前不可刪除：正式 route、Legacy response、Write 流程、schema bootstrap、外部 API、共用 identity/CRM/LINE helper。

## 4. worker.js 剩餘 domain

以下行數是估計值，區塊有共用 helper，不能直接相加。

| Domain | 主要行號 | 估計 | Read/Write | SQL/外部依賴 | 風險 | 建議 |
|---|---|---:|---|---|---|---|
| line-oa | 1572-2077、6354-7287 | 1100+ | 混合，Webhook/回覆為 Write | 35+；LINE API | 高 | 先 Thread Read |
| crm | 5459-5941、6436-6555 | 650+ | 混合 | 25+；WETW API | 高 | CRM Read 可做 |
| points | 2041-2862、3407-3555、4237-5288 | 1700+ | 混合 | 70+；WETW/LINE | 高 | 只拆 Read |
| reward | 2863-3406、3757-4358 | 800+ | 混合 | 20+；OpenAI/geocode/LINE | 高 | Read 已完成 |
| ai-wear | 8028-9403 | 1400+ | 混合 | 35+；image2/R2/LINE | 高 | Read 已完成 |
| monitor | 5942-6109、6354-6677 | 700+ | Read 聚合 | 15+；間接依賴多 domain | 高 | 不宜先拆 |
| auth/login | 152-294、3407-3422、1401-1467 | 350+ | 混合 | 8+；LINE OAuth | 中高 | Config/Session Read |
| system | 894-1044、1230-1484、1885-2040 | 600+ | 混合 | 20+；GitHub/R2/env | 高 | 暫不做大雜燴 |
| knowledge | 652-699 | 180+ | 混合 | 8+；R2 | 中 | Read 適合 |
| checkin | 783-801、1679-2040、6743-7017 | 850+ | 混合 | 25+；LINE | 高 | Write 暫緩 |
| calendar | 1153-1346、3788-4163 | 800+ | 混合 | 20+；OpenAI/geocode | 高 | Read 可做 |
| reply-learning | 714-728、7190-7287 | 300+ | 混合 | 10+ | 中高 | P2/P3 |
| floor | 699-713、1365-1523 | 300+ | 混合 | 12+ | 中 | Read 適合 |
| 其他 | 801-840、2240-2265、6575-6730 | 500+ | 混合 | 15+；Gas/R2 | 高 | 暫不拆 |

## 5. 優先矩陣

評分 1-5，風險分數越高表示越危險，收益分數越高表示越值得拆。

| Domain | 重複 | 行數 | Read 風險 | Write 風險 | SQL | 外部依賴 | 測試容易度 | 收益 | 分級 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Knowledge Read | 3 | 2 | 2 | 1 | 2 | 2 | 5 | 3 | P1 |
| Auth Config/Session Read | 3 | 2 | 2 | 1 | 1 | 3 | 4 | 2 | P1 |
| Floor Whitelist Read | 3 | 2 | 2 | 1 | 2 | 1 | 4 | 2 | P1 |
| CRM Member Read | 4 | 4 | 3 | 2 | 4 | 4 | 3 | 4 | P2 |
| LINE OA Thread Read | 4 | 5 | 3 | 1 | 4 | 3 | 3 | 5 | P2 |
| Calendar Read | 3 | 4 | 3 | 2 | 4 | 4 | 3 | 4 | P2 |
| Reply-learning Read | 2 | 2 | 3 | 2 | 2 | 1 | 3 | 2 | P2 |
| Smart Monitor | 5 | 3 | 5 | 2 | 5 | 5 | 2 | 2 | P3 |
| mutation/sync/generate/write | 5 | 7 | 5 | 5 | 5 | 5 | 2 | 5 | P3 |
| Webhook/reply/checkin Write | 5 | 7 | 5 | 5 | 5 | 5 | 1 | 4 | P4 |
| System bootstrap/HTML | 2 | 4 | 4 | 3 | 3 | 4 | 2 | 2 | P4 |

預估批次：

| Domain | 建議批次 | 抽離行數 | 測試數 | SQL parity | 新 fixture | Harness |
|---|---|---:|---:|---|---|---|
| Knowledge + Auth + Floor Read | Phase 2 Batch 4 | 150-270 | 14-20 | 8-15 | manifest/session/whitelist | 可沿用 |
| CRM Member Read | Batch 5 | 120-200 | 8-12 | 是 | member/link rows | 可沿用 |
| LINE OA Thread Read | Batch 5 | 180-280 | 10-15 | 是 | thread/message rows | 可沿用 |
| Calendar Read | Batch 6 | 100-180 | 8-12 | 是 | calendar rows | 可沿用 |
| Smart Monitor | Batch 7 以後 | 80-140 | 12-18 | 是 | cross-domain aggregate | 需擴充 |

## 6. Smart Monitor 結論

Smart Monitor 不是單純聚合。worker.js 5942-6048 的 listSmartMonitorData 直接：

- 呼叫 listPointDailyStats
- 查 webhook_events
- 查 daily_keyword_rewards
- 查 threads、messages、ai_logs
- 使用 Points/CRM 姓名解析與 Taipei date helper

因此它依賴尚未抽離的 LINE OA、CRM、Checkin/Reward 與 Points contract。現在先做會產生 Monitor -> 多個 domain 的跨 domain dependency，重複 SQL 會形成第二套讀取邏輯，也可能造成 Candidate circular dependency。

它自身約 107 行，但實際可減少 worker.js 只有 80-140 行，測試需要跨 domain fixture，收益不抵風險。結論：不建議下一批先做 Smart Monitor；應先做 LINE OA Read、CRM Read、Auth Read、System/Floor Read，再重新評估。

## 7. 驗證成本

- 總測試：28
- Points：9
- Reward：8
- AI Wear：9
- System Shadow Compare：2
- phase2:check 實測：約 3.47 秒
- SQL parity：14 組，Points 4、Reward 1、AI Wear 9
- Dry Run：一支共用工具，約 29 個 assertion/step
- Boundary：一支 validator，約 20 個 check/definition
- Inventory：一支 validator，包含 baseline hash、檔案存在與 flag check
- CI：GitHub Actions 執行 phase2:check

目前重複成本：

- Candidate 都重複測試 flag false、prepare、exception isolation。
- 各 domain 各自建立 mock DB。
- SQL parity 已共用 validator，但 SQL fixture 仍各自維護。
- Dry Run 的 SQL shape 不同，不適合強行合併。
- Shadow Compare 已共用，沒有第二套。

可引入但保持小型的 helper：

- createReadOnlyMockDb
- assertFeatureFlagDefaultsFalse
- assertNoWriteCalls
- createShadowHarness

不建議建立大型測試框架或統一所有 domain fixture。

## 8. 兩種批次策略

### 方案一：最安全

每批 1 個 domain，每批完整執行 Core、Candidate、Tests、SQL parity、Boundary、Inventory、Dry Run、CI。

- 開發速度：慢
- 驗證成本：高但容易分散
- 回歸風險：最低
- Commit 大小：小
- 除錯難度：低
- 每批預估減少：40-280 行

### 方案二：平衡效率

每批 2-3 個低風險 Read Core，共用回歸驗證；仍保留每個 domain 的 Candidate、SQL parity、Boundary、Inventory、Dry Run。

第一組建議是 Knowledge Read + Auth Config/Session Read + Floor Whitelist Read。

- 開發速度：中快
- 驗證成本：中
- 回歸風險：中低
- Commit 大小：中
- 除錯難度：中
- 每批預估減少：150-270 行

推薦方案二，但只限低風險 Read。CRM、LINE OA Thread、Calendar 不與低風險組混批。

## 9. Phase 2 Batch 4 建議

建議名稱：Phase 2 Batch 4 - Low-Risk Read Foundations

包含：
- Knowledge Read Core
- Auth Config/Session Read Core
- Floor Whitelist Read Core

預估：
- 新增 Core/Candidate 檔案：6
- 新增測試檔案：6
- 新增測試：14-20
- 抽離 Legacy Read：150-270 行
- 風險：低到中
- 停止條件：response/status 改變、SQL parity mismatch、flag 非 false、Candidate 寫入、Worker/wrangler hash 改變、正式 route 被接線、任一驗證失敗

本次不開始 Batch 4，也不開始 Batch D。

## 10. Phase 2 完成定義

每個 Read Core 必須有 Legacy handler/行號、SQL parity、default false、null/empty/invalid/type/order tests、Local Shadow Compare、Boundary、Inventory、Dry Run 與可回退 commit。

正式接線前後必須通過 phase2:check。Legacy cleanup 必須另開 commit，不與 Core 抽離混合。Write API、Webhook、外部服務與正式 route 不得因 Read Core 抽離而被隱性改動。

## 11. 限制確認

worker/worker.js：未修改
wrangler.toml：未修改
正式 Route：未修改
production deployment：未執行
Batch D：未開始
