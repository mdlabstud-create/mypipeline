# Dropship Pipeline

Automated dropshipping pipeline (TikTok/Amazon trend discovery → supplier research → AI listing generation → human review → Shopify publish) with an admin dashboard.

## Quickstart (local)

1. Copy env file:

```bash
cp .env.example .env
```

2. Ensure Docker is running:

```bash
npm run doctor
```

3. Start Postgres + Redis + app:

```bash
docker-compose up --build
```

4. Run full regression (runs migrations + integration/e2e when enabled):

```bash
npm run test:full
```

## URLs

- **API**: `http://localhost:3000/api`
- **Bull Board**: `http://localhost:3000/admin/queues`
- **Shopify Webhook**: `POST http://localhost:3000/webhooks/shopify/orders/created`

## Notes

- The Docker image starts with `npm run migrate` before `npm run start`.
- Integration/e2e tests are gated behind `RUN_INTEGRATION=1` (the `test:full` script sets it).