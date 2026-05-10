# Loop 2 Architecture Review

Task: `t_1ad48b29` / L2-G Architect review Loop 2 plan

Reviewed plan: `docs/plans/loop-2-implementation.md`

Source plan: `docs/plans/2026-05-09-loop-2-polish-plan.md`

Review timestamp: `2026-05-09T12:17:44Z`

## Verdict

APPROVED

The Loop 2 implementation plan is safe to dispatch as implementation Kanban cards. It prioritizes release/data safety before visible polish, maps the parent DevOps/Product/Backend/QA/Frontend audit findings into 8 bounded backlog items, includes dependency ordering, and defines verification gates that are strong enough to prevent a false-green release.

This approval is for the plan and execution sequence only. It does not certify the product as release-ready until the implementation cards produce CI/test/browser evidence and reviewer sign-off.

## Evidence reviewed

Files and artifacts reviewed:

- `docs/plans/2026-05-09-loop-2-polish-plan.md`
- `docs/plans/loop-2-implementation.md`
- `docs/audits/loop-2-devops-release-readiness-audit.md`
- `docs/audits/loop-2-product-polish-audit.md`
- `docs/audits/backend-loop-2-polish-readiness-audit.md`
- `docs/audits/loop-2-qa-e2e-regression-audit.md`
- `docs/audits/loop-2-frontend-ui-polish-audit.md`
- `AGENTS.md`

Relevant baseline facts carried into the review:

- Baseline typecheck/lint/unit tests were reported green in the Loop 2 source plan, with one existing TanStack/React Compiler warning.
- Build succeeds only when required env vars are provided; sanitized templates and docs are still release blockers.
- `.env.example` exists in the workspace but is ignored/untracked, so a clean clone is not reproducible yet.
- Drizzle migrations do not currently prove clean-database parity with the schema.
- E2E default output is not a reliable release gate because critical specs are skipped or fail when forced.
- Backend audits found concrete tenant/security and transactionality risks in sales documents, delivery-to-invoice, inventory, audit logging, and billing portal.
- Product/frontend audits found the highest polish wins in dashboard/first-run guidance, connected customer-to-cash flow, empty states, route states, destructive dialogs, lists and forms.

## Structural review

Automated structural review over `docs/plans/loop-2-implementation.md` found:

- 8 implementation cards: `L2-01` through `L2-08`.
- Every card includes priority, primary owner, objective, why-now rationale, file scope, implementation notes, acceptance criteria, and verification.
- Required global sections are present: source evidence, Definition of Ready, Definition of Done, prioritized backlog, dependency map, verification matrix, review strategy, risk matrix, explicit non-goals, and Kanban split recommendation.
- Dependency-map references resolve to existing L2 card IDs.
- All referenced source/audit documents exist in the workspace.

Card map:

| Card | Primary owner | Priority | Architecture review note |
| --- | --- | --- | --- |
| L2-01 | DevOps + Backend | P0 | Correct first blocker: tracked env templates plus authoritative clean-DB migrations before CI/release. |
| L2-02 | Backend + Security reviewer | P0/P1 | Correctly isolates tenant/security and server-derived billing identifiers before connected UI flows. |
| L2-03 | Backend | P1 | Correct follow-on for delivery-to-invoice completeness, inventory atomicity and audit consistency. |
| L2-04 | QA + DevOps | P1 | Correctly turns E2E/CI from smoke-only to mandatory release signal after env/DB setup stabilizes. |
| L2-05 | Frontend + Product | P0/P1 | Correct visible polish target: dashboard cockpit and guided demo path, with data-aware next actions. |
| L2-06 | Full-stack + QA | P1 | Correctly waits for backend safety and E2E reliability before accepting customer-to-cash UI continuity. |
| L2-07 | Frontend | P1/P2 | Valuable polish primitives; must be executed incrementally to avoid becoming a broad frontend redesign. |
| L2-08 | DevOps + PM/QA | P1/P2 | Correct finalization card after implementation evidence exists: health/readiness, runbook and release checklist. |

## Architecture assessment

### What is strong

1. Scope control is explicit.
   - The plan stays inside existing Loop 2 audit findings and rejects new ERP modules, auth replacement, database-layer replacement, broad UI redesign, unbounded reporting/BI, and unsafe env/secret handling.
   - It uses 8 cards, matching the source plan requirement of 5-8 concrete improvements.

2. Dependency order is sound.
   - Release config and migrations precede CI/E2E and release runbook work.
   - Tenant/security and backend transition correctness precede customer-to-cash UI acceptance.
   - E2E fixture hardening becomes a dependency for accepting UI journeys, rather than letting skipped specs provide false confidence.
   - Final release documentation waits for implementation evidence instead of being written speculatively.

3. Data safety is treated as a blocker.
   - Env templates require placeholders and secret hygiene checks.
   - Migration drift requires clean-DB proof before release.
   - Sales document ownership, billing portal customer derivation, stock transaction boundaries and audit consistency are directly mapped to backend cards.
   - E2E/admin specs are required to avoid human or production credentials.

4. Testability is concrete.
   - The plan names global gates (`typecheck`, `lint`, unit tests, build, migration verification, mandatory Playwright, CI, health/readiness, secrets hygiene).
   - Card-level verification includes targeted backend/API tests, forced E2E specs, browser/manual review where visual polish is involved, and reviewer gates by specialty.
   - The QA skip policy is explicit: mandatory journeys cannot stay hidden behind unaccounted skips.

5. Product polish materially improves the user experience.
   - The plan does not merely add features; it makes the current ERP more coherent: first-run/dashboard guidance, connected customer-to-cash flow, consistent route states, destructive-action dialogs, list/form standards, runbook and release observability.

## Non-blocking recommendations before dispatch

These are not approval blockers, but should be preserved when creating implementation cards:

1. Make L2-05 explicitly include onboarding/home entry points.
   - The product audit's second P0 names `src/app/onboarding/page.tsx`, `src/components/onboarding/onboarding-wizard.tsx`, and `src/app/page.tsx`. The plan covers “guided demo path”, but the implementation card should explicitly include the post-seed redirect/checklist and public-home copy cleanup so the P0 is not interpreted as dashboard-only.

2. Split L2-07 by outcome if it grows.
   - Route states, destructive dialogs, resource lists, and form-field cleanup are all valid, but they should land as small PRs/subtasks with independent tests. Do not allow L2-07 to turn into a whole-app redesign.

3. Resolve concrete Kanban assignees when cards are created.
   - The plan uses owner labels like `DevOps + Backend` and `Frontend + Product`. When dispatching, map these to actual board profiles (`devops`, `backendeng`, `frontendeng`, `qa`, `pm`, `reviewer` or this board's configured equivalents) and use dependencies for handoffs/reviews instead of assigning one card to a composite role.

4. Keep L2-01 migration repair conservative.
   - The migration card should document the source-of-truth decision and clean-DB verification method before changing schema/migrations. Avoid simultaneous schema redesign and migration regeneration unless a reviewer approves the rationale.

5. Require reviewer evidence, not just command names.
   - Implementation handoffs should include CI run links or local command output summaries, Playwright skip counts, migration proof, and browser evidence/screenshots/traces where UI polish is claimed.

## Requested changes

None blocking.

No `REQUEST_CHANGES` items were found. The plan may proceed to implementation-card creation, provided the non-blocking dispatch notes above are carried into the card bodies/reviewer gates.

## Commands executed during review

All commands/read operations targeted `/root/projects/erpboilerplate`.

```bash
# Read project guidance
read_file /root/projects/erpboilerplate/AGENTS.md

# Read reviewed docs and parent audits
read_file docs/plans/loop-2-implementation.md
read_file docs/plans/2026-05-09-loop-2-polish-plan.md
read_file docs/audits/loop-2-devops-release-readiness-audit.md
read_file docs/audits/loop-2-product-polish-audit.md
read_file docs/audits/backend-loop-2-polish-readiness-audit.md
read_file docs/audits/loop-2-qa-e2e-regression-audit.md
read_file docs/audits/loop-2-frontend-ui-polish-audit.md

# Structural verification via Python/Hermes execute_code
# - counted L2 cards
# - validated required global sections
# - validated required card fields
# - validated dependency references
# - checked source/audit document existence
# - checked coverage of parent audit themes
# - captured git status for reviewed docs/audits
```

Observed structural check output summary:

```text
cards_count: 8
missing_card_fields: {}
missing_required_sections: []
bad_dependency_refs: []
source_docs_exist: all checked source/audit docs exist
coverage: all critical P0/P1 themes represented; list/form primitive coverage is present in L2-07 but should be preserved during dispatch
```

Workspace note:

```text
The workspace contains pre-existing untracked docs/audits and Loop 2 plan files. This architecture review created only docs/plans/loop-2-architecture-review.md and did not modify product code.
```

## Final approval condition

Proceed by mapping the approved L2 cards onto Kanban implementation/review tasks with explicit dependencies. Do not collapse backend security, migration/CI, E2E fixture hardening and frontend polish into one omnibus task.
