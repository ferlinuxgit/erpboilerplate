# QA verification baseline

Source plan: `docs/plans/2026-05-09-kanban-agent-loop-10-10.md`
Task: `t_8b0d6b3e` / L0-D QA test build baseline
Captured at: `2026-05-09T08:16:54Z`
Runner: Node `v22.22.1`, npm `10.9.4`

## Scope

Baseline only. No product implementation changes were made. This audit records the current verification commands, exact pass/fail status, blockers, and recommended CI gate.

Initial git state before QA commands:

```text
?? docs/
```

## Summary matrix

| Gate | Command | Result | Evidence / blocker |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` | PASS | `tsc --noEmit` completed with exit 0. |
| ESLint | `npm run lint` | PASS_WITH_WARNING | exit 0, but React Compiler warns about TanStack `useReactTable()` in `src/components/customers/customers-table.tsx:48`. |
| Unit tests | `npm test` | PASS | Vitest: 2 files / 5 tests passing. |
| Production build | `npm run build` | FAIL | Next build compiles, then fails collecting page data for `/api/accounts` because `DATABASE_URL` is not defined. |
| E2E | `npm run test:e2e` | FAIL_BLOCKED | Playwright browser executable is missing from this QA profile cache. Config also lacks `webServer`, so the script expects an app already listening on `localhost:3000`. |
| Dependency audit | `npm audit --audit-level=moderate` | FAIL | 20 vulnerabilities: 1 low, 17 moderate, 2 high. |

## Blockers and required setup

1. `DATABASE_URL` is required for `npm run build`. Current repo has no `.env` and no `.env.example`, while `README.md` instructs users to copy `.env.example` and set `DATABASE_URL` / `BETTER_AUTH_SECRET`.
2. Playwright browsers are not installed for the QA runner. `npm run test:e2e` fails before reaching the application.
3. `playwright.config.ts` only sets `testDir` and `baseURL`; it does not start Next.js via `webServer`. Even after installing browsers, `npm run test:e2e` will require a separately running app on `http://localhost:3000` unless the config/script is improved.
4. Dependency audit fails at moderate level and includes 2 high severity advisories (`fast-uri`, `fast-xml-builder`). Some transitive issues are via `next` / `better-auth` / `next-intl` / `@sentry/nextjs`; `npm audit fix --force` suggests a breaking downgrade to `next@9.3.3` for the PostCSS chain, so remediation needs package-level review rather than blind force.

## Recommended CI gate script

A conservative CI baseline should start with the gates that currently pass, then fail explicitly on known blockers until they are fixed:

```bash
set -euo pipefail
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

Required before enabling this as a required branch gate:

- Add a committed `.env.example` with safe placeholder values and document which values are required for build/test.
- Decide whether CI uses a real PostgreSQL service/container or a separate test database URL for build-time route/page collection.
- Add Playwright browser installation in CI, e.g. `npx playwright install --with-deps chromium` or equivalent image setup.
- Add Playwright `webServer` config (or a dedicated CI script) so `npm run test:e2e` starts `npm run dev`/`npm start` automatically against a known port.
- Triage `npm audit` findings and pin/upgrade vulnerable packages without forcing a breaking Next.js downgrade.

## Command evidence

### TypeScript

Command: `npm run typecheck`
Exit code: `0`; Duration: `3.96s`; Timed out: `false`

```text

> erpboilerplate@0.1.0 typecheck
> tsc --noEmit

npm notice
npm notice New major version of npm available! 10.9.4 -> 11.14.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.14.1
npm notice To update run: npm install -g npm@11.14.1
npm notice
```

### ESLint

Command: `npm run lint`
Exit code: `0`; Duration: `6.37s`; Timed out: `false`

```text

> erpboilerplate@0.1.0 lint
> eslint


/root/projects/erpboilerplate/src/components/customers/customers-table.tsx
  48:17  warning  Compilation Skipped: Use of incompatible library

This API returns functions which cannot be memoized without leading to stale UI. To prevent this, by default React Compiler will skip memoizing this component/hook. However, you may see issues if values from this API are passed to other components/hooks that are memoized.

/root/projects/erpboilerplate/src/components/customers/customers-table.tsx:48:17
  46 |
  47 | export function CustomersTable({ rows }: CustomersTableProps) {
> 48 |   const table = useReactTable({
     |                 ^^^^^^^^^^^^^ TanStack Table's `useReactTable()` API returns functions that cannot be memoized safely
  49 |     data: rows,
  50 |     columns,
  51 |     getCoreRowModel: getCoreRowModel(),  react-hooks/incompatible-library

✖ 1 problem (0 errors, 1 warning)
```

### Unit tests

Command: `npm test`
Exit code: `0`; Duration: `0.77s`; Timed out: `false`

```text

> erpboilerplate@0.1.0 test
> vitest run


 RUN  v4.1.4 /root/projects/erpboilerplate

 ✓ src/server/taxation/engine.test.ts (3 tests) 5ms
 ✓ src/lib/format.test.ts (2 tests) 26ms

 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at  08:17:05
   Duration  241ms (transform 68ms, setup 0ms, import 98ms, tests 31ms, environment 0ms)
```

### Production build

Command: `npm run build`
Exit code: `1`; Duration: `25.07s`; Timed out: `false`

```text

> erpboilerplate@0.1.0 build
> next build

Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry

▲ Next.js 16.2.4 (Turbopack)

  Creating an optimized production build ...
✓ Compiled successfully in 13.5s
  Running TypeScript ...
  Finished TypeScript in 9.6s ...
  Collecting page data using 7 workers ...
Error: DATABASE_URL no está definida en variables de entorno.
    at <unknown> (.next/server/chunks/_10_01bn._.js:441:47638)
Error: DATABASE_URL no está definida en variables de entorno.
    at <unknown> (.next/server/chunks/_0fdpd22._.js:441:47638)

> Build error occurred
Error: Failed to collect page data for /api/accounts
    at ignore-listed frames {
  type: 'Error'
}
```

### E2E tests

Command: `npm run test:e2e`
Exit code: `1`; Duration: `1.78s`; Timed out: `false`

```text

> erpboilerplate@0.1.0 test:e2e
> playwright test


Running 1 test using 1 worker

  ✘  1 tests/e2e/smoke.spec.ts:3:5 › home carga (4ms)


  1) tests/e2e/smoke.spec.ts:3:5 › home carga ──────────────────────────────────────────────────────

    Error: browserType.launch: Executable doesn't exist at /home/fernando/.hermes/profiles/qa/home/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
    ╔════════════════════════════════════════════════════════════╗
    ║ Looks like Playwright was just installed or updated.       ║
    ║ Please run the following command to download new browsers: ║
    ║                                                            ║
    ║     npx playwright install                                 ║
    ║                                                            ║
    ║ <3 Playwright Team                                         ║
    ╚════════════════════════════════════════════════════════════╝

    Error Context: test-results/smoke-home-carga/error-context.md

  1 failed
    tests/e2e/smoke.spec.ts:3:5 › home carga ───────────────────────────────────────────────────────
```

Additional generated Playwright context confirmed the same blocker:

```text
Error: browserType.launch: Executable doesn't exist at /home/fernando/.hermes/profiles/qa/home/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
Please run: npx playwright install
```

### Dependency audit

Command: `npm audit --audit-level=moderate`
Exit code: `1`; Duration: `7.38s`; Timed out: `false`

```text
# npm audit report

@hono/node-server  <1.19.13
Severity: moderate
@hono/node-server: Middleware bypass via repeated slashes in serveStatic - https://github.com/advisories/GHSA-92pp-h63x-v22m
fix available via `npm audit fix`
node_modules/@prisma/dev/node_modules/@hono/node-server
  @prisma/dev  *
  Depends on vulnerable versions of @hono/node-server
  node_modules/@prisma/dev
    prisma  >=6.20.0-dev.1
    Depends on vulnerable versions of @prisma/dev
    node_modules/prisma

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install drizzle-kit@0.18.1, which is a breaking change
node_modules/@esbuild-kit/core-utils/node_modules/esbuild
  @esbuild-kit/core-utils  *
  Depends on vulnerable versions of esbuild
  node_modules/@esbuild-kit/core-utils
    @esbuild-kit/esm-loader  *
    Depends on vulnerable versions of @esbuild-kit/core-utils
    node_modules/@esbuild-kit/esm-loader
      drizzle-kit  0.17.5-6b7793f - 0.17.5-e5944eb || 0.18.1-065de38 - 0.18.1-f3800bf || 0.19.0-07024c4 - 1.0.0-beta.1-fd8bfcc
      Depends on vulnerable versions of @esbuild-kit/esm-loader
      node_modules/drizzle-kit
        better-auth  1.3.10-beta.1 - 1.3.21 || 1.4.0-beta.1 - 1.4.0-beta.28 || >=1.4.4-beta.1
        Depends on vulnerable versions of drizzle-kit
        Depends on vulnerable versions of next
        node_modules/better-auth

fast-uri  <=3.1.1
Severity: high
fast-uri vulnerable to path traversal via percent-encoded dot segments - https://github.com/advisories/GHSA-q3j6-qgpj-74h6
fast-uri vulnerable to host confusion via percent-encoded authority delimiters - https://github.com/advisories/GHSA-v39h-62p7-jpjc
fix available via `npm audit fix`
node_modules/fast-uri

fast-xml-builder  <=1.1.6
Severity: high
fast-xml-builder allows attribute values with unwanted quotes to bypass malicious or unwanted attributes - https://github.com/advisories/GHSA-5wm8-gmm8-39j9
fast-xml-builder Comment Value regex can be bypassed - https://github.com/advisories/GHSA-45c6-75p6-83cc
fix available via `npm audit fix`
node_modules/fast-xml-builder

fast-xml-parser  <5.7.0
Severity: moderate
fast-xml-parser XMLBuilder: XML Comment and CDATA Injection via Unescaped Delimiters - https://github.com/advisories/GHSA-gh4j-gqv2-49f6
fix available via `npm audit fix`
node_modules/fast-xml-parser
  @aws-sdk/xml-builder  3.894.0 - 3.972.18
  Depends on vulnerable versions of fast-xml-parser
  node_modules/@aws-sdk/xml-builder

hono  <=4.12.17
Severity: moderate
Hono: bodyLimit() can be bypassed for chunked / unknown-length requests - https://github.com/advisories/GHSA-9vqf-7f2p-gf9v
hono/jsx has Unvalidated JSX Tag Names that May Allow HTML Injection - https://github.com/advisories/GHSA-69xw-7hcm-h432
Hono has CSS Declaration Injection via Style Object Values in JSX SSR - https://github.com/advisories/GHSA-qp7p-654g-cw7p
Hono has improper validation of NumericDate claims (exp, nbf, iat) in JWT verify() - https://github.com/advisories/GHSA-hm8q-7f3q-5f36
Hono's Cache Middleware ignores Vary: Authorization / Vary: Cookie leading to cross-user cache leakage - https://github.com/advisories/GHSA-p77w-8qqv-26rm
fix available via `npm audit fix`
node_modules/hono

icu-minify  <=4.9.1
mcp-data-vis vulnerable to denial of service via unsanitized `select` key lookup on `Object.prototype` with `precompile: true` - https://github.com/advisories/GHSA-r27j-894h-3w3p
fix available via `npm audit fix`
node_modules/icu-minify

ip-address  <=10.1.0
Severity: moderate
ip-address has XSS in Address6 HTML-emitting methods - https://github.com/advisories/GHSA-v2v4-37r5-5v8g
fix available via `npm audit fix`
node_modules/ip-address
  express-rate-limit  8.0.1 - 8.5.0
  Depends on vulnerable versions of ip-address
  node_modules/express-rate-limit

next-intl  *
Severity: moderate
next-intl has prototype pollution with `experimental.messages.precompile` via attacker-controlled translation catalog keys - https://github.com/advisories/GHSA-4c35-wcg5-mm9h
Depends on vulnerable versions of next
fix available via `npm audit fix`
node_modules/next-intl

postcss  <8.5.10
Severity: moderate
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output - https://github.com/advisories/GHSA-qx2v-qp2m-jg93
fix available via `npm audit fix --force`
Will install next@9.3.3, which is a breaking change
node_modules/next/node_modules/postcss
  next  9.3.4-canary.0 - 16.3.0-canary.5
  Depends on vulnerable versions of postcss
  node_modules/next
    @sentry/nextjs  >=6.3.6
    Depends on vulnerable versions of next
    node_modules/@sentry/nextjs

20 vulnerabilities (1 low, 17 moderate, 2 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force
```

## Post-command workspace state

After copying the Playwright error into this audit, the generated `test-results/` directory was removed to avoid leaving transient artifacts in the repo workspace.

```text
?? docs/
```

Notes:

- `docs/` was already untracked before this QA run because the loop plan lives there; this task added `docs/audits/qa-baseline.md` under that untracked tree.
