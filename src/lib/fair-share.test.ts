import { describe, expect, it } from "vitest";

import { fairShare } from "@/lib/fair-share";

describe("reparto justo entre clientes", () => {
  it("alterna entre grupos, con un máximo por grupo y en total", () => {
    const items = [...Array.from({ length: 10 }, (_, index) => `a${index}`), "b0", "b1", "c0"];
    expect(fairShare(items, (item) => item[0], 3, 100)).toEqual(["a0", "b0", "c0", "a1", "b1", "a2"]);
    expect(fairShare(items, (item) => item[0], 3, 4)).toEqual(["a0", "b0", "c0", "a1"]);
    expect(fairShare([], () => "x", 3, 10)).toEqual([]);
  });
});
