import { describe, expect, it } from "vitest";

import { applyKey } from "./keypad";

describe("pos keypad", () => {
  it("builds amounts with one comma and two decimals", () => {
    const type = (keys: string[]) => keys.reduce((value, key) => applyKey(value, key), "");
    expect(type(["1", "2", ",", "5", "0", "9"])).toBe("12,50");
    expect(type([",", "5"])).toBe("0,5");
    expect(type(["0", "0", "7"])).toBe("7");
    expect(type(["1", ",", ","])).toBe("1,");
    expect(type(["9", "⌫", "4"])).toBe("4");
    expect(type(["5", "C"])).toBe("");
  });
});
