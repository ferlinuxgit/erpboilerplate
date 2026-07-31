# Deploy ERP SaaS

## Entorno mínimo

Variables obligatorias para local/CI/build/runtime:

- `DATABASE_URL`: requerida por Drizzle y por rutas/páginas App Router que importan DB. `npm run build` ejecuta `scripts/check-build-env.mjs` como preflight, carga `.env*` y falla antes de la recolección de páginas si falta. Usa una URL de base de datos real del entorno; no commits credenciales.
  Para conexiones TLS remotas con el comportamiento estricto actual de `pg`, usa `sslmode=verify-full` explícitamente en lugar de `sslmode=require`.
- `JWT_SECRET`: secreto de firma de sesión, con al menos 32 caracteres.
- `APP_URL`: URL canónica HTTPS de la app.

Plantillas versionables:

- `.env.example`: copia base para desarrollo o despliegue.
- `.env.test.example`: copia base para CI/E2E. Copia a `.env.test` o inyecta sus claves en el runner.

`.gitignore` ignora `.env*` reales y permite explícitamente estas dos plantillas sanitizadas. No commits credenciales.

## Borde de la app (Next 16)

- El borde HTTP vive en `src/proxy.ts` (sustituye al antiguo `middleware.ts`).
- Las mutaciones `POST/PATCH/DELETE` bajo `/api/*` exigen siempre una cabecera `x-csrf-token` igual a la cookie `csrf-token`, salvo autenticación Bearer y webhooks verificados.

## Integraciones opcionales

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID`
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
  `SMTP_HOST` debe coincidir con un hostname incluido en el certificado TLS del servidor. No uses un alias MX si el certificado identifica otro nombre.
- S3/R2: `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`

## Migraciones Drizzle

`src/db/schema.ts` es la fuente autoritativa para el esquema. `drizzle/0000_authoritative_schema.sql` y `drizzle/meta/0000_snapshot.json` son una línea base limpia generada desde ese schema para entornos nuevos.

Antes de desplegar o tocar la DB, valida que la línea base aplica en una base limpia:

```bash
npm run db:migrate:verify
```

El comando usa PGlite en memoria, aplica las migraciones registradas en `drizzle/meta/_journal.json` y comprueba que existen todas las tablas declaradas con `pgTable(...)` en `src/db/schema.ts`.

Para una base real de entorno:

```bash
npm run db:migrate
```

Rollback mínimo: restaura snapshot/backup de la base antes del deploy; las migraciones no deben revertirse manualmente en producción sin una migración inversa revisada.

## Health/readiness

La app expone endpoints JSON seguros para operaciones y balanceadores:

- `GET /api/health`: liveness del proceso. No importa la DB y debe responder `200` mientras el runtime Next esté vivo.
- `GET /api/readyz`: readiness de dependencias. Ejecuta una sonda SQL corta (`select 1 as ready`) contra `DATABASE_URL` y responde `200` si la DB está disponible o `503` con estado degradado si falta configuración o la DB no responde.

Los dos endpoints devuelven solo `service`, `status`, `checks` y `version.sha`; no incluyen DSNs, secretos, errores crudos ni stack traces.

Smoke local tras `npm run build`:

Terminal 1:

```bash
npm start -- --hostname 127.0.0.1 --port 3000
```

Terminal 2:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/readyz
```

## Runbook Loop 2

El checklist completo de release/demo, evidencias por card y waivers aceptables está en `docs/runbooks/loop-2-release.md`.

## Pipeline

Checklist local/CI obligatorio:

1. `npm ci`
2. `npm run db:migrate:verify`
3. `npm run db:migrate` contra la DB del entorno cuando aplique
4. `npm run typecheck`
5. `npm run lint`
6. `npm test`
7. `npm run build`
8. `curl -i /api/health` y `curl -i /api/readyz` contra el build arrancado
9. `npm run test:e2e` sin skips obligatorios
