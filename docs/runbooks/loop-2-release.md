# Loop 2 release runbook

Objetivo: ejecutar una release/demo revisable de Loop 2 sin depender del contexto de los agentes que la implementaron.

## Alcance de Loop 2

La release se considera lista cuando se puede demostrar:

- Seguridad backend P0/P1 cerrada: tenant boundaries, CSRF/RBAC y rutas sensibles revisadas.
- Migraciones y entorno reproducibles desde una base limpia.
- E2E obligatorios sin skips ocultos para flujos core.
- Dashboard de primer uso, onboarding y customer-to-cash pulidos.
- Estados loading/error/not-found y acciones destructivas accesibles.
- Health/readiness operativos y documentados para deploy/rollback.

## Variables de entorno

Usa plantillas versionadas y no pegues secretos reales en issues, logs ni docs.

```bash
cp .env.example .env.local
```

Valores obligatorios:

```bash
DATABASE_URL="postgresql://[REDACTED]:[REDACTED]@[REDACTED]:5432/[REDACTED]"
BETTER_AUTH_SECRET="[REDACTED]"
BETTER_AUTH_URL="https://[REDACTED]"
NEXT_PUBLIC_BETTER_AUTH_URL="https://[REDACTED]"
```

Para CI local o una demo aislada se permite usar credenciales efímeras no productivas, por ejemplo el Postgres de service container (`postgres/postgres`) o PGlite gestionado por los scripts E2E.

Variables opcionales por integración:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID`.
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- S3/R2: `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`.

## Release local desde workspace limpio

```bash
npm ci
npm run db:migrate:verify
npm run typecheck
npm run lint
npm test
DATABASE_URL="postgresql://[REDACTED]:[REDACTED]@[REDACTED]:5432/[REDACTED]" \
BETTER_AUTH_SECRET="[REDACTED]" \
BETTER_AUTH_URL="http://127.0.0.1:3000" \
NEXT_PUBLIC_BETTER_AUTH_URL="http://127.0.0.1:3000" \
npm run build
npm run test:e2e
```

Notas:

- `npm run db:migrate:verify` valida la línea base Drizzle en PGlite en memoria; no sustituye un backup real de producción.
- `npm run test:e2e` arranca Next y PGlite mediante `scripts/e2e-with-pglite.mjs`; en CI `E2E_ALLOWED_SKIPS` debe estar vacío.
- Si usas un servidor externo: `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`.

## Smoke de runtime y observabilidad

Arranca el build de producción y comprueba liveness/readiness:

```bash
npm start -- --hostname 127.0.0.1 --port 3000
```

En otra terminal:

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/readyz
```

Respuestas esperadas:

- `/api/health`: `200` y JSON estable de proceso vivo, sin depender de DB.
- `/api/readyz`: `200` con `checks.database="ok"` si `DATABASE_URL` apunta a una DB disponible; `503` con `missing_configuration` o `unavailable` si falta la configuración o falla la conexión.
- Ninguna respuesta debe exponer DSNs, usuarios, passwords, tokens ni stack traces.

Ejemplo sano:

```json
{
  "service": "erpboilerplate",
  "status": "ok",
  "checks": { "database": "ok" },
  "version": { "sha": "abcdef1" }
}
```

## Checklist final de review

| Área | Evidencia mínima | Fuente Loop 2 |
| --- | --- | --- |
| Env y migraciones limpias | `.env.example`/`.env.test.example`, `npm run db:migrate:verify`, build con env dummy | `t_e370874d`, `docs/audits/loop-2-devops-release-readiness-audit.md` |
| Backend security P0/P1 | Tests de rutas tenant-scoped, auth/billing/sales docs, revisión independiente sin findings bloqueantes | `t_1db98fe4`, `t_8bf2c95f`, `docs/audits/backend-loop-2-polish-readiness-audit.md` |
| CI y E2E obligatorios | `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` sin skips obligatorios | `t_bb8ed42f`, `docs/audits/loop-2-qa-e2e-regression-audit.md` |
| Dashboard/primer uso | Tests dashboard cockpit, fallback visible, demo guiada con datos reales | `t_1db98fe4`, `docs/audits/loop-2-product-polish-audit.md` |
| Customer-to-cash | Playwright cliente → presupuesto → pedido → albarán → factura → cobro → reporting | `t_8bf2c95f` |
| Frontend polish/a11y | Estados route-state, acciones destructivas accesibles, no `confirm/alert` nativos | `t_e556456c`, `docs/audits/loop-2-frontend-ui-polish-audit.md` |
| Health/readiness | Tests de route handlers, `curl /api/health`, `curl /api/readyz`, CI smoke | `t_daf0216b` |

## Waivers y riesgos conocidos

- El build sin variables obligatorias falla a propósito por `scripts/check-build-env.mjs`; esto es una barrera de seguridad, no una regresión.
- En una workstation compartida puede haber conflictos de puerto. Usa `PORT` y `E2E_DATABASE_PORT` para aislar ejecuciones.
- Bases existentes que ya aplicaron migraciones placeholder antiguas necesitan plan explícito de reset/migración antes de tratar la línea base limpia como producción.
- Si `/api/readyz` devuelve `503` por DB no disponible, el despliegue no debe recibir tráfico aunque `/api/health` responda `200`.

## Rollback mínimo

1. Retira tráfico del release actual si `/api/readyz` está degradado o hay regresión P0/P1.
2. Restaura el artefacto/app version anterior.
3. Restaura snapshot de DB previo al deploy si se ejecutaron migraciones sobre un entorno persistente.
4. Conserva logs, Playwright artifacts y salida de `curl -i /api/health` + `/api/readyz` para el postmortem.
