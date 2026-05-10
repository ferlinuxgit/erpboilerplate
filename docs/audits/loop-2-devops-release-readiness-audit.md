# Loop 2 DevOps / release readiness audit

Task Kanban: `t_2a0d2110` / L2-E
Fecha: 2026-05-09
Workspace auditado: `/root/projects/erpboilerplate` (`main`, baseline Loop 1 sin revertir cambios ajenos)

## Resumen ejecutivo

La base post-Loop-1 compila, typecheck/lint/test unitarios pasan y el build de Next 16 ya es determinista cuando se inyectan las variables mínimas. Todavía no está lista para un release/demo reproducible desde un clon limpio: el template de entorno está ignorado por git, las migraciones no representan todo `src/db/schema.ts`, falta health/readiness, CI no prueba DB/E2E y Playwright no es ejecutable en esta máquina sin instalar browsers y sin controlar conflictos de puertos.

## Verificación ejecutada

| Check | Resultado | Evidencia |
| --- | --- | --- |
| `npm run typecheck && npm run lint && npm test` | PASS | 19 archivos / 90 tests; lint sin errores, 1 warning existente `react-hooks/incompatible-library` en `src/components/customers/customers-table.tsx:48`. |
| `npm run build` sin env | FAIL esperado | `scripts/check-build-env.mjs` aborta por `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` faltantes. |
| `npm run build` con env mínima dummy | PASS | Next 16.2.4 compila y genera 67 páginas/rutas; no conecta a DB durante build. |
| `curl -i http://127.0.0.1:3000/api/health` | FAIL | Responde `404 Not Found`; no existe health route. |
| `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/smoke.spec.ts --reporter=line` | FAIL de entorno | Browser Chromium no instalado: pide `npx playwright install`. |
| `npx pglite-server --port 55433 --max-connections=16 --include-database-url --run "npm run db:migrate"` | Drizzle reporta PASS, wrapper queda colgado | `migrations applied successfully!`; el proceso exterior terminó por timeout esperando shutdown de PGlite. |
| Búsqueda de Docker/Compose | No encontrado | No hay `Dockerfile*` ni `docker-compose*`. |
| Búsqueda de health/readiness | No encontrado | No hay `src/app/api/health/route.ts`, `/readyz`, `/healthz` ni `/metrics`. |

## Hallazgos priorizados

### P0-1 — `.env.example` existe en workspace pero está ignorado/no versionado

- Archivos afectados: `.gitignore:36-37`, `.env.example`, `README.md:19-21`, `documentation/deploy.md:3-10`, `scripts/check-build-env.mjs:35-45`.
- Evidencia: `git check-ignore -v .env.example` devuelve `.gitignore:37:.env*`; `git ls-files --error-unmatch .env.example` no lo encuentra. README y preflight instruyen copiar `.env.example`, pero un clon limpio no recibirá ese archivo.
- Impacto: onboarding local/CI/demo se rompe desde cero; el mensaje de error del build apunta a un artefacto que no está garantizado en repo.
- Card sugerida: "Track sanitized env templates and demo env docs".
  - Cambiar `.gitignore` a ignorar `.env*` excepto `!.env.example` y, si aplica, `!.env.test.example`.
  - Versionar `.env.example` sin secretos, con placeholders seguros y comentarios de requeridas/opcionales.
  - Añadir sección README `cp .env.example .env.local` + generación de `BETTER_AUTH_SECRET`.
- Verificación:
  - `git check-ignore -v .env.example; test $? -eq 1`
  - `git ls-files --error-unmatch .env.example`
  - `cp .env.example .env.local && npm run build`

### P0-2 — Drift entre schema Drizzle y migraciones versionadas

- Archivos afectados: `src/db/schema.ts`, `drizzle/*.sql`, `drizzle/meta/_journal.json`, `package.json` scripts `db:*`.
- Evidencia actual: `src/db/schema.ts` contiene 60 exports `pgTable(...)`; `drizzle/*.sql` contiene 11 SQL files pero solo 9 `CREATE TABLE`. Estos files parecen placeholders/no-baseline completos: `0001_masters_sales_purchase_foundation.sql`, `0002_sales_flow_transition_updates.sql`, `0003_purchase_match_and_inventory_valuation_base.sql`, `0004_treasury_reconciliation_base.sql`, `0005_inventory_min_stock_alerts.sql`, `0006_invoice_line_tax_rate.sql`.
- Impacto: una DB limpia puede migrar "correctamente" pero no contener todas las tablas que el runtime espera; los E2E pueden esconderlo porque `scripts/e2e-web-server.mjs` usa `drizzle-kit push --force` en vez de `db:migrate`.
- Card sugerida: "Make migrations authoritative for clean DB release".
  - Generar o consolidar baseline real que cubra el schema actual.
  - Añadir smoke SQL post-migrate que compruebe tablas críticas: auth, organizations/memberships, customers, invoices, invoice_lines, inventory, accounting, purchases, sales, billing/security.
  - Decidir si E2E debe usar `db:migrate` para simular release o mantener `db:push` solo para velocidad, documentando la diferencia.
- Verificación:
  - `npx pglite-server --port 55433 --max-connections=16 --include-database-url --run "npm run db:migrate"`
  - `DATABASE_URL=... npm run db:migrate && psql "$DATABASE_URL" -c "\dt"`
  - Script CI: comparar tablas esperadas vs `information_schema.tables` tras migrar una DB vacía.

### P1-1 — No hay health/readiness endpoint para deploy/operación

- Rutas/archivos afectados: falta `src/app/api/health/route.ts` o `src/app/api/readyz/route.ts`; `documentation/deploy.md` no documenta healthcheck; `curl /api/health` devuelve 404.
- Impacto: Render/Fly/containers/load balancers no tienen señal simple de vida; no hay readiness con DB ni metadata de versión/build para rollback/debug.
- Card sugerida: "Add health/readiness API and operational docs".
  - `/api/health`: proceso vivo, uptime, version/build sha, status 200 sin depender de DB.
  - `/api/readyz`: comprobación DB con timeout corto y status 503 si falla.
  - Tests unitarios/API y doc de healthcheck en deploy.
- Verificación:
  - `npm run dev -- --hostname 127.0.0.1 --port 3000`
  - `curl -fsS http://127.0.0.1:3000/api/health`
  - `curl -i http://127.0.0.1:3000/api/readyz` con DB disponible y no disponible.

### P1-2 — CI no cubre release real: DB, migraciones, Playwright ni browsers

- Archivo afectado: `.github/workflows/ci.yml`.
- Evidencia: CI solo ejecuta `npm ci`, typecheck, lint, unit y build. Define `DATABASE_URL: postgresql://postgres:***@localhost:5432/erpboilerplate_ci` pero no levanta Postgres/PGlite ni ejecuta migraciones. No instala browsers (`npx playwright install --with-deps`) ni ejecuta `npm run test:e2e`.
- Impacto: PRs pueden quedar verdes aunque una DB limpia no migre o los journeys E2E fallen. Si se añade `db:migrate`, el `DATABASE_URL` actual es inválido sin service container.
- Card sugerida: "Harden GitHub Actions release gates".
  - Añadir Postgres service container o PGlite workflow para `npm run db:migrate`.
  - Ejecutar `npx playwright install --with-deps chromium` y `npm run test:e2e` al menos smoke/core.
  - Publicar `playwright-report`/`test-results` como artifacts en failure.
  - Separar secretos reales de placeholders; usar env CI no sensible y explícita.
- Verificación:
  - `act` o PR con service postgres.
  - Gates esperados: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:migrate`, `npm run build`, `npm run test:e2e`.

### P1-3 — Playwright E2E no es reproducible en workstation compartida

- Archivos afectados: `playwright.config.ts:3-23`, `scripts/e2e-web-server.mjs`, `tests/e2e/*.spec.ts`.
- Evidencia: `npm run test:e2e` no pudo arrancar porque `127.0.0.1:3000` ya estaba ocupado por un `next-server`; el smoke con `PLAYWRIGHT_SKIP_WEBSERVER=1` falló porque no está instalado Chromium. El webServer fija `reuseExistingServer: false` y usa puertos default `3000`/`55432`.
- Impacto: E2E es frágil en entornos de agentes/CI donde puede haber procesos previos; bloquea release readiness aunque las specs existan.
- Card sugerida: "Make E2E runner isolated and CI-friendly".
  - Documentar prereq `npx playwright install --with-deps chromium`.
  - En CI, reservar puertos únicos o usar variables `PORT`/`E2E_DATABASE_PORT` por job.
  - Considerar `reuseExistingServer: !process.env.CI` para desarrollo local o script `test:e2e:reuse` separado.
  - Añadir cleanup/logging claro de `pglite-server` y Next dev.
- Verificación:
  - `npx playwright install --with-deps chromium`
  - `PORT=3015 E2E_DATABASE_PORT=55445 npm run test:e2e`
  - `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/smoke.spec.ts`

### P1-4 — Deploy docs todavía no describen una ruta operativa completa

- Archivos afectados: `README.md`, `documentation/deploy.md`, falta Docker/Compose/runtime docs.
- Evidencia: `documentation/deploy.md` lista env y pipeline básico, pero no cubre Node version, `npm ci` vs `npm install`, orden build/migrate/start, healthcheck, rollback, logs, artifacts, provider notes, ni estrategia de DB. No hay `Dockerfile` ni `docker-compose.yml` para demo local.
- Impacto: un operador externo no puede reproducir demo/release sin inferir comandos y decisiones críticas.
- Card sugerida: "Write demo/release runbook".
  - Añadir demo local: instalar, env, DB local/PGlite/Postgres, migrar, seed/onboarding, ejecutar tests, arrancar.
  - Añadir deploy: variables, build command, start command, migrate command, health/readiness URL, rollback y logs.
  - Si no se quiere Docker, documentar explícitamente PGlite/Postgres gestionado; si se quiere demo portable, añadir Compose mínimo para Postgres.
- Verificación:
  - Ejecutar runbook desde clon limpio en tmp dir.
  - `npm ci && cp .env.example .env.local && npm run db:migrate && npm run build && npm start`.

### P2-1 — Higiene de artefactos: temporales en raíz y ausencia de check de workspace limpio

- Archivos/artefactos observados: `tmp-check-db.mjs`, `tmp-push-and-check.mjs` aparecen como untracked; `.next/`, `test-results/`, `tsconfig.tsbuildinfo`, `node_modules/` están correctamente ignorados; `docs/` aparece untracked porque Loop 1 está sin commit.
- Impacto: los tmp scripts pueden confundirse con herramientas reales o colarse en commits; dificulta revisar qué pertenece al producto y qué fue diagnóstico puntual.
- Card sugerida: "Add artifact hygiene guardrails".
  - Mover scripts diagnósticos útiles a `scripts/` con nombre/documentación o borrarlos antes de merge.
  - Añadir checklist pre-PR: `git status --short --ignored` y revisión de ignored allowlist.
  - Mantener artifacts pesados (`.next`, `test-results`, `playwright-report`) ignorados y subirlos solo como CI artifacts.
- Verificación:
  - `git status --short --ignored`
  - `git clean -ndX` para revisar ignored artifacts antes de limpiar.

## Backlog sugerido para L2-F

1. P0 DevOps/docs: versionar `.env.example`/`.env.test.example` y actualizar README/deploy runbook.
2. P0 Backend/DevOps: regenerar baseline de migraciones y añadir verificación de DB limpia en CI.
3. P1 DevOps: añadir `/api/health` y `/api/readyz` con tests y docs de healthcheck.
4. P1 DevOps/QA: endurecer GitHub Actions con Postgres/PGlite, `db:migrate`, Playwright install y E2E smoke/core.
5. P1 QA/DevOps: aislar runner E2E para puertos/procesos compartidos y documentar modo local reuse.
6. P2 Release hygiene: limpiar/normalizar scripts temporales y checklist de artifacts antes de merge.

## Resolución aplicada en `t_e370874d`

- P0-1 resuelto: `.gitignore` permite `.env.example` y `.env.test.example`, ambas plantillas sanitizadas existen y `src/build/release-readiness.test.ts` lo verifica con `git check-ignore -q`.
- P0-2 resuelto para DB limpia/demo: Drizzle quedó consolidado en `drizzle/0000_authoritative_schema.sql` + `drizzle/meta/0000_snapshot.json` generados desde `src/db/schema.ts`; `drizzle/meta/_journal.json` referencia solo esa línea base.
- Verificación añadida: `npm run db:migrate:verify` ejecuta `scripts/verify-clean-db-migrations.mjs` con PGlite en memoria y confirma que la migración crea las 60 tablas declaradas con `pgTable(...)`.
- Docs actualizados: `README.md` y `documentation/deploy.md` documentan plantillas env, verificación de migraciones, orden local/release y rollback mínimo.
- Nota: verificación final en `t_e370874d`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:migrate:verify`, el test nuevo y `npm run build` con env dummy pasan.

## Nota de alcance

No he creado cards de implementación porque L2-F debe sintetizar el plan. No he revertido cambios de Loop 1 ni matado procesos dev existentes; los conflictos de puerto quedan documentados como evidencia de reproducibilidad pendiente.
