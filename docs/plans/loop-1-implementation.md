# Loop 1 Implementation Plan — ERP Boilerplate 10/10

> **For Hermes:** Ejecutar con Kanban, no como cambios directos desde PM. Cada card de implementación debe tener revisión de spec y revisión de calidad antes de habilitar dependientes.

**Goal:** Convertir el estado auditado de `ferlinuxgit/erpboilerplate` en un Loop 1 ejecutable que desbloquee build/deploy reproducible y entregue al menos una mejora vertical visible para usuarios reales.

**Architecture:** Loop 1 empieza por runtime readiness porque build, migraciones y E2E están bloqueados por entorno/DB/Playwright. Después se endurecen guardrails backend y se implementan vertical slices de ERP sobre servicios existentes, evitando expandir alcance con features nuevas no auditadas. Frontend debe estandarizar shell, formularios, tablas y diálogos mientras mejora flujos concretos.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/base-ui style components, Drizzle ORM, PostgreSQL, Vitest, Playwright, ESLint, GitHub Actions.

---

## Evidencia L0 usada

Fuentes leídas:

- `docs/plans/2026-05-09-kanban-agent-loop-10-10.md`
- `docs/audits/product-ux-10-10-audit.md`
- `docs/audits/backend-domain-integrity-audit.md`
- `docs/audits/frontend-ui-ux-audit.md`
- `docs/audits/qa-baseline.md`
- `docs/audits/devops-runtime-readiness-audit.md`
- `docs/audits/backend-endpoints-inventory.json`
- `package.json`
- `README.md`
- `.github/workflows/ci.yml`
- `playwright.config.ts`

Baseline verificado por auditorías:

- `npm run typecheck`: PASS (`tsc --noEmit` sin errores).
- `npm run lint`: PASS con 1 warning en `src/components/customers/customers-table.tsx:48` por `useReactTable()` / React Compiler.
- `npm test`: PASS, Vitest 2 files / 5 tests.
- `npm run build`: FAIL sin `DATABASE_URL`, durante `Collecting page data` en rutas API como `/api/accounts`, `/api/api-keys` o `/api/accounting/close-year` según auditoría.
- `npm run db:migrate`: FAIL sin `DATABASE_URL`; Drizzle pide `url`.
- `npm run test:e2e`: FAIL_BLOCKED por browsers Playwright ausentes y `playwright.config.ts` sin `webServer`.
- `npm audit --audit-level=moderate` / `--omit=dev`: FAIL, 20 vulnerabilidades (1 low, 17 moderate, 2 high).
- Repo sin `.env`, `.env.local` ni `.env.example`, aunque `README.md` pide copiar `.env.example`.
- Migraciones con riesgo de drift: schema auditado con 52 tablas Drizzle (`pgTable`), auditoría DevOps observó 59 exports/tables según heurística, y SQL migrations solo contienen 8 `CREATE TABLE`; `0001-0005` son placeholders.
- Backend auditó 56 `src/app/api/**/route.ts`: 42 rutas con `request.json`, 20 con validación Zod/parse, 24 escrituras directas DB, 2 referencias route-level a audit.
- Frontend auditó 29 app routes y 45 TSX components; principales gaps: shell sin móvil/active state, diálogos no usados, formularios inconsistentes y con labels incompletos, tablas no estandarizadas, estados loading/error ad hoc.

---

## Scope de Loop 1

Incluye:

- Runtime mínimo reproducible: env, DB local/CI, migraciones limpias, build verde, healthcheck y CI base.
- Playwright desbloqueado con `webServer` y smoke coverage mínima de rutas críticas.
- Guardrails backend para contexto/validación/auditoría en mutaciones críticas.
- Un vertical slice de usuario: invoice workflow con líneas reales, totales, validación y experiencia de edición/feedback.
- Quick wins frontend: shell responsive, labels/error states, diálogos de confirmación, tabla base.
- Preparar backlog L2 para dominios que no quepan en Loop 1.

No incluye:

- Reescribir todo el ERP.
- Multi-moneda avanzada, integraciones fiscales reales con agencias externas, OCR bancario, conciliación automática ML o BI avanzado.
- Resolver todas las vulnerabilidades con breaking downgrades automáticos; se requiere triage controlado.
- Cambiar arquitectura de auth/tenant salvo helpers y guardrails necesarios.

---

## Gates globales de Loop 1

Antes de cerrar cualquier card de implementación:

1. Spec gate: reviewer compara contra esta card y marca PASS o gaps concretos.
2. Quality gate: reviewer revisa mantenibilidad, seguridad, accesibilidad y scope creep.
3. Verification gate mínimo:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - Tests específicos de la card
4. Para cards de runtime/CI: también `npm run build` y comando de DB/E2E que corresponda.
5. Para cards UI: al menos un test Playwright o component-level smoke donde sea viable, más captura/manual QA descrita si browser runner sigue limitado.

---

## Dependency graph resumido

```text
C01 env/db bootstrap
  ├─ C02 migrations clean DB
  │   ├─ C03 build determinism
  │   │   ├─ C04 CI + health + E2E unblock
  │   │   └─ C05 dependency/security triage
  │   └─ C06 backend guardrails
  │       ├─ C07 invoice backend vertical slice
  │       │   └─ C08 invoice UX vertical slice
  │       ├─ C09 sales/purchase pipeline hardening
  │       ├─ C10 inventory operations UX
  │       └─ C11 accounting balanced journal editor
  └─ C12 frontend system quick wins
      ├─ C08 invoice UX vertical slice
      ├─ C10 inventory operations UX
      └─ C11 accounting balanced journal editor
```

---

## Cards ordenadas por impacto y dependencia

### C01 — Runtime env and local DB bootstrap

**Assignee:** `devops`

**Priority:** P0

**Depends on:** none

**Why:** Build, migrations and onboarding are not reproducible because `.env.example` is missing and DB setup is implicit.

**Files:**

- Create: `.env.example`
- Create: `docker-compose.yml` or `compose.yaml`
- Modify: `README.md`
- Modify: `package.json` if adding helper scripts such as `db:seed` or `dev:db`
- Inspect: `drizzle.config.ts`, `src/lib/db.ts`, `src/server/seeds/apply.ts`

**Acceptance criteria:**

- `.env.example` exists with safe placeholders for every required/optional env var detected in audits: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `SENTRY_DSN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID`, storage/S3 vars if present in `src/server/storage/s3.ts`.
- No real secrets are committed.
- Local Postgres can be started with documented command.
- README setup path works from clean clone: install, copy env, start DB, migrate, dev.
- If seeds are expected operationally, script is documented or added; if not, README states seeds run only through onboarding UI.

**Tests / verification:**

```bash
cp .env.example .env
# Fill only safe local values documented by the card.
docker compose up -d postgres
npm run db:migrate
npm run typecheck
npm run lint
npm test
```

Expected: migrations no longer fail due to empty DB URL; typecheck/lint/unit remain green.

**Reviewer gates:**

- Spec reviewer: confirms every env var referenced in code is represented or explicitly documented as optional.
- Security reviewer: confirms placeholders only; no token/password/connection string with real credential.
- DevOps reviewer: starts DB from documented command and runs migration command.

---

### C02 — Reconcile Drizzle schema and migrations against clean PostgreSQL

**Assignee:** `backendeng`

**Priority:** P0

**Depends on:** C01

**Why:** Audits found schema/migration drift: many tables in `src/db/schema.ts`, only 8 SQL `CREATE TABLE`, and placeholder migrations. A clean database cannot be trusted until migration history is verified.

**Files:**

- Inspect/modify: `src/db/schema.ts`
- Inspect/modify: `drizzle.config.ts`
- Inspect/modify/create: `drizzle/**` or migrations directory currently used by Drizzle
- Create/modify: `docs/audits/migration-drift-resolution.md`
- Optional tests: `tests/db/migrations.test.ts` or a script under `scripts/verify-migrations.*`

**Acceptance criteria:**

- Clean PostgreSQL migrated only through `npm run db:migrate` contains all tables required by `src/db/schema.ts`.
- Placeholder migrations are either replaced by real migrations or documented as historical no-ops with a new complete baseline migration.
- Migration order is deterministic and does not require `db:push` in production.
- `docs/audits/migration-drift-resolution.md` records current table count, migration count, command output and any intentional discrepancies.
- No destructive migration is introduced without explicit note and rollback guidance.

**Tests / verification:**

```bash
docker compose down -v
docker compose up -d postgres
npm run db:migrate
npm run typecheck
npm test
# Use psql or a node script to count expected tables vs schema exports.
```

Expected: clean DB has the required tables; no Drizzle migrate error.

**Reviewer gates:**

- Backend spec reviewer: validates table coverage against `src/db/schema.ts`.
- DevOps reviewer: repeats clean DB migration from zero.
- Quality reviewer: checks migration safety and rollback notes.

---

### C03 — Make production build deterministic and DB-safe

**Assignee:** `backendeng`

**Priority:** P0

**Depends on:** C01, C02

**Why:** `npm run build` currently compiles but fails while collecting page data because importing routes/services reaches `src/lib/db.ts`, which throws when `DATABASE_URL` is absent.

**Files:**

- Modify: `src/lib/db.ts`
- Inspect/modify: route handlers under `src/app/api/**/route.ts`, especially `src/app/api/accounting/close-year/route.ts`, `src/app/api/accounts/route.ts`, `src/app/api/api-keys/route.ts`
- Inspect/modify: `next.config.ts`
- Create tests if adding helper: `src/lib/db.test.ts` or relevant route smoke tests

**Acceptance criteria:**

- `npm run build` succeeds when required env vars are provided by `.env`/CI.
- Build error message is explicit if `DATABASE_URL` is genuinely required for build, or DB client initialization is lazy enough that static route collection does not crash before runtime.
- Runtime requests still fail safely with clear 500/503 if DB is missing; no silent noop in production paths.
- No API route loses authentication/tenant checks while fixing imports.

**Tests / verification:**

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

Additional negative check:

```bash
DATABASE_URL= npm run build
```

Expected: either documented failure at preflight with clear message, or successful build if DB access is fully lazy. Chosen behavior must be documented in README/CI.

**Reviewer gates:**

- Spec reviewer: confirms chosen build strategy matches C01 docs.
- Backend quality reviewer: checks lazy DB implementation avoids global side effects and preserves runtime failure semantics.
- DevOps reviewer: confirms build succeeds in documented environment.

---

### C04 — CI, health/readiness and Playwright E2E unblock

**Assignee:** `devops`

**Priority:** P0/P1

**Depends on:** C01, C02, C03

**Why:** CI only runs lint/typecheck/build/test and will fail without env/DB. E2E is blocked by missing browsers and no `webServer` in Playwright config. No health/readiness endpoint exists.

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `playwright.config.ts`
- Create: `src/app/api/health/route.ts` or `src/app/api/readyz/route.ts`
- Create/modify: `tests/e2e/smoke.spec.ts`
- Optional create: `tests/api/health.test.ts`

**Acceptance criteria:**

- CI provisions PostgreSQL service or uses documented test DB URL.
- CI sets safe required env vars from placeholders/secrets as appropriate.
- Playwright installs Chromium in CI or uses a base image where it exists.
- `playwright.config.ts` starts app with `webServer` so `npm run test:e2e` does not require a manually running server.
- Health endpoint returns process status and version/build metadata; readiness optionally checks DB with bounded timeout.
- E2E smoke covers `/`, auth page, dashboard redirect/auth boundary, and at least one authenticated/core route if test auth/bootstrap is available.

**Tests / verification:**

```bash
npm run build
npm run test:e2e
npm run typecheck
npm run lint
npm test
```

For health:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
curl -i http://127.0.0.1:3000/api/health
```

Expected: health returns 200 for process health; readiness behavior documented if DB missing.

**Reviewer gates:**

- QA reviewer: confirms E2E fails for real regressions instead of environment setup.
- DevOps reviewer: confirms CI yaml can run from clean checkout.
- Security reviewer: confirms CI does not expose secrets in logs.

---

### C05 — Dependency audit triage without blind breaking downgrade

**Assignee:** `devops`

**Priority:** P1

**Depends on:** C03

**Why:** `npm audit` reports 20 vulnerabilities including 2 high. Audit warns `npm audit fix --force` may suggest unsafe/breaking Next downgrade.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/audits/dependency-audit-triage.md`

**Acceptance criteria:**

- Each high/moderate advisory is classified: direct dependency, transitive, patched by upgrade, accepted with rationale, or blocked upstream.
- No forced downgrade of Next.js or framework packages without explicit architect approval.
- Safe upgrades are applied in small commits.
- Remaining accepted risks are documented with package path and mitigation.

**Tests / verification:**

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: either audit passes at agreed threshold or residual findings are documented and approved.

**Reviewer gates:**

- Security reviewer: verifies triage rationale and no hidden breaking downgrade.
- QA reviewer: verifies standard gates still pass after dependency changes.

---

### C06 — Backend mutation guardrails: context, validation and audit trail

**Assignee:** `backendeng`

**Priority:** P1

**Depends on:** C02, C03

**Why:** Backend audit found 56 route files, 42 `request.json` users, only 20 with validation signal, 24 direct DB write files and only 2 route-level audit references. Critical mutations should have consistent context, Zod validation and audit.

**Files:**

- Inspect/modify: `src/app/api/**/route.ts`
- Modify/create helpers: `src/lib/current-context.ts`, `src/lib/tenant.ts`, `src/server/audit.ts`, `src/server/schemas/forms.ts`
- Use inventory: `docs/audits/backend-endpoints-inventory.json`
- Create tests: `tests/api/critical-mutations.test.ts` or targeted `src/server/**.test.ts`

**Acceptance criteria:**

- Define a critical mutation checklist: auth/session, tenant/company context, permission/RBAC where applicable, Zod/safe parse validation, DB transaction where multi-write, `recordAudit` for sensitive state change.
- Apply checklist first to high-risk domains: accounting, treasury, fiscal, billing, API keys, invitations/team, sales/purchases conversion endpoints.
- Invalid body returns 400 with structured error, not uncaught exception.
- Unauthorized/tenant mismatch returns 401/403 consistently.
- Mutating critical route writes audit entry with action/entity.
- Document any route intentionally excluded.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
```

Targeted tests should cover at least:

- Invalid JSON/body rejected with 400.
- Missing session rejected.
- Tenant mismatch rejected.
- Successful critical mutation records audit where required.

**Reviewer gates:**

- Backend spec reviewer: samples endpoints against checklist and inventory.
- Security reviewer: checks tenant isolation and permission boundaries.
- Quality reviewer: ensures helpers reduce duplication rather than copy-paste.

---

### C07 — Invoice backend vertical slice: line items, totals, taxes and posting hooks

**Assignee:** `backendeng`

**Priority:** P1

**Depends on:** C06

**Why:** Product audit says invoices are CRUD-lite. Schema already includes `invoiceLine`, taxes, payments and accounting services; Loop 1 needs one real ERP vertical slice.

**Files:**

- Modify: `src/app/api/invoices/route.ts`
- Modify: `src/app/api/invoices/[id]/route.ts`
- Modify/inspect: `src/server/accounting/auto-post.ts`
- Modify/inspect: `src/server/taxation/engine.ts`
- Modify/inspect: `src/db/schema.ts`
- Create/modify tests: `src/server/taxation/engine.test.ts`, `tests/api/invoices.test.ts` or service-level invoice tests

**Acceptance criteria:**

- Invoice create/update accepts validated line items with item/description, quantity, unit price, tax code/rate and discount if already supported by schema.
- Totals are computed server-side and cannot be trusted from client only.
- Empty invoice or invalid negative quantities/prices are rejected with clear errors.
- Updating invoice lines is transactional and tenant scoped.
- If accounting autopost is currently supported, invoice issuance path triggers deterministic journal draft/posting hook; if not, card documents exact deferred scope and preserves clean service boundary.
- Invoice PDF/export path still works or explicitly handles line data.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
```

Targeted assertions:

- Creates invoice with two lines and correct subtotal/tax/total.
- Rejects invoice with no lines.
- Rejects cross-tenant item/customer use.
- Update replaces/adds/removes lines transactionally.

**Reviewer gates:**

- Backend spec reviewer: checks server-side calculation and transactionality.
- Accounting/domain reviewer: checks totals/taxes/posting assumptions.
- Security reviewer: checks tenant boundaries.

---

### C08 — Invoice UX vertical slice: usable line-item editor and feedback

**Assignee:** `frontendeng`

**Priority:** P1

**Depends on:** C07, C12

**Why:** This is the main visible user-experience win for Loop 1: invoices should feel like a real ERP workflow, not a placeholder form.

**Files:**

- Modify: `src/components/create-invoice-form.tsx`
- Modify: `src/components/invoices/edit-invoice-form.tsx`
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/app/invoices/[id]/edit/page.tsx`
- Optional shared components: `src/components/invoices/invoice-lines-editor.tsx`, `src/components/ui/*`
- Tests: `tests/e2e/invoices.spec.ts` or component tests if available

**Acceptance criteria:**

- User can add/remove invoice lines, edit quantity/unit price/tax, and see live subtotal/tax/total before submit.
- Required fields have visible labels, descriptions or inline errors.
- Server validation errors map to form fields or clear toast/banner.
- Submit/loading/success states are explicit and keyboard accessible.
- Existing invoice edit loads current lines and preserves data.
- Empty state on invoices page points user to create first invoice.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e -- --grep invoice
```

Manual/browser QA target if E2E auth remains limited:

- `/invoices`
- `/invoices/[id]/edit`
- Narrow viewport and keyboard tab order through line editor.

**Reviewer gates:**

- Frontend spec reviewer: validates all UX acceptance criteria.
- Accessibility reviewer: checks labels, focus, keyboard and error announcement basics.
- Backend integration reviewer: confirms payload matches C07 contract.

---

### C09 — Sales and purchase document pipeline hardening

**Assignee:** `backendeng`

**Priority:** P1/P2

**Depends on:** C06, C07

**Why:** Product audit flags sales/purchases as CRUD-lite. Existing endpoints include sales quotes/orders/delivery conversion and purchases/goods receipts/supplier invoices; Loop 1 should harden the conversion pipeline rather than add new modules.

**Files:**

- Modify/inspect: `src/app/api/sales-quotes/[id]/to-order/route.ts`
- Modify/inspect: `src/app/api/sales-orders/[id]/to-delivery/route.ts`
- Modify/inspect: `src/app/api/delivery-notes/[id]/to-invoice/route.ts`
- Modify/inspect: `src/app/api/purchases/route.ts`
- Modify/inspect: `src/app/api/goods-receipts/route.ts`
- Modify/inspect: `src/app/api/supplier-invoices/route.ts`
- Modify/inspect: `src/server/sales/service.ts`, `src/server/purchases/service.ts`, `src/server/inventory/service.ts`, `src/server/accounting/auto-post.ts`
- Tests: service/API tests for conversion flows

**Acceptance criteria:**

- Conversion endpoints validate source document status and tenant/company context.
- Converting quote -> order -> delivery -> invoice is idempotent enough to avoid duplicate downstream docs on retry.
- Purchase order -> goods receipt -> supplier invoice updates stock/accounting hooks consistently or documents deferred hook.
- Each conversion writes audit trail and status transition.
- Errors tell user what action is blocked and why.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
```

Targeted tests:

- Cannot convert missing/cross-tenant document.
- Cannot double-convert already converted document.
- Successful conversion creates expected downstream records and audit log.

**Reviewer gates:**

- Domain reviewer: validates state machine assumptions.
- Backend quality reviewer: checks transactional boundaries and idempotency.

---

### C10 — Inventory operations UX and low-stock visibility

**Assignee:** `frontendeng`

**Priority:** P2

**Depends on:** C06, C12

**Why:** Inventory has schema/services/endpoints but UX is not yet operational. A user needs to see stock by item/location and create basic movements without raw/admin feel.

**Files:**

- Modify: `src/app/inventory/page.tsx`
- Modify/inspect: `src/app/api/inventory/route.ts`
- Modify/inspect: `src/app/api/inventory/alerts/route.ts`
- Modify/inspect: `src/app/api/stock-movements/route.ts`
- Modify/inspect: `src/components/sales/sales-flow-actions.tsx` if linked to stock flows
- Optional create: `src/components/inventory/*`
- Tests: `tests/e2e/inventory.spec.ts` or service tests

**Acceptance criteria:**

- Inventory page shows stock by item/warehouse/location with empty/loading/error states.
- Low-stock alerts are visible and actionable.
- User can create a basic stock movement with visible labels and validation.
- Movement updates list/summary after success.
- Narrow viewport remains usable.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e -- --grep inventory
```

**Reviewer gates:**

- Frontend spec reviewer: confirms operational inventory flow.
- Backend integration reviewer: checks API contract and tenant scoping.
- Accessibility reviewer: checks form labels and table/card responsive behavior.

---

### C11 — Accounting balanced journal editor

**Assignee:** `frontendeng`

**Priority:** P2

**Depends on:** C06, C12

**Why:** Accounting currently has forms, but product audit calls for a real balanced multi-line editor. This is foundational for trust in ERP workflows.

**Files:**

- Modify: `src/components/accounting/create-journal-entry-form.tsx`
- Modify: `src/components/accounting/edit-journal-entry-form.tsx`
- Modify: `src/app/api/journal-entries/route.ts`
- Modify: `src/app/api/journal-entries/[id]/route.ts`
- Modify/inspect: `src/server/accounting/service.ts`
- Tests: service/API tests and optional E2E accounting spec

**Acceptance criteria:**

- User can add/remove multiple debit/credit lines.
- UI shows running debit total, credit total and difference.
- Submit disabled or server rejects when entry is not balanced.
- Account selection is clear and required.
- Server enforces balance even if client bypassed.
- Existing journal list/edit still works.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e -- --grep accounting
```

Targeted assertions:

- Unbalanced entry rejected.
- Balanced entry accepted.
- Cross-tenant account rejected.

**Reviewer gates:**

- Accounting/domain reviewer: checks debit/credit rules.
- Frontend quality reviewer: checks state model is maintainable.
- Backend security reviewer: checks server-side enforcement.

---

### C12 — Frontend system quick wins: shell, forms, dialogs and table baseline

**Assignee:** `frontendeng`

**Priority:** P1

**Depends on:** C04 for E2E where possible; can start after C01 for static work

**Why:** This unlocks consistent UX across C08/C10/C11 and addresses high-impact audit findings without waiting for all backend work.

**Files:**

- Modify: `src/components/layout/app-shell.tsx`
- Modify/create: `src/components/layout/page-shell.tsx` or `src/components/layout/page-header.tsx`
- Modify/create: `src/components/ui/dialog.tsx` usage wrappers if needed
- Modify/create: `src/components/ui/data-table.tsx` or documented table wrapper
- Modify representative forms:
  - `src/components/treasury/create-bank-transaction-form.tsx`
  - `src/components/fiscal/create-fiscal-report-form.tsx`
  - `src/components/invoices/edit-invoice-form.tsx`
- Modify: `src/components/customers/customers-table.tsx` if addressing React Compiler/TanStack warning
- Tests: `tests/e2e/smoke.spec.ts`, optional component tests

**Acceptance criteria:**

- App shell has responsive navigation for narrow viewport and active nav state with `aria-current="page"`.
- A reusable page header/shell pattern exists and is used by at least 3 core pages.
- Destructive confirms replace `window.confirm`/`window.alert` with accessible dialog/toast flow.
- Representative placeholder-only fields gain visible labels and inline errors.
- Table baseline includes overflow handling, empty state and loading/error affordance pattern.
- React Compiler warning in `customers-table.tsx:48` is either fixed or documented with explicit rationale.

**Tests / verification:**

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Manual/browser QA targets:

- `/dashboard` at desktop and mobile widths.
- `/customers` table empty/non-empty state.
- Any destructive row action using new dialog.
- Treasury/fiscal form labels and keyboard path.

**Reviewer gates:**

- Frontend spec reviewer: checks responsive shell, active state and representative page adoption.
- Accessibility reviewer: checks `aria-current`, focus trap/dialog behavior, labels and keyboard path.
- QA reviewer: confirms E2E smoke captures at least shell/mobile or documents limitation.

---

## Suggested Kanban execution order

1. C01, then C02.
2. C03 once C01/C02 are merged.
3. C04 after build/migrations are reproducible.
4. C05 can run after C03 in parallel with C06.
5. C12 can start once base CI is clear enough for frontend validation; do not block all backend work on C12.
6. C06 before domain vertical slices.
7. C07 then C08 as the primary Loop 1 user-facing vertical slice.
8. C09/C10/C11 only after C06; choose C10/C11 sequencing based on available frontend capacity.

Existing L0-A generated Kanban child cards overlap with this plan (`t_dc0e7b6b`, `t_0672bf61`, `t_72e38cd9`, `t_d9138611`, `t_3abbd9c8`, `t_f74c7185`, `t_135f80f8`, `t_8f5d951a`, `t_daad2a92`, `t_19bece50`). Do not blindly duplicate them. Architect/PM should either map those IDs to C-cards above or close superseded duplicates with a comment referencing this plan.

---

## Loop 1 completion definition

Loop 1 is done when:

- CI can run from clean checkout with documented env/DB and green `typecheck`, `lint`, `test`, `build`.
- Clean DB migrations are verified and documented.
- `npm run test:e2e` is unblocked and runs at least smoke coverage.
- Health/readiness endpoint exists.
- High-risk backend mutation patterns have consistent context/validation/audit for selected domains.
- Invoice vertical slice works end-to-end enough for a user to create/edit an invoice with real line items and totals.
- Frontend shell/forms/dialog baseline is visibly improved and accessible at a basic level.
- Residual vulnerabilities and deferred ERP domain gaps are documented as L2 backlog, not hidden.
