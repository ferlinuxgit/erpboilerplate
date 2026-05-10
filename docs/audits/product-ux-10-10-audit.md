# Product and UX 10/10 Audit

Date: 2026-05-09
Task: L0-A — Product and UX audit
Repository: `/root/projects/erpboilerplate`
Auditor: PM/spec writer

## Executive summary

Current product score: 4.9 / 10.

The codebase already has a broad ERP SaaS skeleton: authenticated dashboard, tenant/company/fiscal-year context, onboarding, customers, invoices, purchases, inventory, accounting, treasury, fiscal reports, reporting, billing and settings pages. The database schema is much richer than the current product surface, which is good for direction but creates a visible gap between "starter shell" and "production-grade ERP".

The highest-priority blockers for a 10/10 product are:
1. Production reliability is not green: `npm run build` fails without `DATABASE_URL` while collecting `/api/api-keys` page data.
2. Many critical ERP workflows are CRUD-lite instead of end-to-end: invoices, purchases, sales, inventory, accounting, treasury and fiscal reporting do not yet close the loop from document -> posting -> stock/cash/tax impact -> audit trail.
3. Settings/security/billing/API keys/team pages read as status/checklist screens more than operational SaaS controls.
4. Several forms and edit screens are not accessibility-ready because they rely on placeholders or unlabeled controls.
5. Navigation is desktop-only and does not yet provide mobile/tablet ergonomics or strong active-section hierarchy.
6. Test coverage is too thin for the product breadth: only 5 unit tests and 1 minimal Playwright smoke spec exist.

Recommendation: treat this audit as Loop 0 backlog. Do not polish visual details before fixing the top reliability, accessibility and end-to-end workflow gaps.

## Verification evidence

Commands executed:

- `node --version && npm --version`
  - Result: Node `v22.22.1`, npm `10.9.4`.
- `npm run typecheck; npm run lint; npm test`
  - Result: typecheck passed.
  - Result: lint passed with 1 warning in `src/components/customers/customers-table.tsx` at line 48 (`react-hooks/incompatible-library` around TanStack `useReactTable`).
  - Result: Vitest passed, 2 files / 5 tests: `src/server/taxation/engine.test.ts`, `src/lib/format.test.ts`.
- `npm run build`
  - Result: failed after successful compile/typecheck during page data collection.
  - Failure: `Error: DATABASE_URL no está definida en variables de entorno.` while collecting page data for `/api/api-keys`.
- `git status --short --branch`
  - Result: `## main...origin/main`; untracked `docs/` and `test-results/` existed before this audit file was written.

Files/directories inspected:

- Plan/readme/schema:
  - `docs/plans/2026-05-09-kanban-agent-loop-10-10.md`
  - `README.md`
  - `package.json`
  - `playwright.config.ts`
  - `tests/e2e/smoke.spec.ts`
  - `src/db/schema.ts`
  - `src/proxy.ts`
  - `src/lib/csrf-client.ts`
  - `src/lib/rbac.ts`
- Pages inspected:
  - `src/app/page.tsx`
  - `src/app/auth/login/page.tsx`
  - `src/app/auth/register/page.tsx`
  - `src/app/dashboard/page.tsx`
  - `src/app/onboarding/page.tsx`
  - `src/app/customers/page.tsx`
  - `src/app/customers/[id]/edit/page.tsx`
  - `src/app/invoices/page.tsx`
  - `src/app/invoices/[id]/edit/page.tsx`
  - `src/app/sales/page.tsx`
  - `src/app/purchases/page.tsx`
  - `src/app/purchases/[id]/edit/page.tsx`
  - `src/app/inventory/page.tsx`
  - `src/app/accounting/page.tsx`
  - `src/app/accounting/accounts/[id]/edit/page.tsx`
  - `src/app/accounting/entries/[id]/edit/page.tsx`
  - `src/app/accounting/ledger/[accountId]/page.tsx`
  - `src/app/treasury/page.tsx`
  - `src/app/treasury/bank-accounts/[id]/edit/page.tsx`
  - `src/app/treasury/bank-transactions/[id]/edit/page.tsx`
  - `src/app/fiscal/page.tsx`
  - `src/app/fiscal/[id]/edit/page.tsx`
  - `src/app/reporting/page.tsx`
  - `src/app/billing/page.tsx`
  - `src/app/settings/security/page.tsx`
  - `src/app/settings/team/page.tsx`
  - `src/app/settings/masters/page.tsx`
  - `src/app/settings/api-keys/page.tsx`
  - `src/app/settings/audit/page.tsx`
- Components inspected:
  - `src/components/layout/app-shell.tsx`
  - `src/components/layout/active-context-switcher.tsx`
  - `src/components/layout/language-switcher.tsx`
  - `src/components/auth-form.tsx`
  - `src/components/onboarding/onboarding-wizard.tsx`
  - `src/components/create-customer-form.tsx`
  - `src/components/customers/customers-table.tsx`
  - `src/components/customers/customer-row-actions.tsx`
  - `src/components/customers/edit-customer-form.tsx`
  - `src/components/create-invoice-form.tsx`
  - `src/components/invoices/edit-invoice-form.tsx`
  - `src/components/invoices/invoice-row-actions.tsx`
  - `src/components/sales/sales-flow-actions.tsx`
  - `src/components/purchases/create-purchase-order-form.tsx`
  - `src/components/purchases/edit-purchase-order-form.tsx`
  - `src/components/purchases/purchase-order-row-actions.tsx`
  - `src/components/accounting/create-account-form.tsx`
  - `src/components/accounting/create-journal-entry-form.tsx`
  - `src/components/accounting/edit-account-form.tsx`
  - `src/components/accounting/edit-journal-entry-form.tsx`
  - `src/components/treasury/create-bank-account-form.tsx`
  - `src/components/treasury/create-bank-transaction-form.tsx`
  - `src/components/fiscal/create-fiscal-report-form.tsx`
  - `src/components/fiscal/edit-fiscal-report-form.tsx`
  - `src/components/settings/masters-panel.tsx`
  - `src/components/billing/billing-actions.tsx`
  - `src/components/delete-button.tsx`
  - `src/components/ui/button.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `form.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `table.tsx`, `textarea.tsx`
- Server services inspected:
  - `src/server/sales/service.ts`
  - `src/server/purchases/service.ts`
  - `src/server/inventory/service.ts`
  - `src/server/accounting/service.ts`
  - `src/server/treasury/service.ts`
  - `src/server/fiscal/service.ts`
  - `src/server/reporting/service.ts`
  - `src/server/team/service.ts`
- Representative API routes inspected:
  - `src/app/api/customers/route.ts`
  - `src/app/api/invoices/route.ts`
  - `src/app/api/purchases/route.ts`
  - `src/app/api/accounts/route.ts`
  - `src/app/api/journal-entries/route.ts`

## Module scorecard

Scores are 0-10 for the current implementation, not for the intended schema.

| Module | Functionality | UX | UI | Reliability | Notes |
|---|---:|---:|---:|---:|---|
| Public landing | 5 | 5 | 6 | 6 | Clear starter pitch, but no pricing/detail routes or product proof. |
| Auth/login/register | 6 | 6 | 6 | 6 | Basic auth form exists; no evidence of recovery, invitation acceptance, email verification UX or abuse states. |
| App shell/navigation | 5 | 4 | 5 | 5 | Sidebar lists core modules but is fixed-width desktop layout; no mobile nav or grouped IA. |
| Onboarding | 5 | 5 | 5 | 5 | Wizard exists and likely bootstraps tenant/company context, but does not yet feel like guided production setup with progress recovery and validation detail. |
| Dashboard | 4 | 5 | 5 | 5 | Useful module cards, but many metrics are placeholders/static summaries rather than operational command center. |
| Customers | 6 | 6 | 6 | 6 | CRUD and table are present; table lint warning and limited search/filter/export/empty-state depth. |
| Invoices | 4 | 4 | 5 | 4 | Can create invoice header with total amount, but no line-item editing workflow despite `invoiceLine` schema; weak accounting/payment/tax lifecycle. |
| Sales cycle | 4 | 4 | 5 | 4 | Quotes/orders/delivery notes exist in services/actions, but UX is action-heavy rather than guided pipeline with reviewable document details. |
| Purchases | 4 | 4 | 5 | 4 | Purchase order creation exists, but no full receiving -> supplier invoice -> payment UX. |
| Inventory | 3 | 4 | 5 | 4 | Inventory page and low-stock alert card exist; missing stock adjustment/transfer/count workflows from the UI. |
| Accounting | 5 | 4 | 5 | 5 | Chart, journal entry and ledger surfaces exist; journal entry form supports only one debit/credit pair, not realistic multi-line accounting. |
| Treasury | 4 | 4 | 5 | 4 | Bank accounts/transactions exist, but reconciliation, matching, cash position, import and approval flows are absent. |
| Fiscal reporting | 3 | 3 | 4 | 4 | Fiscal report CRUD exists; lacks generated returns, validation workflow, submission/export and jurisdiction-specific guidance. |
| Reporting/BI | 4 | 5 | 5 | 5 | Service-backed KPIs exist but no drilldowns, date ranges, exports or explainability. |
| Billing/subscriptions | 4 | 4 | 5 | 4 | Shows plan/subscription and action component, but fallback `price_placeholder` and missing portal/plan management UX block production readiness. |
| Settings/security | 3 | 3 | 4 | 4 | Security page is a static hardening checklist, not actionable persisted settings with RBAC and audit evidence. |
| Settings/team | 4 | 4 | 4 | 4 | Team list exists, but invitation/role editing lifecycle is not productized enough from inspected page/service. |
| Settings/API keys | 3 | 3 | 4 | 3 | Page exists but production build fails while collecting `/api/api-keys`; key lifecycle needs create/revoke/copy-once/audit UX. |
| Settings/audit | 4 | 4 | 4 | 4 | Audit page exists, but needs filtering, actor/resource detail, export and coverage across all sensitive actions. |
| Settings/masters | 5 | 5 | 5 | 5 | Master data panel exists; needs stronger permissions, validation and import/export flows. |
| Test/build baseline | 3 | 3 | 3 | 3 | Typecheck/tests pass, build fails without env, e2e is only a tiny smoke spec. |

## Gap register

### Critical

1. Production build is not green.
   - Evidence: `npm run build` fails during page data collection for `/api/api-keys` because `DATABASE_URL` is missing.
   - Impact: cannot claim reliable deployability; CI/CD would block or require hidden environment coupling.

2. Invoice product flow is not end-to-end.
   - Evidence: `src/components/create-invoice-form.tsx` creates header fields and a single `totalAmount`; schema contains `invoiceLine`, taxes and payments, but inspected UI does not expose full invoice line/tax/payment lifecycle.
   - Impact: ERP cannot produce auditable invoices from line items, tax calculations and payment reconciliation.

3. Inventory has schema depth but no operational workflows.
   - Evidence: schema includes `item`, `warehouse`, `stockMovement`, `stockLocation`, `itemCostHistory`; `src/app/inventory/page.tsx` focuses on inventory/low-stock display.
   - Impact: users cannot adjust stock, transfer stock, perform counts, receive goods or trace movement from the UI.

4. Accounting journal UX is too simple for real ERP use.
   - Evidence: `src/components/accounting/create-journal-entry-form.tsx` provides a basic entry form rather than a multi-line balanced journal editor with debit/credit validation and attachment/context.
   - Impact: incorrect or incomplete postings are likely; accounting module cannot reach production trust.

5. Settings/security are not actionable controls.
   - Evidence: `src/app/settings/security/page.tsx` renders hardening/status content rather than tenant-specific persisted policy controls, role enforcement UI and audit-backed evidence.
   - Impact: admins cannot configure or prove security posture.

### High

6. Mobile/responsive navigation is weak.
   - Evidence: `src/components/layout/app-shell.tsx` uses `flex min-h-screen`, fixed `aside className="w-64"` and no mobile drawer/topbar path.
   - Impact: tablet/mobile users face cramped or unusable ERP navigation.

7. Edit forms have accessibility gaps.
   - Evidence: `src/components/invoices/edit-invoice-form.tsx` renders `Input` and `select` controls without visible `Label`/`aria-label`; `src/components/treasury/create-bank-transaction-form.tsx` and `src/components/fiscal/create-fiscal-report-form.tsx` rely heavily on placeholders.
   - Impact: keyboard/screen-reader usability is below 10/10 and likely fails axe checks.

8. Billing flow has placeholder production configuration.
   - Evidence: `src/app/billing/page.tsx` passes `process.env.NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID ?? "price_placeholder"` to `BillingActions`.
   - Impact: users can hit a non-production checkout path; pricing/portal state can be misleading.

9. Sales and purchase flows are not guided document pipelines.
   - Evidence: services include quote/order/delivery/purchase entities, but inspected UI is mostly forms/actions and does not show stage transitions, required next actions, or document auditability.
   - Impact: users can get stuck or create disconnected documents.

10. Test coverage does not match surface area.
    - Evidence: Vitest has 2 test files / 5 tests; Playwright has one tiny smoke spec; no module e2e coverage for customers/invoices/purchases/inventory/accounting/treasury/settings.
    - Impact: product regressions can ship unnoticed.

11. Error/loading/empty states are inconsistent.
    - Evidence: some forms use toast and field errors; other forms call fetch without `response.ok` handling (for example `src/components/fiscal/create-fiscal-report-form.tsx`) or have minimal local error text.
    - Impact: users may not know whether actions succeeded or failed.

12. Team and API key lifecycle lacks product polish.
    - Evidence: settings pages exist, but need explicit create/invite/revoke/rotate/copy-once states, permissions and audit evidence.
    - Impact: SaaS admin functionality feels incomplete.

### Medium

13. Information architecture mixes English/Spanish and operational/admin modules.
    - Evidence: nav has `Dashboard`, `Billing`, `Reporting` alongside Spanish labels and `Tesoreria` without accent.
    - Impact: lower polish and trust for Spanish-speaking users.

14. Tables need richer data-grid behavior.
    - Evidence: customer table uses TanStack but inspected module tables are mostly simple tables/actions.
    - Impact: production ERP users need search, filters, sorting, pagination, saved views and bulk actions.

15. Reporting lacks date range/drilldown/export UX.
    - Evidence: reporting page imports service-backed cards but no inspected export/drilldown flow.
    - Impact: BI page is informational rather than decision-ready.

16. Onboarding needs recovery and completion state.
    - Evidence: onboarding wizard exists, but product should handle partially completed setup, suggested sample data and next-step checklist.
    - Impact: first-run experience can dead-end or feel fragile.

17. Context switching lacks unsaved-change safeguards and empty options handling.
    - Evidence: `ActiveContextSwitcher` fetches options and applies changes, but no visible error state if PATCH fails and no warning before context changes.
    - Impact: users can lose orientation or silently fail to switch context.

18. Audit log page needs operational filters.
    - Evidence: audit page exists, but must become searchable by actor, action, resource, severity/date and exportable.
    - Impact: compliance workflows are inefficient.

### Low

19. Dashboard cards need stronger prioritization and actionable CTAs.
20. Module copy should consistently explain domain concepts, especially fiscal/accounting/treasury.
21. Placeholder examples should be replaced with tenant-aware defaults where safe.
22. Visual hierarchy is serviceable but could use stronger section grouping, badges and status tokens.

## Top 10 implementable cards

### Card 1 — Make production build green and deterministic

Assignee: `backendeng`
Severity: Critical

User story:
As a maintainer, I need `npm run build` to succeed in CI with documented required env vars or safe build-time behavior, so deployments are reliable.

Acceptance criteria:
- `npm run build` passes in a documented local/CI setup.
- Missing `DATABASE_URL` produces a clear preflight failure before Next page collection, or build-time routes avoid DB access when appropriate.
- `.env.example` documents required variables for build/runtime without secrets.
- CI/checklist includes `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Add/adjust tests or smoke checks that cover the failing `/api/api-keys` build path.

Verification:
- Run `npm run build` and capture success output.
- Confirm no secrets are committed.

### Card 2 — Build real invoice line-item workflow

Assignee: `frontendeng`
Severity: Critical

User story:
As an accounting user, I need to create and edit invoices with line items, quantities, unit prices, taxes, due dates and totals, so invoices are auditable and not just manual total headers.

Acceptance criteria:
- `CreateInvoiceForm` supports adding/removing multiple lines.
- Line totals and invoice grand total are calculated visibly before submit.
- Server payload persists invoice lines using existing `invoiceLine` schema.
- Edit page can view/update header and lines safely.
- Empty customer/item states guide the user to create prerequisites.
- Field labels, errors and keyboard navigation pass accessibility review.

Verification:
- Add unit tests for total calculation.
- Add Playwright flow: create customer -> create invoice with two lines -> verify list/detail total.

### Card 3 — Add inventory operations UX

Assignee: `frontendeng`
Severity: Critical

User story:
As an operations user, I need to receive, adjust, transfer and count stock from the inventory UI, so inventory quantities are not passive read-only data.

Acceptance criteria:
- Inventory page exposes create stock movement actions for receipt, adjustment and transfer.
- Forms require item, warehouse/location, quantity, date and reason/reference.
- Low-stock alert links to the affected item/warehouse context.
- Stock movement history is visible and filterable.
- All operations refresh page data and show success/error states.

Verification:
- Add service tests for stock movement quantity effects.
- Add Playwright flow for creating an adjustment and seeing updated stock/movement history.

### Card 4 — Replace simple journal form with balanced multi-line journal editor

Assignee: `frontendeng`
Severity: Critical

User story:
As an accountant, I need multi-line journal entries that must balance before posting, so I can record real accounting events safely.

Acceptance criteria:
- Journal entry form supports at least two lines and arbitrary additional debit/credit lines.
- UI shows running debit total, credit total and difference.
- Submit is disabled until debits equal credits and required fields are valid.
- Server validates balance independently.
- Edit form preserves and updates lines safely.
- Ledger page links back to source journal entry.

Verification:
- Unit tests for balance validation.
- Playwright flow: create balanced journal entry, verify ledger impact.

### Card 5 — Turn security settings into actionable admin controls

Assignee: `backendeng`
Severity: Critical

User story:
As a tenant admin, I need security settings to be real controls with permissions and audit logs, so I can configure and prove tenant security posture.

Acceptance criteria:
- Security page requires tenant/admin context and displays current policy state.
- Add persisted controls for at least session timeout, 2FA requirement placeholder/status, API key policy and allowed domains/IP notes if supported by schema or a minimal new table.
- Non-admin users cannot change controls.
- Every change writes an audit log entry.
- UI distinguishes enabled, disabled and not-configured states.

Verification:
- Add RBAC tests for admin vs member.
- Add Playwright/admin flow for changing a setting and seeing audit entry.

### Card 6 — Implement responsive app shell navigation

Assignee: `frontendeng`
Severity: High

User story:
As a user on laptop, tablet or phone, I need navigation that adapts to screen size and clearly shows my current section, so I can operate the ERP without layout breakage.

Acceptance criteria:
- Desktop sidebar remains usable with grouped modules.
- Mobile/tablet view uses a topbar + drawer/sheet or collapsible sidebar.
- Active route styling is visible and accessible.
- Nav labels are consistently localized in Spanish.
- Context switcher remains reachable but does not consume excessive mobile space.

Verification:
- Add Playwright screenshots/checks for 390px, 768px and desktop widths on `/dashboard`, `/customers`, `/accounting`.

### Card 7 — Fix form accessibility and error-state consistency

Assignee: `frontendeng`
Severity: High

User story:
As a keyboard or screen-reader user, I need every form control to have a clear label, error association and predictable submit feedback.

Acceptance criteria:
- All inspected forms use `Label htmlFor` or `aria-label` for every input/select/textarea.
- Placeholder-only labels are removed.
- Field errors use `aria-describedby` where practical.
- All fetch submits check `response.ok` and show consistent success/error feedback.
- Cover at least invoice edit, treasury bank transaction, fiscal report create/edit, purchase order create/edit and accounting edit forms.

Verification:
- Run lint.
- Add Playwright/axe or Testing Library checks for the highest-traffic forms.

### Card 8 — Complete billing/subscription admin flow

Assignee: `backendeng`
Severity: High

User story:
As a SaaS owner/admin, I need billing to show real plan state and safe checkout/portal actions, so tenants can manage subscriptions without placeholders.

Acceptance criteria:
- Remove `price_placeholder` fallback from production path.
- If no Stripe price ID is configured, show a disabled action with clear configuration error.
- Add customer portal action if subscription/customer exists.
- Display plan, status, renewal/cancel state and limits from persisted data.
- Audit billing action attempts and errors.

Verification:
- Tests for missing price env behavior.
- Manual/browser check of configured vs unconfigured billing states.

### Card 9 — Productize sales and purchase document pipelines

Assignee: `frontendeng`
Severity: High

User story:
As a sales/purchasing user, I need guided document pipelines, so I can progress quote/order/delivery/invoice and purchase/receipt/supplier-invoice/payment without guessing next steps.

Acceptance criteria:
- Sales page shows stages with counts and next actions: quote -> order -> delivery -> invoice.
- Purchase page shows stages with counts and next actions: purchase order -> goods receipt -> supplier invoice -> payment.
- Each document row exposes valid next transition only.
- Empty states explain prerequisites.
- Error states explain why a transition is blocked.

Verification:
- Add service tests for valid/invalid transitions.
- Add Playwright smoke flow for one happy-path sales or purchase pipeline.

### Card 10 — Establish product e2e smoke coverage per core module

Assignee: `qa`
Severity: High

User story:
As a team shipping a production ERP starter, I need e2e smoke coverage for every core module, so regressions are caught before release.

Acceptance criteria:
- Playwright config starts or documents the required web server setup.
- Add smoke specs for dashboard, customers, invoices, purchases, inventory, accounting, treasury, fiscal, reporting and settings.
- Tests use stable selectors or accessible roles/names, not brittle CSS.
- Include one create flow for at least customers and invoices after prerequisite data setup.
- Test artifacts are ignored or intentionally stored.

Verification:
- Run `npm run test:e2e` successfully in documented environment.
- Keep `npm run typecheck`, `npm run lint`, `npm test` green.

## Kanban child cards created

- Card 1: `t_dc0e7b6b` — L1: Make production build green and deterministic (`backendeng`)
- Card 2: `t_0672bf61` — L1: Build real invoice line-item workflow (`frontendeng`)
- Card 3: `t_72e38cd9` — L1: Add inventory operations UX (`frontendeng`)
- Card 4: `t_d9138611` — L1: Replace simple journal form with balanced multi-line editor (`frontendeng`)
- Card 5: `t_3abbd9c8` — L1: Turn security settings into actionable admin controls (`backendeng`)
- Card 6: `t_f74c7185` — L1: Implement responsive app shell navigation (`frontendeng`)
- Card 7: `t_135f80f8` — L1: Fix form accessibility and error-state consistency (`frontendeng`)
- Card 8: `t_8f5d951a` — L1: Complete billing/subscription admin flow (`backendeng`)
- Card 9: `t_daad2a92` — L1: Productize sales and purchase document pipelines (`frontendeng`)
- Card 10: `t_19bece50` — L1: Establish product e2e smoke coverage per core module (`qa`)

## Suggested loop order

1. Card 1 first: no build, no deploy confidence.
2. Cards 7 and 6 next: accessibility/responsive issues are cross-cutting and unblock reliable UI work.
3. Cards 2, 3, 4, 9 as vertical ERP depth slices.
4. Cards 5 and 8 for admin/SaaS trust.
5. Card 10 after the first fixed flows exist, then make e2e mandatory for later loops.

## No-scope for this audit

- No code implementation was performed.
- No database migrations were generated.
- No browser screenshots were captured in this PM audit pass.
- No secrets or environment variable values were inspected or recorded.
