# MLM Worker 自動盤點掃描器

這個工具只讀取 `worker/worker.js` 的文字內容，進行靜態分析，不會：

- 執行 Worker
- 連線 D1、R2、LINE、WordPress、OpenAI 或 GAS
- 修改任何正式資料
- 改寫 `worker/worker.js`
- 部署 Cloudflare Worker

## 執行方式

需要 Node.js 20 以上，不需要安裝第三方套件。

```bash
node tools/inventory-scan.mjs worker/worker.js artifacts/inventory
```

預設值也是：

```bash
node tools/inventory-scan.mjs
```

## 輸出檔案

掃描結果會寫入 `artifacts/inventory/`：

- `summary.json`：檔案雜湊、行數與各類盤點數量
- `routes.json`、`routes.csv`：路由、HTTP 方法、匹配方式、風險分數
- `functions.json`、`functions.csv`：函式行數、env 依賴、SQL、fetch 與呼叫關係
- `env.csv`：所有 `env.*` 參照
- `external-urls.csv`：程式中的外部網址與網域
- `sql-usage.csv`：`prepare()` 中可辨識的 SQL 與資料表
- `r2-usage.csv`：R2 binding 的 get／put／delete／head 操作
- `dependency-edges.csv`：函式之間可辨識的呼叫關係
- `inventory-report.md`：工程師可直接閱讀的摘要報告

## 風險分級

掃描器依路由名稱與 HTTP 方法做初步評分：

- `critical`：點數、報到、Webhook、登入等高風險寫入流程
- `high`：重要交易或身份流程
- `medium`：檔案上傳、AI 生成、一般寫入
- `low`：健康檢查、文件、一般唯讀查詢

風險分級只是重構排序參考，不能取代人工程式審查。

## 已知限制

這是一個無第三方依賴的靜態文字掃描器，因此下列情況可能需要人工補充：

- 動態拼接的路由或 URL
- 透過變數組合的 SQL
- 使用別名存取的 `env`
- 間接呼叫或高階函式
- template literal 中高度動態的資料表名稱
- 在其他檔案定義但由 Worker 引用的功能

## 建議使用流程

1. 在新分支或 staging 執行掃描。
2. 將 `inventory-report.md` 與 CSV 交由工程師人工校正。
3. 依風險分級建立重構 backlog。
4. 先處理 low-risk、read-only 路由。
5. 點數、報到、登入、Webhook 必須最後處理，並先建立現況行為測試。
