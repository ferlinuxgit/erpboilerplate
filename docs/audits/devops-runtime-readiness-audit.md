# DevOps runtime readiness audit

Fecha: 2026-05-09 08:23:01 UTC
Repo: `/root/projects/erpboilerplate`
Branch/HEAD: `main` @ `61335b8`
Task Kanban: `t_683d7383` / L0-E
Alcance: env, migraciones, seed data, startup local, deployment readiness, observabilidad y README. No se han documentado valores de secretos; solo nombres de variables.

## Resumen ejecutivo

Estado: **no listo para deploy automatizado sin ajustes**.

Bloqueos principales:

1. Falta `.env.example`, pero `README.md` indica duplicarlo antes de arrancar.
2. `npm run build` falla en entorno sin `DATABASE_URL` porque durante `Collecting page data` se importa `src/lib/db.ts` y lanza `DATABASE_URL no está definida en variables de entorno.`
3. `npm run db:migrate` falla sin `DATABASE_URL`; no hay fallback ni guía local de Postgres.
4. Hay posible drift de migraciones: `src/db/schema.ts` declara 59 tablas, pero las migraciones SQL contienen 8 `CREATE TABLE`; `0001`-`0005` son placeholders de una línea.
5. No existe healthcheck dedicado (`/api/health`, `/healthz`, `/readyz`) ni endpoint de métricas.
6. `npm run test:e2e` no es reproducible en esta máquina hasta instalar browsers de Playwright (`npx playwright install`).

Puntos positivos:

- `npm run typecheck`, `npm run lint` y `npm test` pasan.
- Home local responde `HTTP/1.1 200 OK` con `npm run dev` incluso sin `DATABASE_URL`.
- Hay logger estructurado con `pino`, redacción de secretos y Sentry opcional por `SENTRY_DSN`.
- `src/proxy.ts` centraliza cabeceras de seguridad, CSRF opcional y rate limit opcional con Upstash.

## Comandos ejecutados y evidencia

Todos los comandos se ejecutaron desde `/root/projects/erpboilerplate`.

| Comando | Exit | Evidencia |
|---|---:|---|
| `git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && git status --short` | 0 | root `/root/projects/erpboilerplate`, branch `main`, HEAD `61335b8`; antes de escribir esta auditoría había `?? docs/` por documentos de auditoría/plan. |
| búsqueda de `.env*` | 0 | no hay `.env`, `.env.example`, `.env.local`, etc. |
| `npm run typecheck` | 0 | `tsc --noEmit` sin errores. |
| `npm run lint` | 0 | 0 errores; 1 warning en `src/components/customers/customers-table.tsx:48` por React Compiler + TanStack Table `useReactTable()`. |
| `npm test` | 0 | Vitest: 2 files passed, 5 tests passed. |
| `npm run build` | 1 | compila, pero falla en page data: `DATABASE_URL no está definida en variables de entorno`; `Failed to collect page data for /api/accounting/close-year`. |
| `npm run db:migrate` | 1 | Drizzle lee `drizzle.config.ts` y falla: `Please provide required params for Postgres driver: [x] url: ''`. |
| `npm run dev -- --hostname 127.0.0.1 --port 3000` + `curl -i http://127.0.0.1:3000/` | 0 | home devuelve `HTTP/1.1 200 OK`, título `ERP SaaS Starter`, cookie `csrf-token`, cabeceras CSP/HSTS/X-Frame-Options. |
| `curl http://127.0.0.1:3000/dashboard` | 0 curl / HTTP 500 | dashboard falla sin DB/sesión runtime; se registró HTTP `500` en HTML dev. |
| `npm run test:e2e` | 1 | Playwright no encuentra Chromium: pide `npx playwright install`; test `tests/e2e/smoke.spec.ts` no llega a abrir browser. |
| `npm audit --audit-level=moderate --omit=dev` | 1 | 20 vulnerabilidades reportadas: 1 low, 17 moderate, 2 high. Varias tienen fix con `npm audit fix`; algunas sugerencias `--force` implican breaking changes. |

## Scripts runtime relevantes

Extraídos de `package.json`:

```text
npm run dev        -> next dev
npm run build      -> next build
npm run start      -> next start
npm run lint       -> eslint
npm run typecheck  -> tsc --noEmit
npm test           -> vitest run
npm run test:e2e   -> playwright test
npm run db:generate -> drizzle-kit generate
npm run db:migrate  -> drizzle-kit migrate
npm run db:push     -> drizzle-kit push
npm run db:studio   -> drizzle-kit studio
```

CI actual (`.github/workflows/ci.yml`) usa Node 20 con:

```text
npm ci
npm run lint
npm run typecheck
npm run build
npm run test
```

Riesgo: si CI no inyecta `DATABASE_URL`, el job fallará en `npm run build` antes de ejecutar tests.

## Variables de entorno

### Mínimas documentadas

`documentation/deploy.md` documenta como entorno mínimo:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`

`README.md` también menciona `DATABASE_URL` y `BETTER_AUTH_SECRET`.

### Detectadas por código/configuración

| Variable | Uso | Obligatoria para |
|---|---|---|
| `DATABASE_URL` | `drizzle.config.ts`, `src/lib/db.ts` | DB runtime, build si rutas importan DB, migraciones. |
| `BETTER_AUTH_SECRET` | documentada para auth | sesiones/auth en producción. |
| `BETTER_AUTH_URL` | `src/lib/auth.ts`, rutas billing y docs deploy | URL base de auth/server. |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | `src/lib/auth-client.ts` | cliente auth si necesita URL pública. |
| `ENABLE_CSRF` | `src/proxy.ts`, `settings/security` | activa verificación CSRF en mutaciones `/api/*`. |
| `LOG_LEVEL` | `src/lib/logger.ts` | nivel de logs pino, default `info`. |
| `SENTRY_DSN` | `instrumentation.ts` | habilita Sentry. |
| `SENTRY_TRACES_SAMPLE_RATE` | `instrumentation.ts` | sample rate Sentry, default `0.1`. |
| `UPSTASH_REDIS_REST_URL` | `src/proxy.ts` | rate limiting distribuido opcional. |
| `UPSTASH_REDIS_REST_TOKEN` | `src/proxy.ts` | rate limiting distribuido opcional. |
| `STRIPE_SECRET_KEY` | `src/server/billing/stripe.ts` | checkout/portal Stripe. |
| `STRIPE_WEBHOOK_SECRET` | `src/app/api/billing/webhook/route.ts` | validación webhook Stripe. |
| `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID` | `src/app/billing/page.tsx` | plan/precio público en UI billing. |
| `RESEND_API_KEY` | `src/server/email/send.ts` | envío real de email; sin clave hace noop. |
| `RESEND_FROM_EMAIL` | `src/server/email/send.ts` | remitente; default `ERP <noreply@example.com>`. |
| `S3_REGION` | `src/server/storage/s3.ts` | uploads S3/R2. |
| `S3_ENDPOINT` | `src/server/storage/s3.ts` | endpoint S3/R2 opcional. |
| `S3_ACCESS_KEY_ID` | `src/server/storage/s3.ts` | uploads S3/R2. |
| `S3_SECRET_ACCESS_KEY` | `src/server/storage/s3.ts` | uploads S3/R2. |
| `S3_BUCKET` | `src/server/storage/s3.ts` | uploads S3/R2. |

Hallazgos:

- No existe `.env.example`; esto contradice `README.md` líneas 19-21.
- No se encontraron archivos `.env*` en el repo. Correcto para no versionar secretos, pero falta plantilla reproducible.
- `src/lib/db.ts` lanza error al importarse si `DATABASE_URL` no existe; esto hace que `next build` falle cuando recopila datos de rutas que importan DB.

Plantilla recomendada para `.env.example` (sin valores reales):

```dotenv
DATABASE_URL=<postgresql connection string>
BETTER_AUTH_SECRET=change-me-min-32-chars
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
ENABLE_CSRF=false
LOG_LEVEL=info
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
S3_REGION=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
```

## Migraciones y schema

Archivos relevantes:

- `drizzle.config.ts`: `schema: "./src/db/schema.ts"`, `out: "./drizzle"`, driver dialect `postgresql`, credentials `url: process.env.DATABASE_URL ?? ""`.
- `src/db/schema.ts`: 59 tablas exportadas con `pgTable(...)`.
- `drizzle/meta/_journal.json`: 6 entradas de migración.
- `drizzle/*.sql`: 6 archivos.

Conteo observado:

```text
0000_productive_vargas.sql: 110 lines, CREATE TABLE=8, ALTER TABLE=8, INDEXES=3
0001_masters_sales_purchase_foundation.sql: 1 line, placeholder only
0002_sales_flow_transition_updates.sql: 1 line, placeholder only
0003_purchase_match_and_inventory_valuation_base.sql: 1 line, placeholder only
0004_treasury_reconciliation_base.sql: 1 line, placeholder only
0005_inventory_min_stock_alerts.sql: 1 line, placeholder only
src/db/schema.ts: 59 pgTable exports
```

Riesgo: el schema de aplicación parece mucho más amplio que las migraciones versionadas. Antes de deploy hay que validar contra una DB limpia con `DATABASE_URL` real y confirmar si faltan migraciones generadas o si se esperaba usar `db:push` en vez de migraciones versionadas.

Comandos esperados para validar con DB local/CI:

```bash
npm ci
cp .env.example .env
# editar DATABASE_URL y secretos locales
npm run db:migrate
npm run build
npm test
```

## Seeds

Implementación principal: `src/server/seeds/apply.ts`.

Comportamiento observado:

- Exporta `applyEsSeeds(input)`; no hay script npm directo para ejecutarlo manualmente.
- Requiere `tenantId`, `companyId`, `actorUserId` y opcionalmente `legalName`, `vatNumber`.
- Exige que exista un `fiscalYear` para `companyId`; si no existe lanza `No existe un ejercicio fiscal activo para aplicar los seeds.`
- Inserta de forma idempotente por existencia previa:
  - cuentas PGC PyME (`accountChart` por `companyId + code`),
  - impuestos (`tax` por `companyId + name`),
  - diarios (`journal` por `companyId + code`),
  - series documentales (`documentSeries` por `companyId + fiscalYearId + type + prefix`).
- Registra auditoría `onboarding.seed.apply` mediante `recordAudit`.

Datos seed detectados:

```text
src/server/seeds/es/categories.json: 3 entries
src/server/seeds/es/document-series-es.json: 10 entries
src/server/seeds/es/journals-es.json: 5 entries
src/server/seeds/es/pgc-pyme.json: 9 entries
src/server/seeds/es/taxes-es.json: 6 entries
src/server/seeds/es/units.json: 4 entries
```

Gap: `categories.json` y `units.json` existen, pero `applyEsSeeds` no los importa ni aplica. Si son intencionados para otro flujo, conviene documentarlo; si no, faltan en el seed inicial.

## Startup local

Ruta básica verificada:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
curl -i --max-time 10 http://127.0.0.1:3000/
```

Resultado:

- `HTTP/1.1 200 OK`
- renderiza `ERP SaaS Starter`
- setea cookie `csrf-token`
- devuelve cabeceras de seguridad: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Content-Security-Policy`, `Strict-Transport-Security`.

Limitaciones:

- La home no prueba DB.
- `/dashboard` devolvió HTTP 500 en dev sin DB/env completa.
- `npm run start` no se puede validar porque `npm run build` falla sin `DATABASE_URL`.

## Deployment readiness

Documentación existente:

- `documentation/deploy.md` lista entorno mínimo, integraciones opcionales y pipeline.
- `README.md` incluye pasos de `npm install`, `.env.example`, `npm run db:migrate`, `npm run dev`.

Gaps de despliegue:

1. Falta `.env.example` aunque README lo exige.
2. Falta guía de DB local para desarrollo (`docker compose`, Postgres local, Supabase/Neon, nombre DB, SSL esperado).
3. No hay `Dockerfile`, `docker-compose.yml`, `render.yaml`, `fly.toml`, `railway.json` ni `vercel.json` detectados.
4. CI no instala browsers Playwright ni ejecuta `npm run test:e2e`.
5. CI ejecuta `npm run build` sin declarar variables de entorno; en entorno limpio fallará como se observó localmente.
6. No hay paso explícito de migración en deploy (`npm run db:migrate`) ni política de rollback.
7. `npm audit --omit=dev` reporta vulnerabilidades que hay que triagear antes de producción.

## Observabilidad y runtime guardrails

Implementado:

- `src/lib/logger.ts`: pino con `LOG_LEVEL` y redacción de `authorization`, `cookie`, `password`, `token`, `key`, `secret` con `[REDACTED]`.
- `instrumentation.ts`: Sentry opcional si `SENTRY_DSN` está definido; `sendDefaultPii: false`; traces sample rate configurable.
- `src/app/error.tsx`: captura excepciones cliente con `Sentry.captureException(error)`.
- `src/proxy.ts`: cabeceras de seguridad, cookie CSRF, validación opcional con `ENABLE_CSRF=true`, rate limit opcional con Upstash para mutaciones `/api/*`.

Gaps:

- No se encontró endpoint `/api/health`, `/healthz`, `/readyz` ni `/metrics`.
- No hay comprobación de conexión a DB para readiness.
- No hay correlación explícita de request-id en logs.
- No hay dashboards/alertas/runbooks documentados.
- No hay verificación automatizada de que Sentry se inicializa en producción.

## README

`README.md` está correcto como arranque mínimo, pero está desactualizado respecto al estado real:

- Indica duplicar `.env.example`, pero el archivo no existe.
- Dice “Incorporar observabilidad” como siguiente paso, aunque ya existen logger/Sentry/proxy security parcialmente; conviene actualizar la sección para distinguir implementado vs pendiente.
- No menciona `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` ni `npm run test:e2e`.
- No documenta seeds ni cómo aplicar datos maestros españoles.
- No documenta integraciones opcionales presentes en código: Stripe, Resend, S3/R2, Upstash, Sentry.

## Recomendaciones priorizadas

P0 antes de CI/deploy:

1. Crear `.env.example` con todas las variables detectadas y valores placeholder no sensibles.
2. Decidir estrategia DB en build: proveer `DATABASE_URL` en CI/build o evitar import/ejecución de DB durante static page data para rutas API.
3. Validar/generar migraciones reales para las 59 tablas del schema; no desplegar con placeholders si una DB limpia debe ser migrada solo con `npm run db:migrate`.
4. Añadir health/readiness endpoint que compruebe proceso y, opcionalmente, DB (`/api/health` o `/readyz`).

P1:

5. Añadir guía local de Postgres (`docker compose` o proveedor externo) y comandos completos de bootstrap.
6. Añadir script npm explícito para seeds si `applyEsSeeds` es parte del onboarding operativo, o documentar que solo se invoca desde la UI/flujo de onboarding.
7. Instalar browsers en CI si se quiere ejecutar Playwright: `npx playwright install --with-deps chromium`; si no, separar e2e de CI base.
8. Triagear `npm audit --omit=dev` y actualizar dependencias con PR separado.

P2:

9. Documentar runbook de deploy/rollback/migrations.
10. Añadir request-id/correlation-id y guía de dashboards/alertas Sentry/logs.
11. Actualizar README con comandos de calidad y variables opcionales.

## Veredicto

El repo tiene una base razonable de scripts, seguridad de borde y observabilidad parcial, pero no está listo para un pipeline de deploy reproducible desde cero. La ruta mínima para desbloquear runtime readiness es: `.env.example` + DB local/CI definida + migraciones reales verificadas contra DB limpia + healthcheck + build verde con entorno documentado.
