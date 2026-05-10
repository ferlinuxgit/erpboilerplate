# ERP Boilerplate 10/10 Kanban Agent Loop Plan

> **For Hermes:** Use the `programacion` Kanban board with specialist profiles. The controller should route work, not implement directly. Each implementation task must be followed by spec review and quality review before downstream tasks start.

**Goal:** Convert `ferlinuxgit/erpboilerplate` into a production-grade ERP SaaS starter that feels complete, polished, fast, accessible, and reliable across functionality, design, UX and UI.

**Architecture:** Work in loops: audit → spec → implement → review → QA → backlog refinement. Agents should use isolated workspaces/worktrees when possible, commit small changes, and keep parent/child dependencies in Kanban so progress survives restarts. The first loop establishes baselines and prioritized gaps; later loops implement vertical slices until no critical/high findings remain.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/base-ui style components, Drizzle ORM, PostgreSQL, Vitest, Playwright, ESLint.

**Repository:** `/root/projects/erpboilerplate`

**Current baseline verified 2026-05-09:**
- `npm install`: OK, 1306 packages installed. Audit reports 20 vulnerabilities: 1 low, 17 moderate, 2 high.
- `npm run typecheck`: OK.
- `npm run lint`: OK with 1 React Compiler warning in `src/components/customers/customers-table.tsx` about TanStack `useReactTable()` incompatible memoization.
- `npm test`: OK, 2 files / 5 tests passing.
- `npm run test:e2e`: not yet verified in this loop; requires Playwright/browser readiness and possibly app/env setup.

---

## Definition of 10/10 Done

A loop is not complete until all gates pass:

1. **Functionality:** core ERP modules work end-to-end: onboarding, auth, customers, sales, invoices, purchases, inventory, accounting, treasury, fiscal reports, settings/team/security/billing.
2. **Data integrity:** multi-tenant isolation, RBAC, validation, audit logging, fiscal/document numbering, accounting postings and stock movements are covered by tests.
3. **Design/UI:** consistent spacing, typography, empty states, loading states, responsive layouts, polished tables/forms/dialogs, no broken visual hierarchy.
4. **UX:** clear flows, no dead ends, safe destructive actions, useful errors, helpful onboarding, keyboard-friendly actions.
5. **Accessibility:** semantic landmarks, labels, focus states, contrast, keyboard navigation, reduced motion where relevant.
6. **Reliability:** typecheck, lint, unit tests, e2e smoke, build pass; no critical/high regressions.
7. **Observability:** actionable errors/logs around key server actions and APIs.
8. **Security:** auth/RBAC/multi-tenant boundaries tested; secrets not leaked; dependencies reviewed.
9. **Performance:** key pages avoid unnecessary server/client work, heavy tables paginate/filter responsibly, bundle issues reviewed.
10. **Documentation:** README/env/setup/demo flow reflect the actual app.

---

## Kanban Loop Protocol

For every loop:

1. **Architect/PM define exact scope** from latest findings.
2. **Frontend/backend agents implement only assigned slices** with small commits.
3. **Reviewer performs two-stage review:**
   - Spec compliance: did it implement exactly what the card asked?
   - Quality review: code quality, security, UX, tests, maintainability.
4. **QA runs gates:** typecheck, lint, unit tests, e2e/build where available, plus browser UX checks for touched pages.
5. **PM updates scorecard/backlog:** critical/high findings become next-loop cards; done cards include evidence and commands run.
6. Repeat until 10/10 gates pass twice consecutively without new critical/high findings.

Agents must not mark implementation done without:
- Files changed summary.
- Tests/commands run and results.
- Known risks or skipped checks.
- Screenshots or Playwright traces for UI-heavy work when possible.

---

## Initial Task Graph

### L0-A — Product and UX audit

**Assignee:** `pm`

**Objective:** Inspect the existing ERP product and produce a prioritized 10/10 backlog.

**Files to read:**
- `README.md`
- `src/app/**/page.tsx`
- `src/components/**`
- `src/server/**/service.ts`
- `src/db/schema.ts`

**Output required:**
- `docs/audits/product-ux-10-10-audit.md`
- Score each module 0-10 for functionality, UX, UI, reliability.
- List critical/high/medium/low gaps.
- Convert top 10 gaps into implementable cards with acceptance criteria.

**Verification:** Mention exact pages/components inspected.

---

### L0-B — Backend/domain integrity audit

**Assignee:** `backendeng`

**Objective:** Audit API/server/domain logic for correctness, multi-tenancy, RBAC, validation and fiscal/accounting consistency.

**Files to read:**
- `src/app/api/**/route.ts`
- `src/server/**`
- `src/db/schema.ts`
- `src/lib/rbac.ts`
- `src/lib/tenant.ts`
- `src/lib/current-context.ts`

**Output required:**
- `docs/audits/backend-domain-integrity-audit.md`
- Critical paths and missing tests.
- Top backend cards with acceptance criteria.

**Verification:** Include commands run: `npm run typecheck`, `npm test`, targeted service tests if added during audit only as non-invasive checks.

---

### L0-C — Frontend/UI system audit

**Assignee:** `frontendeng`

**Objective:** Audit visual system, page layouts, forms, tables, dialogs, empty/loading/error states and responsive behavior.

**Files to read:**
- `src/app/**/page.tsx`
- `src/components/ui/**`
- `src/components/layout/**`
- `src/components/**/**/*form*.tsx`
- `src/components/**/*table*.tsx`

**Output required:**
- `docs/audits/frontend-ui-ux-audit.md`
- UI consistency map: typography, spacing, cards, tables, forms, dialogs.
- Top frontend cards with acceptance criteria.
- Identify screenshot targets for Playwright/browser review.

**Verification:** Include lint warning analysis for `src/components/customers/customers-table.tsx`.

---

### L0-D — QA/test/build baseline

**Assignee:** `qa`

**Objective:** Establish reliable verification commands and current failure list.

**Commands:**
```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

**Output required:**
- `docs/audits/qa-baseline.md`
- Exact pass/fail output summaries.
- Required env/setup blockers.
- Recommended CI gate script.

**Verification:** Attach command evidence; do not hide failures.

---

### L0-E — DevOps/runtime readiness audit

**Assignee:** `devops`

**Objective:** Check environment, local startup, DB/migrations, seed data, deployment readiness, observability and docs.

**Files to read:**
- `.env.example`
- `drizzle.config.*`
- `src/server/seeds/**`
- `README.md`
- `next.config.*`
- any deployment config present.

**Output required:**
- `docs/audits/devops-runtime-readiness-audit.md`
- Local setup gaps.
- Production readiness gaps.
- Cards for env/docs/CI/deploy improvements.

**Verification:** Include exact startup/build blockers and proposed commands.

---

### L1-F — PM synthesis and loop-1 implementation plan

**Assignee:** `pm`

**Parents:** L0-A, L0-B, L0-C, L0-D, L0-E

**Objective:** Read all L0 audits and create a concrete Loop 1 implementation plan.

**Output required:**
- `docs/plans/loop-1-implementation.md`
- 8-15 cards maximum, ordered by impact and dependency.
- Each card has: assignee, files, acceptance criteria, tests, reviewer gates.
- Include quick wins and at least one vertical slice that improves real user experience.

---

### L1-G — Architect review of Loop 1 plan

**Assignee:** `architect`

**Parents:** L1-F

**Objective:** Validate that Loop 1 is technically coherent, not over-scoped, and likely to improve score.

**Output required:**
- Comment/review in Kanban and/or `docs/plans/loop-1-architecture-review.md`.
- Verdict: APPROVED or REQUEST_CHANGES.

---

### LOOP TEMPLATE — Implementation cards after L1 approval

For each implementation card from `docs/plans/loop-1-implementation.md`:

1. Create implementer card assigned to `frontendeng`, `backendeng`, or `devops`.
2. Create spec review card assigned to `reviewer`, parent = implementer.
3. Create quality review card assigned to `reviewer`, parent = spec review.
4. Create QA verification card assigned to `qa`, parent = quality review.
5. If any review fails, create a new fix card assigned to original specialist, parent = failed review; do not mutate done cards.

---

## Commands agents should prefer

```bash
cd /root/projects/erpboilerplate
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

For UI work, if the app can run locally:

```bash
npm run dev
# then inspect with Playwright/browser and capture screenshots for touched flows
```

---

## First scoring target

After Loop 1, target minimum score:
- Functionality: 7/10+
- Design/UI: 8/10+
- UX: 8/10+
- Reliability/tests: 8/10+
- Security/data integrity: 7/10+

Final 10/10 requires repeated loops, not one big blind implementation.
