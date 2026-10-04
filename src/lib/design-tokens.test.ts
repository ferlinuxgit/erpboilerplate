import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function offenders(pattern: RegExp) {
  return sourceFiles(SRC).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(pattern)].map((match) => `${path.relative(SRC, file)}: ${match[0]}`),
  );
}

describe("tokens de diseño", () => {
  it("usa rounded-control / rounded-surface en lugar de radios arbitrarios", () => {
    expect(offenders(/rounded(?:-[trblse]{1,2})?-\[\d+px\]/g)).toEqual([]);
  });

  it("usa los relieves con nombre (shadow-raised, shadow-sunken…) en lugar de copiarlos", () => {
    expect(offenders(/shadow-\[inset_1px_1px_0_var\(--window-(?:highlight|shadow)\),inset_-1px_-1px_0_var\(--window-[a-z-]+\)\]/g)).toEqual([]);
  });

  it("no baja de 12px en tamaños rem arbitrarios", () => {
    expect(offenders(/text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/g)).toEqual([]);
  });
});
