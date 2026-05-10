import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

type PackageJson = {
  devDependencies?: Record<string, string>;
};

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("Playwright e2e runtime dependencies", () => {
  test("declares and resolves the PGlite socket server used by the webServer fixture", async () => {
    const packageJson = readPackageJson();
    expect(packageJson.devDependencies).toHaveProperty("pglite-server");

    const packageName = "pglite-server";
    const pgliteServer = await import(packageName);

    expect(pgliteServer).toHaveProperty("createServer");
    expect(typeof pgliteServer.createServer).toBe("function");
  });
});
