# Loop 2 QA / E2E Regression Audit

Fecha: 2026-05-09
Repo: `/root/projects/erpboilerplate`
Branch/commit observado: `main` / `61335b8`
Rol: QA / regression audit

## Resumen ejecutivo

La base de unit/type/lint/build está verde con el entorno esperado, pero el estado E2E todavía no es un gate de regresión completo para Loop 2: el comando por defecto pasa porque 4 specs quedan skipped, incluyendo journeys críticos de facturas, pipeline documental, inventario y política de seguridad admin. Al forzar una de esas specs con `DATABASE_URL` visible para el runner, la prueba de invoice lines falla antes de cubrir el flujo de negocio, esperando el toast de login `Sesión iniciada correctamente`.

Riesgo principal para Loop 2: CI puede quedar verde sin ejecutar los journeys de negocio integrados que precisamente deberían proteger el polish de producto. La prioridad QA debería ser convertir esos skips en fixtures deterministas y añadir el gate e2e en CI antes de aumentar cobertura funcional.

## Cierre de implementación QA (2026-05-09)

Estado posterior a los ajustes mínimos en fixtures/auth/skip policy/CI:

| Gate | Resultado | Evidencia |
|---|---:|---|
| `npm run typecheck` | PASS | `/tmp/typecheck.log`, exit 0 |
| `npm run lint` | PASS | `/tmp/lint.log`, exit 0 |
| `npm test` | PASS | 29 archivos / 139 tests, `/tmp/npm-test.log`, exit 0 |
| `npx playwright test tests/e2e/core-modules-smoke.spec.ts --reporter=line --timeout=60000` | PASS | 11 passed, `/tmp/core-smoke-after2.log`, exit 0 |
| `npx playwright test tests/e2e/document-pipelines.spec.ts --reporter=line --timeout=60000` | PASS | 1 passed, `/tmp/document-pipelines-after.log`, exit 0 |
| `npx playwright test tests/e2e/inventory-operations.spec.ts --reporter=line --timeout=60000` | PASS | 1 passed, `/tmp/inventory-operations-after.log`, exit 0 |
| `npm run test:e2e -- --reporter=line --timeout=60000` | PASS | 26 passed, 0 skipped, `/tmp/e2e-full-after.log`, exit 0 |
| `npm run build` sin env | FAIL esperado | preflight bloquea por `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`; `/tmp/build-after.log`, exit 1 |

Cambios QA aplicados en esta tarjeta:

- `tests/e2e/helpers/api-client.ts`: helper `postJson` para mutaciones API desde specs, reutilizando la cookie CSRF del navegador y validando status/body de respuesta.
- `tests/e2e/document-pipelines.spec.ts` e `tests/e2e/inventory-operations.spec.ts`: reemplazo de `page.request.post` directo por `postJson`, evitando fallos 401/CSRF al preparar datos.
- `tests/e2e/core-modules-smoke.spec.ts`: aserciones sobre `body` con timeout explícito para no depender del `main` activo cuando existen loading states transitorios/renderizados paralelos.
- `playwright.config.ts`, `.github/workflows/ci.yml`, `src/e2e/skip-policy.ts` y `tests/e2e/skip-policy-reporter.ts`: verificados como gate obligatorio; CI ejecuta Playwright, sube artifacts y `E2E_ALLOWED_SKIPS` queda vacío.

Notas de riesgo:

- `npm run build` requiere entorno CI/local con las variables obligatorias; sin ellas falla correctamente antes de compilar.
- El árbol de trabajo contiene muchos cambios previos de Loop 2 ajenos a esta tarjeta; la matriz anterior valida el estado conjunto actual, no solo el diff mínimo QA.

## Alcance auditado

- Plan Loop 2: `docs/plans/2026-05-09-loop-2-polish-plan.md`.
- Baseline QA anterior: `docs/audits/qa-baseline.md`.
- Configuración E2E/CI: `package.json`, `playwright.config.ts`, `scripts/e2e-web-server.mjs`, `.github/workflows/ci.yml`.
- Specs E2E bajo `tests/e2e/`.
- Tests unit/integración bajo `src/**/*.test.ts(x)`.
- Auth actual observada para setup E2E: `src/components/auth-form.tsx`, `src/lib/auth-client.ts`, `src/lib/auth.ts`, `src/lib/current-user.ts`, `src/app/api/auth/{register,login,logout}/route.ts`.

## Comandos ejecutados

```bash
npm run typecheck && npm run lint && npm test
# PASS: typecheck OK, lint 0 errores / 1 warning existente, vitest 19 files / 90 tests.

npm run build
# FAIL esperado sin env: prebuild exige DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_BETTER_AUTH_URL.

DATABASE_URL='[REDACTED]' \
BETTER_AUTH_SECRET='[REDACTED]' \
BETTER_AUTH_URL='http://localhost:3000' \
NEXT_PUBLIC_BETTER_AUTH_URL='http://localhost:3000' \
npm run build
# PASS: Next.js 16.2.4 compiled successfully, 67 static pages generated.

npm run test:e2e
# PASS aparente: 22 passed, 4 skipped, 0 failed.

DATABASE_URL='postgresql://e2e-placeholder' npx playwright test tests/e2e/invoice-lines.spec.ts --reporter=line
# FAIL: espera `Sesión iniciada correctamente` tras login; el elemento no aparece en 5s.
```

Nota: el último comando se ejecutó para comprobar que los skips no son solo cosméticos. La URL placeholder solo hace visible `process.env.DATABASE_URL` al proceso Playwright; el web server sigue levantándose vía `pglite-server --include-database-url` según `playwright.config.ts`.

## Baseline actual

| Área | Estado | Evidencia |
|---|---:|---|
| TypeScript | PASS | `npm run typecheck` |
| Lint | PASS con warning | `src/components/customers/customers-table.tsx:48` warning `react-hooks/incompatible-library` por `useReactTable()` |
| Unit/integration tests | PASS | 19 archivos, 90 tests |
| Build prod con env CI | PASS | `next build` compila y genera 67 páginas |
| Build sin env | FAIL esperado | `scripts/check-build-env.mjs` bloquea por env vars faltantes |
| E2E default | PASS incompleto | 22 passed, 4 skipped |
| E2E skips forzados | FAIL reproducible | `tests/e2e/invoice-lines.spec.ts` falla en login toast |
| CI actual | Parcial | Ejecuta typecheck/lint/test/build; no ejecuta `npm run test:e2e` |

## Findings priorizados

### P1 — El suite E2E por defecto oculta journeys críticos con skips dependientes de env

Archivos/rutas afectadas:
- `tests/e2e/invoice-lines.spec.ts:3-7`
- `tests/e2e/document-pipelines.spec.ts:3-7`
- `tests/e2e/inventory-operations.spec.ts:3-7`
- `playwright.config.ts:11-18`
- `scripts/e2e-web-server.mjs`

Qué ocurre:
- `npm run test:e2e` levanta el app con PGlite y pasa, pero marca skipped:
  - invoice lines
  - document pipeline quote → order → delivery → invoice
  - inventory stock operations
  - admin security policy
- Las tres primeras specs se saltan si `process.env.DATABASE_URL` no existe en el proceso Playwright.
- `playwright.config.ts` inyecta `DATABASE_URL` al web server mediante `pglite-server --include-database-url`, pero no al proceso que evalúa `test.skip(!requiresDatabase, ...)`.

Impacto usuario/negocio:
- Los flows más cercanos a negocio real de Loop 1/Loop 2 no protegen regresiones en el comando local estándar.
- Un cambio de auth, onboarding, inventario, factura o pipeline documental puede llegar a verde local sin haber cubierto el journey completo.

Evidencia:
- `npm run test:e2e`: `22 passed`, `4 skipped`.
- Skips declarados en líneas 3-5 de las specs afectadas.

Sugerencia de implementación:
1. Cambiar el setup E2E para que el runner Playwright tenga un `DATABASE_URL` estable o eliminar el skip si PGlite ya es obligatorio para el web server.
2. Crear fixture compartida `registerAndOnboard` que espere señales robustas de auth/onboarding, no toasts frágiles.
3. Convertir estas specs en parte obligatoria del comando default.

Verificación propuesta:
```bash
npm run test:e2e -- tests/e2e/invoice-lines.spec.ts tests/e2e/document-pipelines.spec.ts tests/e2e/inventory-operations.spec.ts
npm run test:e2e
```

### P1 — Al activar una spec skipped, el flujo falla antes de validar el caso de negocio

Archivo/ruta afectada:
- `tests/e2e/invoice-lines.spec.ts:14-24`
- `src/components/auth-form.tsx`
- `src/lib/auth-client.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/login/route.ts`

Qué ocurre:
- Forzando la spec con `DATABASE_URL='postgresql://e2e-placeholder'`, Playwright falla esperando `Sesión iniciada correctamente` tras pulsar `Entrar`.
- El test no llega a validar clientes/facturas/líneas/totales persistidos.

Impacto usuario/negocio:
- El skip está tapando una regresión o fragilidad real del setup de autenticación E2E.
- Los journeys integrados no son confiables como señal de release.

Evidencia reproducible:
```bash
DATABASE_URL='postgresql://e2e-placeholder' npx playwright test tests/e2e/invoice-lines.spec.ts --reporter=line
```
Resultado observado:
```text
Error: expect(locator).toBeVisible() failed
Locator: getByText(/Sesión iniciada correctamente/i)
Expected: visible
Timeout: 5000ms
at tests/e2e/invoice-lines.spec.ts:24
```

Sugerencia de implementación:
1. Instrumentar el flujo de login con `page.waitForResponse('/api/auth/login')` y assert explícito de status/body.
2. Esperar `page.toHaveURL(/\/dashboard$/)` como señal primaria si el producto redirige tras login.
3. Revisar si el registro debería auto-login, mostrar CTA de login o garantizar creación de usuario antes de continuar.
4. Compartir helper con `core-modules-smoke.spec.ts`, que sí pasa con una secuencia similar, para evitar divergencias.

Verificación propuesta:
```bash
DATABASE_URL='postgresql://e2e-placeholder' npx playwright test tests/e2e/invoice-lines.spec.ts --reporter=line
```

### P1 — CI no ejecuta Playwright, así que no protege regresiones end-to-end

Archivo afectado:
- `.github/workflows/ci.yml:22-26`

Qué ocurre:
- CI ejecuta `npm ci`, `typecheck`, `lint`, `npm test`, `npm run build`.
- No ejecuta `npm run test:e2e` ni instala/verifica navegadores Playwright.

Impacto usuario/negocio:
- PRs pueden romper navegación, auth browser, onboarding o workflows de ERP sin señal roja en CI.
- Loop 2 pide explícitamente calidad CI/E2E más robusta; este gate falta.

Sugerencia de implementación:
1. Añadir job `e2e` separado después de unit/build, con `npx playwright install --with-deps chromium` si no queda cacheado.
2. Usar el mismo PGlite web server de `playwright.config.ts` para evitar depender de Postgres externo.
3. Fallar si hay skips no permitidos, o al menos reportar lista de skips como warning bloqueante para P1.
4. Subir `playwright-report`/traces como artifact en failure.

Verificación propuesta:
```bash
npm run test:e2e
```
Y en GitHub Actions: job e2e verde con `0 skipped` para specs obligatorias.

### P2 — La spec admin de security policy depende de credenciales externas y queda siempre skipped por defecto

Archivo afectado:
- `tests/e2e/security-policy-admin.spec.ts:3-9`

Qué ocurre:
- El test se salta si no existen `E2E_ADMIN_EMAIL` y `E2E_ADMIN_PASSWORD`.
- No hay fixture local visible que cree un admin/tenant determinista para ese flujo.

Impacto usuario/negocio:
- La pantalla de seguridad/auditoría es sensible y de alto riesgo, pero su journey principal no se valida en local ni en CI estándar.
- Cambios en RBAC, settings o audit trail pueden escapar.

Sugerencia de implementación:
1. Crear seed/helper E2E para usuario admin y tenant con política inicial.
2. Evitar credenciales humanas; usar datos efímeros por run.
3. Mantener el test como obligatorio en CI una vez exista fixture.

Verificación propuesta:
```bash
npm run test:e2e -- tests/e2e/security-policy-admin.spec.ts
```

### P2 — Cobertura API/integración insuficiente para rutas de mutación críticas

Archivos/rutas afectadas:
- `src/app/api/customers/*`
- `src/app/api/invoices/*`
- `src/app/api/stock-movements/*`
- `src/app/api/sales-*/*`
- `src/app/api/purchases/*`
- `src/app/api/security-policy/*`
- Tests actuales: solo `src/app/api/billing/routes.test.ts` aparece como test directo de route handler API.

Qué ocurre:
- Hay buena cobertura de servicios de dominio (`src/server/**`) y utilidades, pero pocas pruebas directas de route handlers, auth/tenant context, status codes y payloads.
- Algunas rutas críticas dependen casi exclusivamente de E2E, y parte del E2E está skipped.

Impacto usuario/negocio:
- Regresiones en validación Zod, auth/tenant isolation, CSRF, permisos o shape JSON pueden pasar si la UI no llega a esa ruta o si el E2E está saltado.

Sugerencia de implementación:
1. Añadir tests de route handlers para invoices, stock movements, sales conversion, purchases y security policy.
2. Mockear `requireUserSession`/tenant context o proveer fixture DB mínima.
3. Cubrir 401/403, 400 validation, 201/200 success y tenant isolation básico.

Verificación propuesta:
```bash
npm test -- src/app/api
npm test
```

### P2 — Cobertura de accesibilidad/regresión visual queda limitada a componentes de formulario

Archivo afectado:
- `src/components/forms-accessibility.test.ts`
- Specs E2E de navegación en `tests/e2e/app-shell-navigation.spec.ts`

Qué ocurre:
- Hay 41 checks unitarios de accesibilidad en formularios, útil como baseline.
- No se observan checks browser-level con axe o similares sobre páginas autenticadas reales.

Impacto usuario/negocio:
- Loop 2 apunta a polish de navegación, empty/loading/error states y coherencia UI; bugs de landmarks, labels dinámicos, focus y contraste pueden no aparecer en unit tests aislados.

Sugerencia de implementación:
1. Añadir smoke a11y Playwright para shell + páginas principales autenticadas (`dashboard`, `customers`, `invoices`, `inventory`, `settings/security`).
2. Reusar fixtures auth/onboarding.
3. Mantener allowlist mínima si hay deuda conocida, con comentarios y tickets.

Verificación propuesta:
```bash
npm run test:e2e -- tests/e2e/accessibility.spec.ts
```

### P2 — Setup E2E duplicado y señales de espera inconsistentes aumentan flakiness

Archivos afectados:
- `tests/e2e/core-modules-smoke.spec.ts`
- `tests/e2e/invoice-lines.spec.ts`
- `tests/e2e/document-pipelines.spec.ts`
- `tests/e2e/inventory-operations.spec.ts`
- `tests/e2e/accounting-journal-entry.spec.ts`

Qué ocurre:
- Cada spec implementa su propio registro/login/onboarding.
- Unas esperan URL `/dashboard`, otras esperan toast de login, otras usan helpers inline de API.

Impacto usuario/negocio:
- Cambios legítimos de copy/toasts pueden romper tests o, peor, dejar tests inconsistentes entre sí.
- Aumenta el coste de migraciones de auth, como JWT/cookies, porque los cambios se replican en muchas specs.

Sugerencia de implementación:
1. Crear `tests/e2e/fixtures/auth.ts` con helpers de registro/login/onboarding y, si procede, `storageState` por worker.
2. Preferir señales estables: status de API, URL final, heading destino y cookie/token esperado.
3. Usar `test.step()` para reportes claros.

Verificación propuesta:
```bash
npm run test:e2e
```

### P3 — Ruido de consola CSP/eval en desarrollo puede ocultar señales útiles

Archivos afectados:
- `playwright.config.ts`
- Configuración CSP/runtime usada por el dev server

Qué ocurre:
- En cada run E2E aparece repetidamente:
  `eval() is not supported in this environment... React requires eval() in development mode...`
- El warning no falla tests, pero ensucia logs y puede tapar errores de consola reales.

Impacto usuario/negocio:
- Menor observabilidad de fallos browser en CI.

Sugerencia de implementación:
1. Si el warning es aceptado en dev, filtrarlo explícitamente en reporter/log capture.
2. Alternativamente ejecutar E2E smoke crítico contra build/start de producción para evitar el patrón de dev.
3. No bajar CSP de producción por este warning.

Verificación propuesta:
```bash
npm run test:e2e
# Confirmar logs sin warnings repetitivos o con allowlist documentada.
```

## Backlog sugerido para L2-F

1. P1 QA/E2E fixture hardening: eliminar skips por `DATABASE_URL`, compartir auth/onboarding fixture y hacer pasar invoice/document/inventory specs.
2. P1 CI E2E gate: añadir job Playwright con PGlite, artifacts de failure y política de skips.
3. P2 Admin security E2E fixture: crear admin efímero y activar spec de política/auditoría.
4. P2 API route regression tests: cubrir rutas críticas de invoices/inventory/sales/security con auth/tenant/validation.
5. P2 Browser a11y smoke: añadir checks axe o equivalentes en shell y páginas core autenticadas.
6. P3 E2E log hygiene: tratar warning CSP/eval como allowlist documentada o reducir ruido.

## Matriz de verificación recomendada para cerrar Loop 2

| Gate | Objetivo |
|---|---|
| `npm run typecheck` | Sin errores TS |
| `npm run lint` | Sin errores; warning TanStack documentado o resuelto |
| `npm test` | Unit/integration completo verde |
| `npm run build` con env CI | Build reproducible verde |
| `npm run test:e2e` | 0 failed y 0 skips para journeys obligatorios |
| Specs focales | `invoice-lines`, `document-pipelines`, `inventory-operations`, `security-policy-admin` verdes |
| CI | Jobs unit/build/e2e verdes, artifacts en failure |

## No-gos QA para implementation cards

- No aceptar `npm run test:e2e` como verde si sigue ocultando P1/P2 mediante skips no justificados.
- No depender de credenciales humanas para tests E2E de CI.
- No relajar CSP de producción para silenciar warnings de React dev.
- No añadir más journeys copiando setup auth inline; primero fixture compartida.
