import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const checkBuildEnvScript = path.resolve(process.cwd(), "scripts/check-build-env.mjs");

function withoutBuildEnv() {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.APP_URL;
  delete env.JWT_SECRET;
  return env;
}

describe("build environment preflight", () => {
  it("fails before Next page collection when DATABASE_URL is missing and documents the API keys build path", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "erpboilerplate-build-env-empty-"));
    const result = spawnSync(process.execPath, [checkBuildEnvScript], {
      cwd,
      env: withoutBuildEnv(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).toContain("src/app/api/api-keys/route.ts");
    expect(result.stderr).not.toContain("Collecting page data");
  });

  it("fails before Next build when auth runtime variables are missing", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "erpboilerplate-build-env-db-"));
    const env = withoutBuildEnv();
    env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/erpboilerplate";

    const result = spawnSync(process.execPath, [checkBuildEnvScript], {
      cwd,
      env,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("JWT_SECRET");
    expect(result.stderr).toContain("APP_URL");
  });

  it("loads required variables from a local .env file before checking", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "erpboilerplate-build-env-"));
    writeFileSync(
      path.join(cwd, ".env"),
      [
        "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/erpboilerplate",
        "JWT_SECRET=test-jwt-secret-with-at-least-32-characters",
        "APP_URL=http://localhost:3000",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [checkBuildEnvScript], {
      cwd,
      env: withoutBuildEnv(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Build environment preflight passed.");
  });
});
