## 1. Starting and Stopping the Pipeline

### Start (local)
- Copy `.env.example` → `.env` and fill required variables.
- Run migrations (optional if using Docker; the container runs them on startup):

```bash
npm run migrate
```
- Start infra:

```bash
docker-compose up --build
```

### Stop
```bash
docker-compose down
```

### Restart a single worker
- The workers run in the main app process. Restart the app container/service.

## 2. Kill Switches

### Global pause
- Set `PIPELINE_ENABLED=false` (or Redis `pipeline:enabled=0`) and restart app.

### Per-module pause (Redis)
- `SET pipeline:tiktok:enabled 0 EX 3600`
- `SET pipeline:amazon:enabled 0 EX 3600`
- `SET pipeline:researcher:enabled 0 EX 1800`
- `SET pipeline:publisher:enabled 0 EX 900`

### Re-enable
- Delete the key or wait for TTL expiry.

## 3. Triggering a Manual Scrape Run
- Call `triggerManually()` (internal) or expose a route in Phase 4/5.
- Monitor jobs in Bull Board at `/admin/queues`.

## 4. Approving and Rejecting Products
- Open the dashboard and use the Review Queue.
- Approve sends a publish job (Shopify DRAFT only).
- Reject requires a reason.

## 5. Updating Markup and Pricing Settings
- Use Settings Panel (`/api/settings`).
- Warning: enabling `AUTO_PUBLISH` reduces the safety of the review gate.

## 6. Common Errors and Fixes

| Error message | Likely cause | Fix |
|---|---|---|
| CAPTCHA detected | Proxy blocked | Rotate Oxylabs creds, slow down retries |
| 429 rate limit | Provider throttling | Backoff + retry, reduce concurrency |
| Invalid GPT JSON | Model output malformed | Adjust prompt, add stricter schema, retry policy |
| Duplicate detected | Similar title/tags | Review keywords/tags, adjust dedupe |
| DB connection refused | Postgres down | Start docker-compose, verify `DATABASE_URL` |

## 7. Rotating Proxy Credentials
- Update Webshare proxy (`WEBSHARE_PROXY_SERVER`/`WEBSHARE_PROXY_USERNAME`/`WEBSHARE_PROXY_PASSWORD`) in `.env`.
- Or update legacy Oxylabs creds (`OXYLABS_USERNAME`/`OXYLABS_PASSWORD`) in `.env`.
- Restart the app container/service.

## 8. Deploying a New Version
- Pull code, install deps, run migrations, restart services:

```bash
git pull
npm install
npm run migrate
docker-compose up --build -d
```

- Run regression tests:

```bash
npm test
```

- Full regression (includes `RUN_INTEGRATION=1` gate + migrations):

```bash
npm run test:full
```