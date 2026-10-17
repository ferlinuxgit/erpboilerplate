import { describe, expect, it } from "vitest";

import { autoLayout, clampToPlan, findFreeSpot, overlaps, PLAN_COLS } from "./floor-plan";

describe("floor plan", () => {
  it("keeps tables inside the room", () => {
    expect(clampToPlan({ posX: 30, posY: -2, width: 3, height: 2 })).toEqual({ posX: PLAN_COLS - 3, posY: 0, width: 3, height: 2 });
  });

  it("detects overlaps", () => {
    expect(overlaps({ posX: 0, posY: 0, width: 2, height: 2 }, { posX: 1, posY: 1, width: 2, height: 2 })).toBe(true);
    expect(overlaps({ posX: 0, posY: 0, width: 2, height: 2 }, { posX: 2, posY: 0, width: 2, height: 2 })).toBe(false);
  });

  it("places new tables in free spots without touching placed ones", () => {
    const layout = autoLayout([
      { id: "a", posX: 0, posY: 0, width: 2, height: 2 },
      { id: "b", posX: null, posY: null, width: 2, height: 2 },
      { id: "c", posX: null, posY: null, width: 4, height: 2 },
    ]);
    expect(layout[0]).toMatchObject({ posX: 0, posY: 0 });
    expect(layout[1]).toMatchObject({ posX: 3, posY: 0 });
    expect(layout[2]).toMatchObject({ posX: 6, posY: 0 });
    for (const [index, table] of layout.entries()) for (const other of layout.slice(index + 1)) expect(overlaps(table, other)).toBe(false);
    expect(findFreeSpot(layout, 2, 2)).toEqual({ posX: 11, posY: 0 });
  });
});
