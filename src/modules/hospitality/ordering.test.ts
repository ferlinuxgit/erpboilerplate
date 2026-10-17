import { describe, expect, it } from "vitest";

import { grossPrice } from "@/modules/pos/model";

import { applyModifiers, fireThreshold, firesNow, nextHeldCourse, resolveModifiers, resolveSetMenu } from "./ordering";

const groups = [
  { id: "g1", name: "Punto", minSelect: 1, maxSelect: 1, options: [{ id: "poco", name: "Poco hecho", price: 0 }, { id: "punto", name: "Al punto", price: 0 }] },
  { id: "g2", name: "Extras", minSelect: 0, maxSelect: 2, options: [{ id: "patatas", name: "Patatas", price: 1.5 }, { id: "huevo", name: "Huevo", price: 1 }, { id: "queso", name: "Queso", price: 1 }] },
];

describe("modificadores", () => {
  it("exige los obligatorios y respeta los máximos", () => {
    expect(resolveModifiers(groups, [])).toEqual({ error: "Elige punto." });
    expect(resolveModifiers(groups, ["punto", "patatas", "huevo", "queso"])).toEqual({ error: "En «Extras» se pueden elegir 2 como mucho." });
    expect(resolveModifiers(groups, ["punto", "nada"])).toMatchObject({ error: expect.stringMatching(/ya no existe/) });
    expect(resolveModifiers(groups, ["patatas", "punto"])).toEqual({ modifiers: [{ group: "Punto", name: "Al punto", price: 0 }, { group: "Extras", name: "Patatas", price: 1.5 }] });
  });

  it("suma los suplementos (PVP) al precio sin IVA y los nombra en la descripción", () => {
    const line = applyModifiers({ description: "Entrecot", unitPrice: 18.18, taxRate: 10 }, [{ group: "Punto", name: "Al punto", price: 0 }, { group: "Extras", name: "Patatas", price: 1.5 }]);
    expect(line.description).toBe("Entrecot · Al punto, Patatas");
    // 20,00 € + 1,50 € = 21,50 €; al 10 % no hay base exacta, así que se cobra 21,49 (nunca de más).
    expect(grossPrice(line.unitPrice, 10)).toBe(21.49);
    const exact = applyModifiers({ description: "Hamburguesa", unitPrice: 10, taxRate: 10 }, [{ group: "Extras", name: "Queso", price: 1 }]);
    expect(grossPrice(exact.unitPrice, 10)).toBe(12);
    expect(applyModifiers({ description: "Caña", unitPrice: 1.82, taxRate: 10 }, [])).toEqual({ description: "Caña", unitPrice: 1.82 });
  });
});

describe("menús", () => {
  const courses = [
    { id: "c1", name: "Primero", course: 1, choices: [{ itemId: "ensalada", name: "Ensalada", supplement: 0 }, { itemId: "sopa", name: "Sopa", supplement: 0 }] },
    { id: "c2", name: "Segundo", course: 2, choices: [{ itemId: "pollo", name: "Pollo", supplement: 0 }, { itemId: "entrecot", name: "Entrecot", supplement: 3 }] },
  ];

  it("pide un plato por tiempo y suma los suplementos", () => {
    expect(resolveSetMenu(courses, [{ courseId: "c1", itemId: "sopa" }])).toEqual({ error: "Elige el segundo." });
    expect(resolveSetMenu(courses, [{ courseId: "c1", itemId: "sopa" }, { courseId: "c2", itemId: "sopa" }])).toEqual({ error: "Ese plato no está en «Segundo»." });
    expect(resolveSetMenu(courses, [{ courseId: "c1", itemId: "sopa" }, { courseId: "c2", itemId: "entrecot" }])).toEqual({
      dishes: [
        { courseId: "c1", itemId: "sopa", name: "Sopa", course: 1, supplement: 0 },
        { courseId: "c2", itemId: "entrecot", name: "Entrecot", course: 2, supplement: 3 },
      ],
      supplement: 3,
    });
    expect(resolveSetMenu([], [])).toMatchObject({ error: expect.any(String) });
  });
});

describe("tiempos", () => {
  it("marcha el primer tiempo que haya en la mesa", () => {
    const pending = [{ station: "KITCHEN", course: 2, status: "PENDING" }, { station: "KITCHEN", course: 3, status: "PENDING" }, { station: "BAR", course: 0, status: "PENDING" }];
    // Solo segundos y terceros: salen los segundos, los terceros esperan.
    const threshold = fireThreshold(1, pending);
    expect(threshold).toBe(2);
    expect(pending.map((line) => firesNow(line, threshold))).toEqual([true, false, true]);
    // Con primeros en la mesa, los segundos esperan.
    expect(fireThreshold(1, [...pending, { station: "KITCHEN", course: 1, status: "SENT" }])).toBe(1);
    // Ya servidos los primeros y marchados los segundos: lo nuevo de 2º sale directo.
    expect(fireThreshold(2, [{ station: "KITCHEN", course: 1, status: "SERVED" }, { station: "KITCHEN", course: 2, status: "PENDING" }])).toBe(2);
    expect(fireThreshold(1, [])).toBe(1);
  });

  it("encuentra el siguiente tiempo en espera", () => {
    expect(nextHeldCourse([{ station: "KITCHEN", course: 3, status: "SENT", firedAt: null }, { station: "KITCHEN", course: 2, status: "SENT", firedAt: null }, { station: "KITCHEN", course: 1, status: "SENT", firedAt: new Date() }])).toBe(2);
    expect(nextHeldCourse([{ station: "KITCHEN", course: 2, status: "SENT", firedAt: new Date() }])).toBeNull();
  });
});
