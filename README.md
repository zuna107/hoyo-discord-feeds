  # hoyo-discord-feeds

  _The HoYoLAB feed integration in this repository is implemented with reference/adaptation from [hoyolab-discord-worker](https://github.com/GamerYuan/hoyolab-discord-worker) by GamerYuan.  
  That reference applies to the HoYoLAB RSS/feed handling part only, not the full system architecture._

  This project is a self-hosted feed distribution service that sends social/game updates to Discord webhooks.

  It is designed as a standalone notification engine (separate from your Discord bot), with dashboard management, dedupe/state tracking, and delivery retry/rate-limit handling.

## Features

- Multi-source feed polling: `twitter`, `youtube`, `hoyolab`
- Multi-webhook fan-out: `1 event -> N webhooks`
- SQLite persistence for dedupe, queue state, subscriptions, and logs
- Rate-limit aware dispatcher with retry/backoff
- Dashboard backend (REST API) + React dashboard frontend
- Per-feed HoYoLAB language selection
- Post age policy to avoid posting old content
- TOTP dashboard authentication (Google Authenticator compatible)

  ## Architecture

  ```text
  Scheduler (cron tick)
    -> Source Adapter (Twitter / YouTube / HoYoLAB)
    -> Normalize Post
    -> Dedupe (events)
    -> Fan-out (subscriptions)
    -> Deliveries queue (pending/retry/sent/dead)
    -> Discord webhook dispatcher
  ```

## Requirements

- Node.js `22.x` recommended (`.nvmrc`)
- npm
- SQLite via `better-sqlite3`

Node `24.x` can be used in production, but `better-sqlite3` must match your runtime ABI. If no prebuilt binary is available for your OS/arch, native build tools are required.

Typical Linux build dependencies:

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++
```

After switching Node version:

```bash
npm rebuild better-sqlite3
```
## Setup

Copy environment file:

```bash
cp .env.example .env
```

Install dependencies:

```bash
npm i
npm --prefix dashboard i
```

Build and type-check:

```bash
npm run check
npm run build
npm run dashboard:build
```

## Run

Start backend:

```bash
npm run dev
```

Start dashboard:

```bash
npm run dashboard:dev
```

Default URLs:

- API: `http://localhost:8080`
- Dashboard: `http://localhost:3000`

## Environment Configuration

Core runtime:

- `PORT=8080`
- `ROLE=all` (`all`, `api`, `worker`)
- `DB_PATH=./data/feed-engine.db`
- `SCHEDULER_TICK_CRON=*/30 * * * * *`
- `DISPATCH_CONCURRENCY=5`
- `MAX_RETRY_ATTEMPTS=6`
- `MAX_POST_AGE_HOURS=24`
- `SUBSCRIPTION_BACKFILL_COUNT=1`

Source credentials:

- `TWITTER_BEARER_TOKEN=...`
- `YOUTUBE_API_KEY=...`
- `HOYOLAB_ENDPOINT=https://bbs-api-os.hoyolab.com/community/post/wapi/userPost` (or custom endpoint)

## HoYoLAB Feed Behavior

HoYoLAB-specific implementation supports:

- Polling by HoYoLAB UID
- Per-feed language code
- Pinned post filtering (`is_user_top`) for better dedupe stability
- Custom Discord embed output (title, description, read-more link, image, timestamp)
- Author profile URL mapping to `https://www.hoyolab.com/accountCenter/postList?id=<uid>`

Supported language codes:

```text
en-us, zh-cn, zh-tw, de-de, es-es, fr-fr, id-id, it-it,
ja-jp, ko-kr, pt-pt, ru-ru, th-th, tr-tr, vi-vn
```

## Delivery Format by Source

- `twitter`: link-only with `https://fxtwitter.com/...` (Discord handles embed preview)
- `youtube`: link-only with `https://www.youtube.com/watch?v=...`
- `hoyolab`: custom embed payload from normalized article data

## Dashboard Auth (TOTP)

Google Authenticator-compatible login is available for the dashboard.

Required env values:

- `DASHBOARD_AUTH_ENABLED=true`
- `DASHBOARD_SETUP_KEY=<setup-key>`
- `DASHBOARD_AUTH_ISSUER=Hoyo Feed Engine`
- `DASHBOARD_AUTH_ACCOUNT=dashboard-admin`
- `DASHBOARD_SESSION_SECRET=<long-random-secret>`
- `DASHBOARD_SESSION_TTL_HOURS=24`

Flow:

1. First setup requires `DASHBOARD_SETUP_KEY` to generate QR.
2. Scan QR in authenticator app and verify a 6-digit code.
3. After setup is complete, new clients see login only (no QR setup screen).

## REST API

Health:

- `GET /health`

Feed CRUD:

- `GET /feeds`
- `POST /feeds`
- `PUT /feeds/:id`
- `DELETE /feeds/:id`

Webhook CRUD:

- `GET /webhooks`
- `POST /webhooks`
- `PUT /webhooks/:id`
- `DELETE /webhooks/:id`

Subscription CRUD:

- `GET /subscriptions`
- `POST /subscriptions`
- `PUT /subscriptions/:id`
- `DELETE /subscriptions/:id`

Operations and status:

- `POST /ops/tick`
- `GET /status/deliveries`
- `GET /status/rate-limits`
- `GET /logs?limit=200`
- `DELETE /logs`

Auth:

- `GET /auth/status`
- `POST /auth/setup/start`
- `POST /auth/setup/verify`
- `POST /auth/login`
- `GET /auth/session`
- `POST /auth/logout`

## PM2 Deployment

Use `ecosystem.config.cjs` to split processes:

- `feed-engine-api` with `ROLE=api`
- `feed-engine-worker` with `ROLE=worker`

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Data Model

Main tables:

- `feeds`
- `webhooks`
- `subscriptions`
- `events`
- `deliveries`
- `logs`
- `auth_state`
- `auth_sessions`

Important constraints:

- `UNIQUE(events.source, events.external_post_id)`
- `UNIQUE(deliveries.event_id, deliveries.webhook_id)`

## Operational Notes

- Timestamps are stored in UTC.
- Dashboard displays timestamps in `Asia/Jakarta (UTC+7)`.
- Cooldown and retry behavior is applied automatically when upstream returns temporary/rate-limit errors.

## Limitations

- Upstream API quotas (Twitter/YouTube/HoYoLAB) may affect polling frequency.
- Discord webhook rate limits may delay sends.
- `better-sqlite3` is a native module and requires ABI-compatible binaries/build tools on some environments.

## Credits

- HoYoLAB feed reference/adaptation: [GamerYuan/hoyolab-discord-worker](https://github.com/GamerYuan/hoyolab-discord-worker)
- Upstream project credited by that repo: [UnluckyNinja/worker-bilibili-discord](https://github.com/UnluckyNinja/worker-bilibili-discord)
  
---
<img width="1891" height="890" alt="Image" src="https://github.com/user-attachments/assets/3cf194bb-a69c-413d-9e97-a50790eb6dc3" />

<img width="1889" height="971" alt="Image" src="https://github.com/user-attachments/assets/4c2af41a-9830-44a6-bd86-3f05f00d05b8" />

<img width="1894" height="708" alt="Image" src="https://github.com/user-attachments/assets/87aa1a4e-349a-4938-a295-b7d632d4d1a1" />
