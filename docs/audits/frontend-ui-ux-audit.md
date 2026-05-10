# Frontend UI/UX system audit

Source plan: `docs/plans/2026-05-09-kanban-agent-loop-10-10.md`
Task: `t_7496b7c3` / L0-C Frontend UI UX system audit
Captured at: `2026-05-09T08:28:14Z`
Runner: Node `v22.22.1`, npm `10.9.4`

## Scope

L0 audit only. No product implementation changes were made. This document records the current frontend structure, visual system, layout/table/form/dialog patterns, UI states, responsive behavior, accessibility risks, and verification evidence.

The audit is code-led because browser/E2E visual capture is currently blocked in this runner: Playwright browsers are not installed, and Browser tool navigation to the local dev server timed out. The public homepage was still verified with an HTTP request against `npm run dev`.

## Sources inspected

- App routes: `src/app/**/page.tsx` and `src/app/layout.tsx`.
- Shared shell: `src/components/layout/app-shell.tsx`, `src/components/layout/active-context-switcher.tsx`.
- UI primitives: `src/components/ui/button.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `form.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `table.tsx`, `textarea.tsx`.
- Representative feature components/pages: customers, invoices, purchases, sales, inventory, accounting, treasury, fiscal, reporting, billing, onboarding, settings.
- Styling: `src/app/globals.css`, `components.json`, `postcss.config.mjs`.
- Tests/config: `package.json`, `vitest.config.ts`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, existing `src/**/*.test.ts`.

## Frontend map

### Routes

29 app routes were found:

- `/`
- `/auth/login`, `/auth/register`
- `/dashboard`
- `/customers`, `/customers/[id]/edit`
- `/invoices`, `/invoices/[id]/edit`
- `/purchases`, `/purchases/[id]/edit`
- `/inventory`
- `/sales`
- `/accounting`, `/accounting/accounts/[id]/edit`, `/accounting/entries/[id]/edit`, `/accounting/ledger/[accountId]`
- `/treasury`, `/treasury/bank-accounts/[id]/edit`, `/treasury/bank-transactions/[id]/edit`
- `/fiscal`, `/fiscal/[id]/edit`
- `/reporting`
- `/billing`
- `/onboarding`
- `/settings/api-keys`, `/settings/audit`, `/settings/masters`, `/settings/security`, `/settings/team`

Only one app layout exists: `src/app/layout.tsx`. It wraps all non-public routes with `AppShell` and mounts Sonner `<Toaster richColors position="top-right" />`.

### Components

45 TSX components were found under `src/components`:

| Area | Count |
| --- | ---: |
| root shared components | 5 |
| `accounting` | 6 |
| `billing` | 1 |
| `customers` | 3 |
| `fiscal` | 3 |
| `invoices` | 2 |
| `layout` | 3 |
| `onboarding` | 1 |
| `purchases` | 3 |
| `sales` | 1 |
| `settings` | 1 |
| `treasury` | 6 |
| `ui` primitives | 10 |

Pattern counts from static scan:

| Pattern | Count |
| --- | ---: |
| Card usage | 31 |
| Table usage | 2 |
| Dialog usage | 0 |
| Forms | 18 |
| Native/select usage | 20 |
| Window confirm/alert usage | 2 |
| Toast calls | 15 |
| Loading/submitting labels | 121 |
| Empty-state text | 15 |
| Error UI/error handling references | 67 |
| Responsive utility classes | 32 |
| Accessibility label references (`htmlFor`, `aria-*`, `sr-only`) | 39 |

## Visual system

### Current strengths

- Tailwind v4-style CSS is centralized in `src/app/globals.css` with `@import "tailwindcss"`, `tw-animate-css`, `shadcn/tailwind.css`, theme tokens, OKLCH colors, radius scale, light/dark variables, and base body typography.
- Geist and Geist Mono are configured at root layout level and mapped into CSS variables.
- Core primitives exist for Button, Card, Input, Label, Select, Textarea, Table, Dialog, DropdownMenu, and minimal React Hook Form helpers.
- Button and Input primitives include visible focus rings (`focus-visible:ring-*`) and invalid-state styling.
- Cards provide a consistent default content shell across most modules.
- Sonner toasts are available globally and are used in multiple client flows.

### Current gaps

1. Visual identity is still mostly grayscale/default shadcn. There is no product-level brand palette beyond neutral primary/secondary tokens.
2. There is no documented component usage guide or page template, so modules duplicate layouts and form patterns ad hoc.
3. There are no explicit density, spacing, typography, page header, toolbar, badge/status, alert, skeleton, pagination, or empty-state primitives.
4. `Dialog` exists but static scan found no `Dialog` usage. Destructive flows currently use browser-native `window.confirm` / `window.alert`.
5. `Select` primitive exists, but most feature forms use native `<select>` directly or raw inputs with inconsistent labels/classes.

## Layout and navigation audit

### Findings

- `AppShell` is simple and readable, but the sidebar is fixed at `w-64` inside `flex min-h-screen` with no responsive collapse/drawer. On narrow screens, content will be squeezed horizontally rather than becoming a mobile navigation pattern.
- `AppShell` calculates active route (`usePathname`) but does not visually mark the active navigation item. All nav links use the same ghost button treatment.
- The dashboard repeats the app navigation as a long vertical list of secondary buttons. This creates duplication and weak information hierarchy.
- Non-public pages generally use `container mx-auto px-4 py-10`, which is consistent, but page headers/toolbars are not standardized. Some pages put actions inside `CardContent`; others mix links/forms/tables directly.
- Public auth/home routes correctly bypass the shell.

### Recommended remediation

- Add a `PageHeader`/`PageShell` primitive with title, description, breadcrumbs/back action, primary action, and optional toolbar.
- Make `AppShell` responsive: desktop sidebar, mobile top bar + drawer or horizontal nav, and preserved content width.
- Use `pathname` to set `aria-current="page"` and active styling for navigation links.
- Replace the dashboard link list with a module grid or KPI cards that complement the sidebar instead of duplicating it.

## Tables audit

### Findings

- A reusable `Table` primitive exists, but only `CustomersTable` uses TanStack Table. Other module pages mostly render simple lists/cards/forms, so table patterns are not generalized yet.
- `CustomersTable` has good semantic pieces (`TableHeader`, `TableBody`, `TableHead`, etc.) and a basic empty state: `No hay clientes todavía.`
- There is no shared table toolbar, search/filter state, pagination, sorting indicators, row density control, loading skeleton, bulk selection, or responsive overflow wrapper documented at page level.
- ESLint reports a React Compiler warning for TanStack Table in `src/components/customers/customers-table.tsx:48`; exit code is still 0, but the warning should be tracked because it can affect memoization assumptions.

### Recommended remediation

- Extract an `EntityTable`/`DataTable` pattern wrapping horizontal overflow, empty state, loading state, error state, toolbar, sorting, and pagination.
- Document TanStack Table + React Compiler stance. If the warning is acceptable, add an explicit note/exception; otherwise isolate the table hook to avoid passing unstable API values into memoized components.
- Add table stories or tests for empty, single-row, many-row, narrow viewport, and loading states.

## Forms audit

### Findings

- 18 forms exist across modules; several use React Hook Form + Zod (`auth-form`, create customer/invoice, onboarding), while many others use local `useState` plus `fetch`.
- Labels are present in the more complete RHF forms (`htmlFor` + `id`), but some state-based forms use placeholder-only inputs, e.g. treasury account/transaction forms use raw `<Input value=... placeholder="IBAN" required />` without visible `<Label>`.
- `src/components/ui/form.tsx` is only a minimal wrapper around `FormProvider`, `Controller`, and `useFormContext`; it lacks shadcn-style `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, and `FormMessage` primitives.
- Native selects are frequent (20 matches). Some are styled manually; some could use the `Select` primitive for consistency.
- Loading copy is present (`Guardando...`, `Procesando...`, `Aplicando...`), and submit buttons are disabled during submission in many forms.
- Error rendering varies: some forms use toast errors, some inline red paragraphs, some both, and message tone/classes differ.

### Recommended remediation

- Standardize on one form stack: RHF + schema resolver for business forms unless a form is intentionally trivial.
- Expand `ui/form.tsx` with form field composition primitives and a consistent `FormMessage` tied to `aria-describedby`.
- Require visible labels for every input/select/textarea; placeholders should be examples, not labels.
- Replace repeated raw select classes with `Select` or a richer accessible select primitive.
- Define a single submission/error pattern per form: inline field errors, form-level error alert, success toast only when useful.

## Dialogs and destructive actions audit

### Findings

- `src/components/ui/dialog.tsx` exists but is not used in the scanned TSX files.
- `src/components/delete-button.tsx` uses `window.confirm` for destructive confirmation and `window.alert` for errors. This works functionally but is not brandable, not test-friendly, and offers limited accessibility/custom copy control.
- Dropdown menu is custom stateful markup and lacks menu roles, `aria-expanded`, Escape handling, outside click handling, focus management, and roving focus.

### Recommended remediation

- Replace `window.confirm`/`window.alert` with a reusable `ConfirmDialog` built on `Dialog`.
- Add a shared destructive-action pattern: item name in copy, consequence, cancel/confirm button order, loading state, and toast/inline error handling.
- Either use an accessible menu primitive from Base UI/Radix or complete keyboard/focus semantics in the custom `DropdownMenu`.

## Empty/loading/error state audit

### Empty states

- Empty copy exists in multiple routes (`No hay...`, `sin suscripción`, inventory/reporting placeholders), but there is no shared `EmptyState` primitive.
- Empty states vary in density and action availability. Some tell users what to do next; others are passive.

Recommendation: create `EmptyState` with title, description, optional icon, and primary action.

### Loading states

- Client actions usually disable submit buttons and change button text to `Guardando...`/`Eliminando...`.
- Page-level data loading skeletons are absent. Because most pages are async server components, navigation waits on route data without an app-level loading affordance unless a route-specific `loading.tsx` exists. Static scan found no route `loading.tsx` files.

Recommendation: add route-level `loading.tsx` for key modules and shared skeleton primitives for card/table/form loading.

### Error states

- A global `src/app/error.tsx` exists and captures errors with Sentry, with retry copy and a button.
- Inline/client errors are inconsistent between toast-only, inline paragraph, and browser alert.
- No `not-found.tsx` was found under `src/app`.

Recommendation: add `not-found.tsx`, standardized inline alert/error components, and clear error retry affordances for module pages.

## Responsive behavior audit

### Findings

- Form grids use responsive classes like `md:grid-cols-*`, so many forms likely stack reasonably on mobile.
- The main shell/sidebar has no breakpoint-specific behavior and is the highest responsive risk.
- Tables need a known horizontal overflow strategy for mobile; the current `Table` primitive does not include an overflow container itself.
- Dashboard/module link groups use flex wrap in some public pages, but internal dashboard links are a long list inside a card.

### Recommended remediation

- Add mobile AppShell behavior before expanding modules.
- Wrap tables in a standard `overflow-x-auto` container and test at 320/375/768/1024 px.
- Add Playwright visual smoke tests once browser installation/webServer config is fixed.

## Accessibility audit

### Strengths

- Root HTML language is set to Spanish (`<html lang="es">`).
- Buttons and inputs include focus-visible styling.
- Several forms correctly pair `Label htmlFor` with input `id`.
- Public/login/onboarding forms have meaningful Spanish copy.

### Risks

- Active nav state is not conveyed visually or via `aria-current`.
- Some forms lack visible labels and rely on placeholders.
- Dropdown menu lacks standard menu/focus/keyboard semantics.
- Browser-native confirm/alert is not integrated with app focus/error flow.
- Field-level errors are not consistently tied to inputs through `aria-describedby`.
- `Dialog` implementation is a plain conditional div without focus trap, labelled dialog semantics, portal, overlay click, Escape handling, or `role="dialog"`.

## Prioritized findings

| Severity | Area | Finding | Evidence | Suggested next step |
| --- | --- | --- | --- | --- |
| High | Responsive layout | Desktop sidebar has no mobile collapse/drawer and can squeeze content on narrow viewports. | `src/components/layout/app-shell.tsx:35-52` uses `flex min-h-screen` + `aside w-64` without breakpoints. | Implement responsive AppShell and active state. |
| High | Dialog/accessibility | Dialog primitive is non-modal markup and unused; destructive actions use browser confirm/alert. | `Dialog usage: 0`; `delete-button.tsx` uses `window.confirm`/`window.alert`. | Build accessible `ConfirmDialog`; avoid browser alerts. |
| Medium | Forms/accessibility | Form implementation is inconsistent and some inputs are placeholder-only. | 18 forms; mixed RHF/useState; treasury forms use raw Input placeholders. | Expand form primitives and label/error conventions. |
| Medium | Tables | Data table pattern exists only for customers; no shared toolbar/loading/pagination/responsive wrapper. | `Table usage: 2`; `CustomersTable` is the only feature table match. | Extract shared DataTable pattern. |
| Medium | Loading/empty/error | No route-level loading skeletons; empty/error states are ad hoc. | No `loading.tsx`; no shared `EmptyState`; no `not-found.tsx`. | Add shared state primitives and route loading files. |
| Low | Visual system | Brand/design tokens are neutral default shadcn style. | `globals.css` primary/secondary tokens are grayscale OKLCH. | Define product palette/status tokens before visual polish. |
| Low | Navigation IA | Dashboard duplicates sidebar navigation as a long list. | `src/app/dashboard/page.tsx:31-63`. | Replace with module cards/KPIs. |

## Verification commands and results

### Git state before/while auditing

Command: `git status --short && git branch --show-current`
Exit code: `0`

```text
?? docs/
?? test-results/
main
```

Note: `test-results/` was generated by the E2E attempt and was removed afterwards. `docs/` was already untracked in this L0 loop and now contains this audit plus the existing plan/QA baseline.

### Lint

Command: `npm run lint`
Exit code: `0` with 1 warning

```text
/root/projects/erpboilerplate/src/components/customers/customers-table.tsx
  48:17  warning  Compilation Skipped: Use of incompatible library
TanStack Table's `useReactTable()` API returns functions that cannot be memoized safely
✖ 1 problem (0 errors, 1 warning)
```

### Typecheck

Command: `npm run typecheck`
Exit code: `0`

```text
> erpboilerplate@0.1.0 typecheck
> tsc --noEmit
```

### Unit tests

Command: `npm run test`
Exit code: `0`

```text
✓ src/server/taxation/engine.test.ts (3 tests)
✓ src/lib/format.test.ts (2 tests)
Test Files  2 passed (2)
Tests       5 passed (5)
```

### Production build

Command: `npm run build`
Exit code: `1`

```text
✓ Compiled successfully in 11.3s
Running TypeScript ...
Finished TypeScript in 10.3s ...
Collecting page data using 7 workers ...
Error: DATABASE_URL no está definida en variables de entorno.
Build error occurred
Error: Failed to collect page data for /api/api-keys
```

Interpretation: the frontend compiles and typechecks, but full production build is blocked by missing runtime DB configuration in this environment. The failed route can vary by worker order because Next collects page/API data concurrently; the root blocker is the missing `DATABASE_URL`.

### E2E smoke

Command: `npm run test:e2e`
Exit code: `1`

```text
Error: browserType.launch: Executable doesn't exist at /home/fernando/.hermes/profiles/frontendeng/home/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
Please run: npx playwright install
Error Context: test-results/smoke-home-carga/error-context.md
```

Cleanup: generated `test-results/` was removed after capturing the blocker.

### Local dev homepage HTTP check

Commands:

```bash
npm run dev
python - <<'PY'
import urllib.request
for url in ['http://localhost:3000/','http://127.0.0.1:3000/']:
    r=urllib.request.urlopen(url,timeout=5)
    print(url, r.status, r.geturl(), r.headers.get('content-type'))
PY
```

Result:

```text
http://localhost:3000/ 200 http://localhost:3000/ text/html; charset=utf-8
http://127.0.0.1:3000/ 200 http://127.0.0.1:3000/ text/html; charset=utf-8
```

Browser harness note: `browser_navigate` to both local URLs timed out, so no screenshot was captured in this run.

## Recommended L1 backlog

1. Implement responsive AppShell with active nav state and mobile drawer/topbar.
2. Create shared `PageHeader`, `PageShell`, `EmptyState`, `InlineAlert`, and `Skeleton` primitives.
3. Replace native destructive confirm/alert with accessible `ConfirmDialog`.
4. Standardize form composition on visible labels, field messages, `aria-describedby`, and one submission/error pattern.
5. Extract a reusable DataTable wrapper with overflow, empty/loading/error states, sorting/pagination slots, and test fixtures.
6. Add route `loading.tsx` for data-heavy modules and `not-found.tsx` for app-level missing pages.
7. Fix Playwright setup (`npx playwright install` in CI/profile and `webServer` in `playwright.config.ts`) before attempting visual regression or browser dogfood evidence.
8. Decide brand/status color tokens beyond default grayscale before UI polish work.
