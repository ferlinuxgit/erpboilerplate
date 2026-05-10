# Loop 2 Frontend UI Polish Audit

Date: 2026-05-09
Task: `t_cc3e83a8` / L2-B Frontend UI polish audit after Loop 1
Workspace: `/root/projects/erpboilerplate`
Baseline: current uncommitted Loop 1 workspace on `main`; no implementation changes were reverted.

## Scope and method

Read first: `docs/plans/2026-05-09-loop-2-polish-plan.md`.

Inspected:
- Prior docs: `docs/audits/frontend-ui-ux-audit.md`, `docs/audits/loop-2-product-polish-audit.md`, `docs/audits/loop-2-qa-e2e-regression-audit.md`, `docs/plans/loop-1-implementation.md`.
- App routes under `src/app/**/page.tsx`.
- Layout and UI primitives under `src/components/layout/**` and `src/components/ui/**`.
- Form/table/action components under `src/components/**`.

Static scan snapshot:
- 80 TSX files under `src/`.
- 29 app route pages under `src/app/**/page.tsx`.
- 20 components/pages with `<form>`.
- 17 files with raw `<select>` usage.
- 12 files with `placeholder=`.
- 11 files with `role="alert"` and 11 with `aria-describedby`.
- 0 `src/app/**/loading.tsx` files.
- 0 `src/app/**/not-found.tsx` files.
- 1 file using browser-native destructive feedback (`window.confirm` / `window.alert`).
- `Dialog` primitive exists only in `src/components/ui/dialog.tsx`; no product flow consumes it.
- No shared `PageShell`, `PageHeader`, `EmptyState`, `InlineAlert`, `Skeleton`, `DataTable` or `ConfirmDialog` components found.

## Overall assessment

Loop 1 materially improved the shell, invoice editor, accounting journal editor, inventory operations, sales/purchase pipelines and basic form feedback. The remaining frontend risk is not one catastrophic P0 issue; it is product polish fragmentation: each module hand-rolls pages, lists, empty states, form sections, destructive actions and loading/error affordances differently. That makes the app feel like several stitched demos instead of a finished ERP.

## Findings

### P0

No P0 frontend UI blocker found in static inspection. The app has known product/QA/backend gaps from sibling audits, but this frontend pass did not identify a UI issue that should block all Loop 2 synthesis before any implementation can proceed.

### P1-1 — Missing route-level loading/error/not-found states leaves slow or failed server pages unpolished

Affected files/routes:
- `src/app/invoices/page.tsx` (`/invoices`)
- `src/app/customers/page.tsx` (`/customers`)
- `src/app/accounting/page.tsx` (`/accounting`)
- `src/app/sales/page.tsx` (`/sales`)
- `src/app/purchases/page.tsx` (`/purchases`)
- `src/app/inventory/page.tsx` (`/inventory`)
- `src/app/treasury/page.tsx` (`/treasury`)
- `src/app/settings/**/page.tsx`
- Missing: `src/app/**/loading.tsx`, `src/app/**/error.tsx`, `src/app/**/not-found.tsx`.

Evidence:
- Static scan found zero `loading.tsx` and zero `not-found.tsx` files under `src/app`.
- Core routes perform DB/server work directly before rendering, for example `/invoices` queries customers and invoices before any UI is emitted.
- Several edit pages call `notFound()` but there is no branded module-level `not-found.tsx` fallback.

Impact:
- Slow database/API work produces generic route transitions instead of branded skeletons.
- Runtime failures show framework-level error UI rather than actionable product recovery.
- Edit pages with missing entities are not consistent with the ERP shell, which hurts trust during demo and QA journeys.

Suggested implementation card:
- Add route-level UI states for core ERP modules: shared `RouteLoadingState`, `RouteErrorState` and `RouteNotFoundState`, then wire `loading.tsx`, `error.tsx` and targeted `not-found.tsx` into `dashboard`, `customers`, `invoices`, `accounting`, `inventory`, `sales`, `purchases`, `treasury` and `settings` segments.

Acceptance criteria:
- Loading states use skeleton cards/lists matching each module layout.
- Error states include retry/back-to-dashboard actions and do not expose stack traces.
- Not-found states use Spanish copy, preserve app shell, and include a safe navigation target.

Verification:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:e2e -- tests/e2e/core-modules-smoke.spec.ts`
- Browser review: throttle network and visit `/invoices`, `/inventory`, `/settings/security`, plus one missing edit URL.

### P1-2 — Destructive actions still use native confirm/alert; Dialog primitive is unused

Affected files/routes:
- `src/components/delete-button.tsx:17-29`
- All row action components that consume `DeleteButton`, including:
  - `src/components/customers/customer-row-actions.tsx`
  - `src/components/invoices/invoice-row-actions.tsx`
  - `src/components/accounting/account-row-actions.tsx`
  - `src/components/accounting/journal-entry-row-actions.tsx`
  - `src/components/fiscal/fiscal-report-row-actions.tsx`
  - `src/components/purchases/purchase-order-row-actions.tsx`
  - `src/components/treasury/bank-account-row-actions.tsx`
  - `src/components/treasury/bank-transaction-row-actions.tsx`
- `src/components/ui/dialog.tsx` exists but is not consumed by any product flow.

Evidence:
- `DeleteButton` calls `window.confirm("Esta acción no se puede deshacer. ¿Continuar?")` and `window.alert(...)`.
- Static scan found `Dialog` only in the primitive file and no `<Dialog>` usage elsewhere.

Impact:
- Native dialogs are not brand-consistent, not test-friendly, and produce uneven keyboard/focus behavior across browsers.
- Users cannot see entity context before deleting; every delete has the same generic irreversible warning.
- Errors are announced via `alert()` instead of an accessible inline/toast pattern.

Suggested implementation card:
- Replace `DeleteButton` with a shared `ConfirmDeleteButton` built on `Dialog`, `sonner` and accessible focus management. Require entity label/copy from callers and show pending/error/success states.

Acceptance criteria:
- No `window.confirm` or `window.alert` remains in frontend components.
- Confirmation dialog has title, description, cancel/confirm buttons, `aria-describedby`, focus trap, Escape close and loading disabled state.
- Delete success uses toast and refreshes/redirects consistently.
- Row actions pass contextual labels such as customer/invoice/account names where available.

Verification:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- Add/extend component or E2E coverage for cancel, confirm success and API failure.
- `grep -R "window.confirm\|window.alert" src` returns no matches.

### P1-3 — Tables/lists are inconsistent and mostly lack search, filtering, pagination and responsive semantics

Affected files/routes:
- `src/components/customers/customers-table.tsx`
- `src/app/invoices/page.tsx:71-94`
- `src/app/accounting/page.tsx:33-58`
- `src/app/purchases/page.tsx:32-48`
- `src/app/treasury/page.tsx`
- `src/app/fiscal/page.tsx`
- `src/components/inventory/inventory-operations-panel.tsx`
- `src/app/sales/page.tsx` via `src/components/sales/sales-flow-actions.tsx`

Evidence:
- Only `CustomersTable` uses the table primitive/TanStack; most routes render record lists as repeated bordered `<div>` rows.
- No shared `DataTable`/`ResourceList` component was found.
- `CustomersTable` has no empty-state branch inside the component and no sorting/search/pagination UI.
- Lint still reports/has history of the TanStack React Compiler warning around `src/components/customers/customers-table.tsx:48`; the current file uses `"use no memo"` as a workaround.

Impact:
- Large customer/invoice/accounting/purchase datasets will become difficult to scan.
- Mobile behavior depends on ad-hoc `flex` rows and can overflow or compress actions.
- Empty/list states are copy-only paragraphs in some routes and richer bordered states in others.
- The lingering TanStack warning/workaround means table architecture is still a polish/maintainability hotspot.

Suggested implementation card:
- Introduce shared `ResourceList`/`DataTable` patterns with responsive card fallback, search/filter slots, empty state slot, action column conventions and pagination-ready API. Migrate customers and invoices first, then accounting/purchases/treasury.

Acceptance criteria:
- Customers and invoices expose search/filter by primary business fields.
- Empty states use consistent bordered/dashed component with primary CTA where relevant.
- Lists wrap actions on small screens without horizontal overflow.
- Decide whether to keep TanStack behind an isolated client-only table wrapper or use simple semantic tables/lists to remove the React Compiler warning workaround.

Verification:
- `npm run typecheck`
- `npm run lint` with no new warnings; ideally eliminate the `customers-table` compiler warning/workaround.
- `npm test`
- Add E2E checks for search/filter and responsive row actions on `/customers` and `/invoices`.
- Manual browser widths: 375px, 768px, 1280px.

### P1-4 — Several forms still rely on placeholders/raw controls instead of a reusable accessible field pattern

Affected files/routes:
- `src/components/settings/masters-panel.tsx:43-82`
- `src/components/treasury/create-bank-account-form.tsx:39-40`
- `src/components/accounting/create-account-form.tsx:28-41`
- `src/components/sales/sales-flow-actions.tsx:160-190` (inline quote creation controls)
- `src/components/purchases/purchase-flow-actions.tsx` (inline pipeline controls)
- Raw selects in 17 TSX files, including `create-invoice-form`, `edit-invoice-form`, fiscal/accounting/treasury forms and layout switchers.

Evidence:
- `MastersPanel` inputs use placeholders like `Codigo`, `Nombre`, `Rate` without visible labels or field-level error IDs.
- `create-bank-account-form` uses placeholder-only fields for `Banco` and `IBAN`.
- Multiple forms expose raw `<select className="h-8 rounded-md border px-2 text-sm">` rather than a shared labeled select component.
- Improved forms (`create-invoice-form`, `edit-invoice-form`, journal editor) show the direction: labels, `aria-invalid`, `aria-describedby`, `role="alert"`, pending states and toasts. That pattern is not universal yet.

Impact:
- Placeholder-only controls lose labels after typing and are weaker for screen readers and translation/copy review.
- Form validation and disabled/loading affordances vary by module.
- Future implementation will duplicate more ad-hoc field markup unless a shared form field abstraction exists.

Suggested implementation card:
- Create shared `FormField`, `SelectField`, `SubmitState`/`InlineFormError` helpers and migrate the remaining placeholder-only/raw-select forms, prioritizing settings masters, treasury bank accounts, accounting account creation and sales/purchase inline actions.

Acceptance criteria:
- No required business input depends on placeholder as its only label.
- Selects have visible labels and associated error/help text.
- Submission errors are announced via `role="alert"` or a consistent toast+inline pattern.
- Forms expose consistent pending copy (`Guardando...`, `Creando...`, etc.) and disable duplicate submit.

Verification:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- Extend `src/components/forms-accessibility.test.ts` to cover migrated forms.
- Static check for placeholder-only required inputs in `src/components/**`.

### P2-1 — Page layout and header actions are close but still ad hoc across modules

Affected files/routes:
- `src/app/dashboard/page.tsx`
- `src/app/invoices/page.tsx:45-57`
- `src/app/purchases/page.tsx:18-31`
- `src/app/accounting/page.tsx:21-32`
- `src/app/sales/page.tsx:45-56`
- `src/app/reporting/page.tsx`
- `src/app/settings/**/page.tsx`

Evidence:
- Static scan found no shared `PageShell` or `PageHeader` component.
- Routes repeat `container mx-auto ... px-4 py-10`, `CardHeader`, `Volver`/`Volver al dashboard` links and module descriptions manually.
- Some headers use `flex-row items-start justify-between` without responsive stacking; others place back links inside card content.

Impact:
- Visual rhythm, CTA placement and responsive behavior vary by page.
- New pages can drift quickly because there is no blessed module page template.

Suggested implementation card:
- Add `ModulePage`, `PageHeader` and `PageActions` primitives and migrate high-traffic modules to a consistent title/description/back/action layout.

Verification:
- `npm run lint`
- Browser screenshots at 375px/768px/1280px for dashboard, invoices, purchases, settings/security.

### P2-2 — Dashboard/reporting need frontend affordances for first-run and next-action guidance

Affected files/routes:
- `src/app/dashboard/page.tsx`
- `src/app/reporting/page.tsx`
- `src/app/onboarding/page.tsx`
- Related route CTAs to `/customers`, `/invoices`, `/sales`, `/purchases`, `/inventory`.

Evidence:
- Loop 2 product audit calls out dashboard and connected journey usefulness as a theme.
- Current frontend has module links and some cards, but no shared first-run checklist/empty KPI pattern tying the main journey together.

Impact:
- A demo user can land in a technically functional shell but still not know the best next action.
- Reporting/dashboard can look sparse when seeded data is absent or minimal.

Suggested implementation card:
- Add dashboard first-run/next-action cards backed by current counts: create customer, create invoice, review sales pipeline, check inventory, configure settings. Use the same empty-state component proposed above.

Verification:
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e -- tests/e2e/core-modules-smoke.spec.ts`
- Browser review with empty DB/seeded DB states.

### P2-3 — Hydration posture improved for invoice lines, but table/compiler warning remains a visible quality signal

Affected files/routes:
- `src/components/create-invoice-form.tsx`
- `src/components/customers/customers-table.tsx:1-4,47-52`
- `docs/plans/2026-05-09-loop-2-polish-plan.md:22-26`

Evidence:
- Recent frontend card fixed invoice line hydration mismatch by replacing generated field IDs with deterministic line-number IDs.
- Baseline plan records `npm run lint` passing with one warning in `customers-table/useReactTable`.
- Current `CustomersTable` uses `"use no memo"` before importing TanStack Table.

Impact:
- No active invoice hydration warning found by static inspection, but the remaining table compiler escape hatch is a sign that table architecture should be isolated or simplified before expanding table usage.

Suggested implementation card:
- During shared table/list work, explicitly resolve the customer table lint/compiler workaround and document the chosen pattern for future tables.

Verification:
- `npm run lint`
- Browser console smoke on `/customers` and `/invoices`.

## Suggested Loop 2 frontend implementation card shortlist

1. P1 route states: shared loading/error/not-found UI for core ERP segments.
2. P1 destructive action dialog: replace native confirm/alert with accessible `ConfirmDeleteButton`.
3. P1 resource list/table system: migrate customers and invoices first; design for search/filter/pagination and mobile actions.
4. P1 accessible form field cleanup: migrate settings masters, treasury account creation, accounting account creation and sales/purchase inline controls.
5. P2 page header/layout standardization: shared module page primitives and consistent back/action placement.
6. P2 dashboard first-run/next-action cards using consistent empty-state/CTA patterns.

## Screenshot / browser review targets

Use these routes for visual QA after implementation:
- `/dashboard` at empty and seeded states.
- `/customers` with zero, few and many customers.
- `/invoices` with zero invoices, no active customers, and multiple invoice statuses.
- `/accounting` with long account names and multiple journal entries.
- `/sales` and `/purchases` pipeline flows after one completed transition.
- `/inventory` at mobile width with low-stock alerts and movement history.
- `/settings/masters` and `/settings/security` for dense form readability.

Recommended widths: 375px, 768px, 1280px.

## Verification commands for L2-F / implementers

Baseline gates:

```bash
npm run typecheck
npm run lint
npm test
```

Frontend-specific checks for implementation cards:

```bash
npm run test:e2e -- tests/e2e/core-modules-smoke.spec.ts
npm run test:e2e -- tests/e2e/app-shell-navigation.spec.ts
npm run test:e2e -- tests/e2e/invoice-lines.spec.ts
npm run test:e2e -- tests/e2e/document-pipelines.spec.ts
npm run test:e2e -- tests/e2e/inventory-operations.spec.ts
```

Static checks worth adding or running manually:

```bash
grep -R "window.confirm\|window.alert" src
find src/app -name loading.tsx -o -name error.tsx -o -name not-found.tsx
```

## Notes for synthesis

- Do not treat this audit as a request to create implementation cards directly; L2-F owns synthesis.
- Most frontend P1 work can be done incrementally without touching backend contracts.
- The highest leverage sequence is: shared primitives first (`ConfirmDeleteButton`, route states, form/list helpers), then migrate customers/invoices, then lower-traffic modules.
