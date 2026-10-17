import { describe, expect, it } from "vitest";

import { ALLERGENS, dietConflicts, dishWarnings, isSectionAvailable, localized, matchesFilters, pickLang, scheduleLabel } from "./menu";

describe("carta digital", () => {
  it("tiene los 14 alérgenos oficiales sin repetir", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(new Set(ALLERGENS.map((allergen) => allergen.id)).size).toBe(14);
  });

  it("elige idioma por petición o por el navegador", () => {
    expect(pickLang("en-GB,en;q=0.9")).toBe("en");
    expect(pickLang("es-ES,es;q=0.9")).toBe("es");
    expect(pickLang("ca-ES")).toBe("es");
    expect(pickLang("de-DE", "es")).toBe("es");
    expect(pickLang(null)).toBe("es");
    expect(localized("Croquetas", "", "en")).toBe("Croquetas");
    expect(localized("Croquetas", "Croquettes", "en")).toBe("Croquettes");
  });

  it("sabe si una sección se sirve ahora", () => {
    const lunch = { weekdays: [1, 2, 3, 4, 5], fromTime: "13:00", toTime: "16:00" };
    expect(isSectionAvailable(lunch, { weekday: 3, time: "13:30" })).toBe(true);
    expect(isSectionAvailable(lunch, { weekday: 3, time: "16:00" })).toBe(false);
    expect(isSectionAvailable(lunch, { weekday: 6, time: "14:00" })).toBe(false);
    expect(isSectionAvailable({ weekdays: [], fromTime: null, toTime: null }, { weekday: 0, time: "03:00" })).toBe(true);
    // Copas de viernes 22:00 a 02:00: el sábado a la 01:00 todavía se sirven.
    const night = { weekdays: [5], fromTime: "22:00", toTime: "02:00" };
    expect(isSectionAvailable(night, { weekday: 6, time: "01:00" })).toBe(true);
    expect(isSectionAvailable(night, { weekday: 6, time: "23:00" })).toBe(false);
    expect(isSectionAvailable(night, { weekday: 5, time: "23:00" })).toBe(true);
  });

  it("describe el horario", () => {
    expect(scheduleLabel({ weekdays: [1, 2, 3, 4, 5], fromTime: "13:00", toTime: "16:00" }, "es")).toBe("lun–vie · 13:00–16:00");
    expect(scheduleLabel({ weekdays: [6, 0], fromTime: null, toTime: null }, "en")).toBe("Sat, Sun");
    expect(scheduleLabel({ weekdays: [], fromTime: null, toTime: null }, "es")).toBeNull();
  });

  it("detecta dietas incoherentes con los alérgenos", () => {
    expect(dietConflicts(["EGGS", "GLUTEN"], ["VEGAN"])).toEqual(["Marcado vegano pero lleva huevos."]);
    expect(dietConflicts(["MILK"], ["VEGETARIAN"])).toEqual([]);
    expect(dietConflicts(["FISH"], ["VEGETARIAN"])[0]).toMatch(/vegetariano pero lleva pescado/);
    expect(dietConflicts([], ["GLUTEN_FREE"], ["GLUTEN"])[0]).toMatch(/trazas de gluten/);
    expect(dietConflicts(["MILK"], ["LACTOSE_FREE"])).toHaveLength(1);
    expect(dietConflicts([], ["VEGAN", "GLUTEN_FREE"])).toEqual([]);
    expect(dietConflicts(["MILK"], ["PREGNANCY_SAFE"])[0]).toMatch(/embarazadas con lácteos.*pasteurizados/);
    expect(dietConflicts(["MILK", "EGGS"], ["PREGNANCY_SAFE", "PASTEURIZED"])).toEqual([]);
    expect(dietConflicts(["GLUTEN"], ["PREGNANCY_SAFE"])).toEqual([]);
  });

  it("separa lo que contiene de las trazas según lo que evita el cliente", () => {
    expect(dishWarnings({ allergens: ["GLUTEN"], traces: ["SESAME", "GLUTEN"] }, ["GLUTEN", "SESAME", "FISH"])).toEqual({ contains: ["GLUTEN"], traces: ["SESAME"] });
    expect(dishWarnings({ allergens: [] }, ["FISH"])).toEqual({ contains: [], traces: [] });
  });

  it("filtra por alérgenos, dieta y texto", () => {
    const croquetas = { name: "Croquetas de jamón", description: "Bechamel casera", allergens: ["GLUTEN", "MILK"], tags: [] };
    const ensalada = { name: "Ensalada", description: null, allergens: [], tags: ["VEGAN"] };
    const none = { without: [] as string[], diet: "ALL" as const, query: "" };
    expect(matchesFilters(croquetas, { ...none, without: ["GLUTEN"] })).toBe(false);
    expect(matchesFilters(ensalada, { ...none, without: ["GLUTEN"] })).toBe(true);
    expect(matchesFilters(ensalada, { ...none, diet: "VEGETARIAN" })).toBe(true);
    expect(matchesFilters(croquetas, { ...none, diet: "VEGAN" })).toBe(false);
    expect(matchesFilters(croquetas, { ...none, query: "JAMON" })).toBe(true);
    expect(matchesFilters(croquetas, { ...none, query: "casera" })).toBe(true);
    expect(matchesFilters(ensalada, { ...none, pregnant: true })).toBe(false);
    expect(matchesFilters({ ...ensalada, tags: ["VEGAN", "PREGNANCY_SAFE"] }, { ...none, pregnant: true })).toBe(true);
  });
});
