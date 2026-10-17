import { describe, expect, it } from "vitest";

import { createsCycle, expandRecipes, foodCost, recipeCost } from "./recipes";

// Hamburguesa: pan, 0,18 kg de carne y 0,03 kg de salsa (que lleva 0,5 de mayonesa y 0,5 de kétchup).
const recipes = new Map([
  ["burger", [{ ingredientItemId: "pan", quantity: 1 }, { ingredientItemId: "carne", quantity: 0.18 }, { ingredientItemId: "salsa", quantity: 0.03 }]],
  ["salsa", [{ ingredientItemId: "mayo", quantity: 0.5 }, { ingredientItemId: "ketchup", quantity: 0.5 }]],
]);
const costs: Record<string, number> = { pan: 0.4, carne: 12, mayo: 4, ketchup: 2 };

describe("escandallos", () => {
  it("desglosa los platos en ingredientes, con sub-recetas y sumando repetidos", () => {
    const totals = expandRecipes([{ itemId: "burger", quantity: 2 }, { itemId: "cana", quantity: 3 }, { itemId: "pan", quantity: 1 }], recipes);
    expect(Object.fromEntries(totals)).toEqual({ pan: 3, carne: 0.36, mayo: 0.03, ketchup: 0.03, cana: 3 });
  });

  it("no entra en bucle si una receta se contiene a sí misma", () => {
    const loop = new Map([["a", [{ ingredientItemId: "b", quantity: 1 }]], ["b", [{ ingredientItemId: "a", quantity: 2 }]]]);
    expect(Object.fromEntries(expandRecipes([{ itemId: "a", quantity: 1 }], loop))).toEqual({ a: 2 });
    expect(createsCycle("salsa", ["burger"], recipes)).toBe(true);
    expect(createsCycle("burger", ["pan", "salsa"], recipes)).toBe(false);
  });

  it("calcula el coste por ración y el food cost", () => {
    // 0,40 + 0,18 × 12 + 0,03 × (0,5 × 4 + 0,5 × 2) = 0,40 + 2,16 + 0,09 = 2,65
    expect(recipeCost("burger", recipes, (id) => costs[id] ?? 0)).toBe(2.65);
    expect(foodCost(2.65, 10)).toEqual({ percent: 26.5, tone: "good" });
    expect(foodCost(3.3, 10).tone).toBe("warning");
    expect(foodCost(4, 10).tone).toBe("bad");
    expect(foodCost(1, 0)).toEqual({ percent: null, tone: "neutral" });
  });
});
