# Loop 2 Implementation Plan — Release polish backlog

> **For Hermes:** Use kanban-driven implementation. Create one engineering card per backlog item below, keep dependencies explicit, and do not collapse backend security, QA gates, and UX polish into one large implementation task.

**Goal:** Close the Loop 2 P0/P1 release-readiness gaps found by DevOps, Product, Backend, QA/E2E, and Frontend audits, without starting new ERP feature surface area.

**Architecture:** Prioritize release safety first: sanitized environment templates, authoritative DB migrations, backend tenant/security fixes, and a non-skipping E2E/CI gate. Then polish the product experience around the first-run dashboard, guided demo, customer-to-cash journey, and reusable UI patterns.

**Tech stack:** Next.js App Router, TypeScript, React, Drizzle, PGlite/Postgres, Better Auth, Playwright, Vitest, GitHub Actions, Tailwind/shadcn-style UI primitives.

---

## Sources and current-code evidence

Base plan:
- `docs/plans/2026-05-09-loop-2-polish-plan.md`

Parent audits synthesized:
- `docs/audits/loop-2-devops-release-readiness-audit.md`
- `docs/audits/loop-2-product-polish-audit.md`
- `docs/audits/backend-loop-2-polish-readiness-audit.md`
- `docs/audits/loop-2-qa-e2e-regression-audit.md`
- `docs/audits/loop-2-frontend-ui-polish-audit.md`

Grounding checks from current workspace:
- `.env.example` exists but is ignored by `.gitignore` via `.env*` and is not tracked by git.
- Drizzle schema/migration drift is visible: `src/db/schema.ts` has 60 `pgTable` exports while `drizzle/*.sql` contains 9 `CREATE TABLE` statements.
- `src/app/api/health` is absent; parent DevOps audit observed 404 for `/api/health`.
- `.github/workflows/ci.yml` is small and does not run DB migrations, Playwright browser install, or E2E gates.
- `playwright.config.ts` uses `PORT` and `E2E_DATABASE_PORT`; default E2E currently has skips gated by `DATABASE_URL` and admin credentials.
- Backend ownership/security issues are in `src/app/api/sales-orders/route.ts`, `src/app/api/delivery-notes/route.ts`, `src/server/sales/service.ts`, and `src/app/api/billing/portal/route.ts`.
- Frontend route-state coverage is thin: `src/app/error.tsx` exists, but no `loading.tsx` or `not-found.tsx` files were found under `src/app`.
- Destructive actions still use native dialogs in `src/components/delete-button.tsx` (`window.confirm`, `window.alert`).

---

## Definition of Ready for implementation cards

A Loop 2 implementation card is ready only if it includes:
- Exact files likely to change.
- A failing test or reproducible verification command before code changes when practical.
- Explicit tenant/security expectations for route handlers and services.
- Required environment variables listed with sample values redacted as `[REDACTED]`.
- A rollback note for migration/CI/deploy changes.

## Definition of Done for Loop 2

Loop 2 is done when:
- P0/P1 backend security, DB migration, CI/E2E, and product-polish gaps below are closed or explicitly waived by reviewer.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, DB migration verification, and mandatory Playwright journeys pass in CI-like conditions.
- Mandatory E2E specs do not hide critical customer-to-cash, invoice, inventory, auth, or security journeys behind unaccounted skips.
- Release docs explain env setup, DB migrations, health/readiness checks, demo login/onboarding path, and failure triage.

---

## Prioritized backlog

### L2-01 — Make release configuration and migrations authoritative

**Priority:** P0

**Primary owner:** DevOps + Backend

**Objective:** Ensure a clean checkout can be configured, migrated, built, and released from tracked sanitized templates and authoritative migrations.

**Why now:** DevOps audit found `.env.example` ignored/untracked and schema/migration drift. QA build also fails without required env values.

**Files likely to change:**
- `.gitignore`
- `.env.example`
- `.env.test.example` or equivalent test/demo template
- `drizzle/*.sql`
- `src/db/schema.ts` only if drift investigation proves schema should change
- `package.json`
- `docs/deploy*.md`, `README.md`, or a new release runbook under `docs/`

**Implementation notes:**
1. Stop ignoring sanitized env templates while continuing to ignore real secrets.
2. Ensure env templates include required keys for build/E2E with safe placeholders: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, Stripe-related values, and any E2E-only values; never commit real values.
3. Decide whether the current Drizzle schema or current SQL migrations are the source of truth, then regenerate or repair migrations for a clean database.
4. Add a reproducible command for clean DB migration verification using Postgres or PGlite.
5. Document rollback: migration revert or restore previous migration baseline if generated migration is wrong.

**Acceptance criteria:**
- `.env.example` is tracked and no committed env file contains secrets.
- A clean database can run all migrations successfully.
- Migration/schema drift check is documented and repeatable.
- Build instructions no longer require guessing required env names.

**Verification:**
- `git check-ignore -v .env.example` returns no ignore rule, or an intentional negation is documented.
- `git ls-files .env.example` shows the sanitized template tracked.
- `npm run typecheck`
- `npm run lint`
- `DATABASE_URL='[REDACTED]' BETTER_AUTH_SECRET='[REDACTED]' BETTER_AUTH_URL='http://localhost:3000' NEXT_PUBLIC_BETTER_AUTH_URL='http://localhost:3000' npm run build`
- DB migration command from the runbook passes against a clean DB.

---

### L2-02 — Close backend tenant/security leaks in sales documents and billing

**Priority:** P0/P1

**Primary owner:** Backend + Security reviewer

**Objective:** Prevent cross-tenant document references and prevent client-controlled Stripe customer access.

**Why now:** Backend audit identified P0 missing ownership validation for `salesQuoteId`/`salesOrderId` and P1 billing portal accepting `stripeCustomerId` from the client.

**Files likely to change:**
- `src/app/api/sales-orders/route.ts`
- `src/app/api/delivery-notes/route.ts`
- `src/app/api/billing/portal/route.ts`
- `src/server/billing/actions.ts`
- Route/API tests under `src/app/api/**` or `tests/**`

**Implementation notes:**
1. In `sales-orders`, validate that optional `salesQuoteId` belongs to `ctx.company.id` before copying lines or confirming the quote.
2. In `delivery-notes`, validate that optional `salesOrderId` belongs to `ctx.company.id` and matches the selected/owned customer where relevant.
3. In billing portal route, derive the Stripe customer id from server-side tenant/company billing records instead of accepting arbitrary `stripeCustomerId` from request JSON.
4. Use consistent error statuses: 400 for invalid payload, 403 for forbidden, 404 for not-owned/not-found where current app convention supports it.
5. Add tests that prove cross-company IDs cannot mutate or read data.

**Acceptance criteria:**
- No sales order can be created from another company’s quote.
- No delivery note can be created from another company’s order.
- Billing portal cannot be opened for a client-supplied Stripe customer from another tenant.
- Tests cover positive and negative tenant cases.

**Verification:**
- Targeted backend/API tests for `sales-orders`, `delivery-notes`, and billing portal pass.
- `npm test`
- `npm run typecheck`
- Security reviewer confirms no route trusts tenant/company identifiers supplied by the browser when server state exists.

---

### L2-03 — Make customer-to-cash backend transitions complete and atomic

**Priority:** P1

**Primary owner:** Backend

**Objective:** Make quote/order/delivery/invoice/inventory transitions produce complete accounting/business records and keep inventory updates atomic.

**Why now:** Backend audit found `convertDeliveryToInvoice` creates incomplete invoices, inventory refresh work happens outside some transactions, and audit logging is inconsistent/non-transactional.

**Files likely to change:**
- `src/server/sales/service.ts`
- `src/app/api/goods-receipts/route.ts`
- `src/app/api/delivery-notes/route.ts`
- `src/server/inventory/stock-location.ts`
- `src/server/inventory/stock-movement-service.ts`
- `src/server/purchases/service.ts`
- `src/server/audit.ts`
- Tests for sales, delivery, invoice, inventory, and audit flows

**Implementation notes:**
1. Extend delivery-to-invoice conversion to copy invoice lines, totals, taxes/retentions, and any required accounting/posting behavior expected by existing invoice flows.
2. Ensure stock movements and stock-location refreshes happen within a consistent transaction boundary or are otherwise idempotent and recoverable.
3. Make `recordAudit` transaction-aware where it is called inside purchase/sales mutations.
4. Add coverage for critical mutation audit events, especially sales quote/order/delivery/invoice, goods receipts, supplier invoices, and security-policy mutations.

**Acceptance criteria:**
- Delivery-to-invoice creates a usable invoice with lines and totals, not only a header.
- Inventory cannot persist a movement without the corresponding stock-location state update, or vice versa.
- Audit events are committed/rolled back consistently with their parent mutation.
- Tests include rollback/failure cases for at least one inventory transition.

**Verification:**
- Targeted unit/integration tests for `convertDeliveryToInvoice`.
- Targeted tests for goods receipt and delivery note stock movement behavior.
- `npm test`
- `npm run typecheck`
- Optional E2E customer-to-cash journey in L2-06/L2-04 confirms the flow from UI.

---

### L2-04 — Harden E2E fixtures and CI release gates

**Priority:** P1

**Primary owner:** QA + DevOps

**Objective:** Make Playwright and GitHub Actions catch real release regressions instead of reporting green with skipped critical journeys.

**Why now:** QA audit found default E2E passes with 22 passed/4 skipped, forced invoice-lines fails during login, and CI does not run Playwright.

**Files likely to change:**
- `playwright.config.ts`
- `tests/e2e/**/*.spec.ts`
- `tests/e2e/**/fixtures*` or new shared fixture files
- `scripts/e2e-web-server.mjs`
- `.github/workflows/ci.yml`
- `package.json`

**Implementation notes:**
1. Add shared auth/onboarding fixture with stable waits and deterministic seeded data.
2. Remove `DATABASE_URL` skips from mandatory business specs by providing a managed E2E DB through CI/local scripts.
3. Replace external admin credential dependency with an ephemeral seeded admin for security-policy E2E, or mark it as explicitly non-mandatory with reviewer approval.
4. Add CI jobs for install, browser install/cache, DB migration, build, Playwright mandatory suite, and upload of traces/screenshots on failure.
5. Add a policy that fails or reports blocking warnings when mandatory specs are skipped.

**Acceptance criteria:**
- `npm run test:e2e` no longer silently hides mandatory customer-to-cash, invoice-lines, inventory, or security-policy journeys.
- The previously forced `tests/e2e/invoice-lines.spec.ts` reaches the business assertion instead of failing at login.
- GitHub Actions runs a representative Playwright gate with artifacts on failure.
- Local E2E docs explain ports: `PORT` and `E2E_DATABASE_PORT`.

**Verification:**
- `npm run test:e2e`
- Targeted `npx playwright test tests/e2e/invoice-lines.spec.ts --reporter=line`
- CI workflow dry-run/review plus successful GitHub Actions run.
- Confirm skipped tests list is empty or explicitly allowlisted in output.

---

### L2-05 — Build product dashboard cockpit and guided demo path

**Priority:** P0/P1

**Primary owner:** Frontend + Product

**Objective:** Turn post-login into a useful ERP cockpit and first-run/demo journey instead of a static module launcher.

**Why now:** Product audit marked dashboard cockpit and guided demo/onboarding as P0 gaps. Frontend audit also called out first-run/next-action affordances.

**Files likely to change:**
- `src/app/dashboard/page.tsx`
- `src/components/layout/app-shell.tsx`
- Existing dashboard/reporting components under `src/components/**` or new dashboard cards
- Seed/demo data utilities if needed
- E2E smoke/demo tests under `tests/e2e/**`

**Implementation notes:**
1. Add next-action cards for common jobs: create customer, create quote/order, issue invoice, record payment, review inventory.
2. Use first-run empty states that explain why a module matters and link to the next best action.
3. Add demo-data awareness if seed data exists; avoid hardcoding fake metrics when real operational data is available.
4. Keep UI consistent with existing `buttonVariants`, `cn`, Card, Badge, and shell patterns.
5. Avoid adding a new onboarding framework unless the simple guided path is insufficient.

**Acceptance criteria:**
- A new user or demo user can understand the next 3 actions from `/dashboard` without external narration.
- Dashboard has useful empty states and CTAs when data is absent.
- Dashboard reflects real or seeded operational state; placeholder metrics are labeled or removed.
- Mobile layout remains usable inside the current app shell.

**Verification:**
- Component/unit tests where logic is extracted.
- Playwright smoke for first-run dashboard and primary CTAs.
- Manual/browser review at desktop and mobile widths.
- `npm run typecheck`, `npm run lint`, `npm test`.

---

### L2-06 — Connect the customer-to-cash journey in UI and tests

**Priority:** P1

**Primary owner:** Full-stack + QA

**Objective:** Make the app guide a user through customer → quote/order → delivery/invoice → payment/reporting with visible continuity.

**Why now:** Product audit found flows exist but pages do not guide the user through the journey. Backend and QA cards must supply safe transitions and reliable tests.

**Dependencies:** L2-02, L2-03, and L2-04 should be complete or nearly complete before this card is accepted.

**Files likely to change:**
- Sales document pages/routes under `src/app/**sales**`, `src/app/**invoice**`, `src/app/**delivery**` as applicable
- Shared navigation/action components under `src/components/**`
- `tests/e2e/document-pipelines.spec.ts`
- `tests/e2e/invoice-lines.spec.ts`
- Any reporting/dashboard components reused by the flow

**Implementation notes:**
1. Add contextual CTAs after each successful step: from customer to quote/order, from order to delivery, from delivery to invoice, from invoice to payment/collection.
2. Preserve tenant and ownership checks from L2-02; do not pass trusted business identifiers only through hidden client inputs.
3. Add visible status progression and links back to source documents.
4. Use existing route conventions and app shell navigation instead of adding a second navigation model.
5. Extend E2E to verify data persists across the journey and that line items/totals survive transitions.

**Acceptance criteria:**
- User can complete a core customer-to-cash path from UI with no manual URL entry.
- Source and target documents are linked and statuses update consistently.
- E2E verifies at least one happy path and one validation/error path.
- No test uses real external credentials or production services.

**Verification:**
- `npx playwright test tests/e2e/document-pipelines.spec.ts tests/e2e/invoice-lines.spec.ts --reporter=line`
- `npm test`
- `npm run typecheck`
- Manual browser pass for journey copy, CTAs, and empty states.

---

### L2-07 — Standardize frontend polish primitives for route states, destructive dialogs, lists, and forms

**Priority:** P1/P2

**Primary owner:** Frontend

**Objective:** Reduce perceived rough edges by replacing ad hoc UX with shared accessible primitives.

**Why now:** Frontend audit found missing route-level states, native confirm/alert destructive actions, inconsistent tables/lists, and placeholder/raw-control forms.

**Files likely to change:**
- `src/app/**/loading.tsx`, `src/app/**/error.tsx`, `src/app/**/not-found.tsx` for core segments
- `src/components/delete-button.tsx`
- New or existing dialog component under `src/components/ui/**` or `src/components/**`
- Customers/invoices/resource list components such as `src/components/customers/customers-table.tsx`
- Form components in settings, treasury, accounting, sales/purchase inline controls
- Tests such as `src/components/forms-accessibility.test.ts` and E2E shell/navigation specs

**Implementation notes:**
1. Add shared route-state components and apply them first to core authenticated ERP segments.
2. Replace `window.confirm`/`window.alert` with an accessible destructive-action dialog that supports loading/error states and keyboard navigation.
3. Define a reusable resource-list/table pattern for search, filter, pagination, row actions, and mobile layout; migrate customers and invoices first.
4. Define a reusable accessible field pattern for label, helper text, errors, and required state; migrate the highest-visibility forms first.
5. Keep scope incremental; do not redesign every page in Loop 2.

**Acceptance criteria:**
- Core route segments have loading/error/not-found behavior where applicable.
- Destructive actions no longer rely on native browser dialogs.
- Migrated lists support consistent empty/search/pagination/mobile behavior.
- Migrated forms have visible labels and accessible error/help text.
- Existing TanStack/React Compiler warning is either resolved or explicitly tracked with reviewer-approved rationale.

**Verification:**
- `npm run lint`
- `npm test`
- Targeted component tests for confirm dialog and field/list primitives.
- Playwright smoke for destructive action and at least one migrated list/form.
- Optional a11y browser smoke from L2-04 if axe or equivalent is added.

---

### L2-08 — Complete release runbook, observability checks, and review checklist

**Priority:** P1/P2

**Primary owner:** DevOps + PM/QA

**Objective:** Make release readiness observable and reviewable after code changes land.

**Why now:** DevOps audit found missing health/readiness endpoint and incomplete deploy docs; QA/Product audits need a consistent review path for demo, E2E, and browser polish.

**Dependencies:** L2-01 and L2-04 should land first; L2-05/L2-06/L2-07 feed final product review steps.

**Files likely to change:**
- `src/app/api/health/route.ts`
- `src/app/api/readyz/route.ts`
- Tests for health/readiness routes
- `docs/deploy*.md`, `docs/release*.md`, or new `docs/runbooks/loop-2-release.md`
- `.github/workflows/ci.yml` if health/readiness is included in CI smoke

**Implementation notes:**
1. Add `/api/health` for process liveness and `/api/readyz` for dependency readiness if dependencies can be checked safely.
2. Ensure readiness checks do not leak secrets or internal DSNs.
3. Document local and CI commands for build, migrate, E2E, and release smoke.
4. Add a final review checklist covering backend security, customer-to-cash, first-run dashboard, mobile shell, a11y smoke, and no skipped mandatory E2E.
5. Include known warnings and acceptable waivers in one place.

**Acceptance criteria:**
- Health/readiness endpoints return deterministic JSON and correct HTTP status.
- Runbook explains required envs with placeholders only (`[REDACTED]` for secrets).
- Release checklist can be followed by someone who did not implement the loop.
- Final reviewer can map each Loop 2 card to evidence: tests, CI run, screenshots/traces, or docs.

**Verification:**
- Route handler tests for health/readiness.
- `curl -i http://127.0.0.1:3000/api/health` returns 200 in local dev/build environment.
- `curl -i http://127.0.0.1:3000/api/readyz` returns 200 or documented degraded status based on dependencies.
- Runbook commands are copy-pasteable and redacted.

---

## Dependency map

```text
L2-01 release config + migrations
  ├─> L2-04 E2E fixtures + CI gates
  └─> L2-08 release runbook + health/readiness

L2-02 backend tenant/security
  └─> L2-06 customer-to-cash UI journey

L2-03 backend transitions + atomicity
  └─> L2-06 customer-to-cash UI journey

L2-04 E2E fixtures + CI gates
  ├─> L2-06 customer-to-cash UI journey acceptance
  ├─> L2-07 frontend polish browser checks
  └─> L2-08 final release checklist

L2-05 dashboard cockpit + guided demo
  └─> L2-08 final product review

L2-07 frontend polish primitives
  └─> L2-05/L2-06 can reuse primitives opportunistically, but should not block backend security work
```

Suggested execution order:
1. Start L2-01 and L2-02 immediately in parallel.
2. Start L2-03 after L2-02 test strategy is agreed, because both touch sales/delivery/invoice flows.
3. Start L2-04 as soon as L2-01 provides stable env/DB setup.
4. Start L2-07 independently for low-risk frontend primitives.
5. Start L2-05 after frontend primitives are known enough to avoid duplicated UI patterns.
6. Start L2-06 after L2-02/L2-03 are merged and L2-04 can run mandatory journeys.
7. Finish with L2-08 once implementation evidence exists.

---

## Verification matrix

| Area | Required evidence | Commands / checks | Blocks release? |
| --- | --- | --- | --- |
| TypeScript | No type errors | `npm run typecheck` | Yes |
| Lint | No new lint errors; known warning documented or fixed | `npm run lint` | Yes for errors; warning requires explicit waiver |
| Unit/API tests | Backend transitions, tenant/security, billing, primitives covered | `npm test` plus targeted test commands | Yes |
| Build | Production build succeeds with redacted env values | `DATABASE_URL='[REDACTED]' BETTER_AUTH_SECRET='[REDACTED]' BETTER_AUTH_URL='http://localhost:3000' NEXT_PUBLIC_BETTER_AUTH_URL='http://localhost:3000' npm run build` | Yes |
| DB migrations | Clean DB migrates from tracked migrations | Run documented Postgres/PGlite migration command | Yes |
| E2E mandatory | No hidden skips for critical journeys | `npm run test:e2e`; targeted invoice/document/inventory/admin specs | Yes |
| CI | GitHub Actions includes DB/migrate/build/E2E gate and artifacts | Successful CI run | Yes |
| Health/readiness | Operational endpoints return safe JSON/status | `curl -i /api/health`, `curl -i /api/readyz` | Yes for health; readiness waiver allowed only if documented |
| Product demo | First-run dashboard and customer-to-cash path work | Browser review + Playwright trace/screenshots | Yes |
| Accessibility/polish | Dialogs/forms/lists keyboard and screen-reader basics pass | Component tests + browser smoke/a11y checks | No for all pages; yes for touched core flows |
| Secrets hygiene | No secrets in tracked env/docs/logs | `git diff`, reviewer inspection | Yes |

---

## Review strategy

1. **Per-card implementation review**
   - Reviewer checks acceptance criteria line-by-line.
   - Reviewer verifies files touched match the card scope.
   - Reviewer rejects broad rewrites not required by the card.

2. **Security/backend review gates**
   - Required for L2-02 and L2-03.
   - Check tenant isolation, server-derived identifiers, transaction boundaries, rollback behavior, and audit consistency.

3. **QA/release review gates**
   - Required for L2-01, L2-04, and L2-08.
   - Check clean DB migration, CI coverage, Playwright artifacts, skip policy, and runbook accuracy.

4. **Product/frontend review gates**
   - Required for L2-05, L2-06, and L2-07.
   - Check first-run clarity, connected journeys, mobile shell behavior, empty states, copy consistency, and accessible destructive actions.

5. **Final Loop 2 review**
   - Run the full verification matrix.
   - Compare shipped work against parent audit P0/P1 findings.
   - Produce a short release-readiness note with pass/fail/waived items and links to CI/artifacts.

---

## Risk matrix

| Risk | Severity | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| DB migration repair breaks existing developer data | High | Medium | Use clean DB verification plus backup/rollback instructions; avoid editing schema and migrations blindly in the same commit | DevOps/Backend |
| E2E remains green due hidden skips | High | High | Mandatory skip policy in CI; shared fixture; fail on unallowlisted skips | QA/DevOps |
| Tenant/security fixes miss indirect document paths | High | Medium | Add negative cross-company tests for quote/order/delivery/billing and review all route inputs | Backend/Security |
| Billing portal change lacks canonical Stripe customer source | High | Medium | Add/verify server-side billing customer lookup before removing client payload; block if data model is insufficient | Backend |
| Inventory atomicity fix creates deadlocks or stale stock | Medium | Medium | Keep transaction scope small; add rollback/failure tests; avoid long external work inside tx | Backend |
| Dashboard polish ships placeholder metrics as real data | Medium | Medium | Label demo data clearly or use real aggregates; product review blocks misleading metrics | Product/Frontend |
| Frontend primitive refactor grows into broad redesign | Medium | Medium | Migrate only core segments/customers/invoices/high-visibility forms in Loop 2 | Frontend |
| CI runtime becomes too slow/flaky | Medium | Medium | Split unit/build/E2E jobs, cache browsers, use deterministic ports/DB, upload artifacts for triage | DevOps/QA |
| Secrets leak through env templates or runbook | High | Low | Use placeholders only; reviewer inspects diff; never paste actual env values | All reviewers |

---

## Explicit non-goals

- Do not implement new ERP modules or expand scope beyond existing Loop 2 audit findings.
- Do not replace the current auth provider, database layer, app shell, or UI library.
- Do not add real production credentials, customer data, or Stripe secrets to env templates, docs, tests, traces, or screenshots.
- Do not accept a green E2E run that hides mandatory flows through environment-based skips.
- Do not redesign every CRUD page; standardize the most visible/core flows first.
- Do not solve all reporting/BI needs in Loop 2; dashboard/reporting should surface practical next actions and core operational signals.
- Do not make `/api/readyz` perform destructive checks or expose internal connection strings.
- Do not merge migration changes without clean-database verification.

---

## Card split recommendation for Kanban

Create 8 implementation cards from this document:
1. `L2-01 Release env templates and migrations` — assignee: DevOps/Backend.
2. `L2-02 Backend tenant and billing security fixes` — assignee: Backend.
3. `L2-03 Customer-to-cash backend transitions and inventory atomicity` — assignee: Backend.
4. `L2-04 E2E fixtures and CI gates` — assignee: QA/DevOps.
5. `L2-05 Dashboard cockpit and guided demo` — assignee: Frontend/Product.
6. `L2-06 Connected customer-to-cash UI journey` — assignee: Full-stack/QA.
7. `L2-07 Frontend polish primitives` — assignee: Frontend.
8. `L2-08 Release runbook, health/readiness, and final checklist` — assignee: DevOps/PM.

Keep cards small in implementation PRs. If a card requires more than one day of work, split by testable outcome rather than by layer.
