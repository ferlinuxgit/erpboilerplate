import { describe, expect, it } from "vitest";

import { pendingMigrations } from "../../../scripts/migrate.mjs";

const migrations = [1000, 2000, 3000].map((folderMillis) => ({ folderMillis, hash: `h${folderMillis}`, sql: [], bps: true }));

describe("scripts/migrate.mjs", () => {
  it("applies everything on an empty database", () => {
    expect(pendingMigrations(migrations, null)).toHaveLength(3);
  });

  it("applies only what comes after the last migration recorded (as drizzle-kit does)", () => {
    expect(pendingMigrations(migrations, "2000").map((migration: { folderMillis: number }) => migration.folderMillis)).toEqual([3000]);
    expect(pendingMigrations(migrations, 3000)).toHaveLength(0);
  });
});
