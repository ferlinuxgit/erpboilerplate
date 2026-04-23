# Deploy ERP SaaS

## Entorno mínimo

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`

## Borde de la app (Next 16)

- El borde HTTP vive en `src/proxy.ts` (sustituye al antiguo `middleware.ts`).
- `ENABLE_CSRF=true` exige cabecera `x-csrf-token` igual a la cookie `csrf-token` en mutaciones `POST/PATCH/DELETE` bajo `/api/*`.

## Integraciones opcionales

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID`
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- S3/R2: `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`

## Pipeline

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
