import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function envKeys(relativePath: string) {
  return new Set(
    readText(relativePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0]),
  );
}

describe("release configuration templates", () => {
  it("keeps sanitized env templates visible to git while ignoring real env files", () => {
    const envExample = spawnSync("git", ["check-ignore", "-q", ".env.example"], {
      cwd: root,
      encoding: "utf8",
    });
    const envTestExample = spawnSync("git", ["check-ignore", "-q", ".env.test.example"], {
      cwd: root,
      encoding: "utf8",
    });
    const realEnv = spawnSync("git", ["check-ignore", "-q", ".env.local"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(envExample.status).toBe(1);
    expect(envTestExample.status).toBe(1);
    expect(realEnv.status).toBe(0);
  });

  it("documents all build, runtime, optional integration, and E2E env names without secrets", () => {
    const requiredKeys = [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "NEXT_PUBLIC_BETTER_AUTH_URL",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID",
    ];

    const templateKeys = envKeys(".env.example");
    const testTemplateKeys = envKeys(".env.test.example");

    for (const key of requiredKeys) {
      expect(templateKeys.has(key), `${key} missing from .env.example`).toBe(true);
    }
    expect(testTemplateKeys.has("DATABASE_URL")).toBe(true);
    expect(testTemplateKeys.has("PLAYWRIGHT_BASE_URL")).toBe(true);
    expect(readText(".env.example")).not.toMatch(/sk_live_|whsec_|postgres:\/\/[^\n]*:[^*@\n]{8,}@/);
  });
});

describe("CI e2e quality gates", () => {
  it("runs Playwright with the mandatory skip policy in the main CI workflow", () => {
    const ci = readText(".github/workflows/ci.yml");

    expect(ci).toContain("npm run test:e2e");
    expect(ci).toContain("E2E_ALLOWED_SKIPS");
    expect(readText("playwright.config.ts")).toContain("skip-policy-reporter.ts");
  });

  it("does not hide mandatory business journeys behind DATABASE_URL skips", () => {
    const mandatorySpecs = [
      "tests/e2e/invoice-lines.spec.ts",
      "tests/e2e/document-pipelines.spec.ts",
      "tests/e2e/inventory-operations.spec.ts",
      "tests/e2e/security-policy-admin.spec.ts",
    ];

    for (const spec of mandatorySpecs) {
      const source = readText(spec);
      expect(source, `${spec} must be mandatory in the default Playwright suite`).not.toMatch(/test\.skip\([^\n]*DATABASE_URL/);
      expect(source, `${spec} must not self-gate on DATABASE_URL`).not.toContain("requiresDatabase");
    }
  });

  it("uploads Playwright artifacts and documents local E2E ports", () => {
    const ci = readText(".github/workflows/ci.yml");
    const readme = readText("README.md");

    expect(ci).toContain("actions/upload-artifact");
    expect(ci).toContain("playwright-report");
    expect(ci).toContain("test-results");
    expect(readme).toContain("PORT");
    expect(readme).toContain("E2E_DATABASE_PORT");
  });
});

describe("authoritative Drizzle migrations", () => {
  it("uses one journaled SQL file per migration with no duplicate numeric prefixes", () => {
    const journal = JSON.parse(readText("drizzle/meta/_journal.json")) as {
      entries: Array<{ tag: string }>;
    };
    const sqlFiles = readdirSync(path.join(root, "drizzle"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => path.basename(file, ".sql"));

    const prefixes = sqlFiles.map((file) => file.split("_", 1)[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(sqlFiles.sort()).toEqual(journal.entries.map((entry) => entry.tag).sort());
  });

  it("exposes a reproducible clean database migration verification command", () => {
    const pkg = JSON.parse(readText("package.json")) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["db:migrate:verify"]).toContain("verify-clean-db-migrations.mjs");
    expect(readText("documentation/deploy.md")).toContain("npm run db:migrate:verify");
  });
});
