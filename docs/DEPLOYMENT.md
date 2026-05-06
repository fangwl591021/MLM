# Deployment Checklist

This project has three deploy targets:

1. GitHub Pages for the admin dashboard.
2. Google Apps Script for AI analysis and Google Sheets persistence.
3. Cloudflare Worker for LINE webhook relay and dashboard API.

## GitHub Pages

The root `index.html` is the deployed dashboard entry:

```text
https://fangwl591021.github.io/MLM/index.html
```

The page works in demo mode without any backend. To connect real data, enter:

- Worker API URL: `https://mlm.fangwl591021.workers.dev`
- Dashboard Token: the value of `DASHBOARD_API_TOKEN`

## Google Apps Script

1. Create a Google Sheet.
2. Create a Google Apps Script project.
3. Paste `apps-script/Code.gs`.
4. Add Script Properties:

```text
SPREADSHEET_ID
GAS_SHARED_SECRET
OPENAI_API_KEY
OPENAI_MODEL=gpt-5-mini
OPENAI_API_URL=https://api.openai.com/v1/responses
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

5. Run `setupSheets()`.
6. Load `data/knowledge-base.json` into the `知識庫` sheet, or pass the JSON text to `updateKnowledgeBaseFromJson(jsonText)`.
7. Deploy as a Web App and copy the `/exec` URL.

## Cloudflare Worker

When the Cloudflare editor works again, deploy `worker/worker.js`.

Set these Worker variables or secrets:

```text
GAS_URL
GAS_SHARED_SECRET
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
DASHBOARD_API_TOKEN
ALLOWED_ORIGIN=https://fangwl591021.github.io
```

After deploy, verify:

```text
GET https://mlm.fangwl591021.workers.dev/health
```

Then set LINE Developers webhook URL:

```text
https://mlm.fangwl591021.workers.dev/webhook/line
```

## Behavior

- LINE messages are not auto-replied.
- AI suggestions are shown only to the dashboard admin.
- Important messages are logged and sent to Telegram.
- LINE push happens only when an admin presses send.
