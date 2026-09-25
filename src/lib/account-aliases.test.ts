import { describe, expect, it } from "vitest";

import { findAccountForCode, normalizeSearchText, rankAccounts, suggestAccountCodeFromText } from "@/lib/account-aliases";

const accounts = [
  { id: "600", code: "600", name: "Compras de mercaderías" },
  { id: "602", code: "602", name: "Compras de otros aprovisionamientos" },
  { id: "621", code: "621", name: "Arrendamientos y cánones" },
  { id: "622", code: "622", name: "Reparaciones y conservación" },
  { id: "623", code: "623", name: "Servicios de profesionales independientes" },
  { id: "625", code: "625", name: "Primas de seguros" },
  { id: "626", code: "626", name: "Servicios bancarios y similares" },
  { id: "628", code: "628", name: "Suministros" },
  { id: "629", code: "629", name: "Otros servicios" },
  { id: "640", code: "640", name: "Sueldos y salarios" },
  { id: "642", code: "642", name: "Seguridad Social a cargo de la empresa" },
];

const top = (query: string, options = {}) => rankAccounts(accounts, query, options)[0]?.code;

describe("normalizeSearchText", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeSearchText("  Teléfono  MÓVIL! ")).toBe("telefono movil");
  });
});

describe("rankAccounts", () => {
  it("maps plain Spanish words to the right PGC account", () => {
    expect(top("luz")).toBe("628");
    expect(top("gasolina")).toBe("628");
    expect(top("Teléfono")).toBe("628");
    expect(top("alquiler")).toBe("621");
    expect(top("gestor")).toBe("623");
    expect(top("asesoría")).toBe("623");
    expect(top("comisiones bancarias")).toBe("626");
    expect(top("seguro")).toBe("625");
    expect(top("seguridad social")).toBe("642");
    expect(top("nóminas")).toBe("640");
    expect(top("compras mercaderias")).toBe("600");
  });

  it("puts material de oficina in 629 first and 602 as the alternative", () => {
    const codes = rankAccounts(accounts, "material de oficina").map((account) => account.code);
    expect(codes[0]).toBe("629");
    expect(codes).toContain("602");
  });

  it("ranks exact and prefix code matches above name matches", () => {
    expect(top("628")).toBe("628");
    expect(rankAccounts(accounts, "62").every((account) => account.code.startsWith("62"))).toBe(true);
  });

  it("finds accounts by words of their official name", () => {
    expect(top("reparaciones")).toBe("622");
    expect(top("suministros")).toBe("628");
  });

  it("explains which plain word matched", () => {
    expect(rankAccounts(accounts, "luz")[0]).toMatchObject({ code: "628", matchedAlias: "luz" });
  });

  it("shows suggested then recent accounts first when there is no query", () => {
    const ranked = rankAccounts(accounts, "", { suggestedIds: ["628"], recentIds: ["621", "623"] });
    expect(ranked.slice(0, 3).map((account) => [account.code, account.group])).toEqual([
      ["628", "suggested"],
      ["621", "recent"],
      ["623", "recent"],
    ]);
  });

  it("uses suggestion and recency only to break ties", () => {
    expect(top("servicios", { recentIds: ["629"] })).toBe("629");
    expect(top("luz", { recentIds: ["621"] })).toBe("628");
  });

  it("returns nothing for unrelated text", () => {
    expect(rankAccounts(accounts, "zzzz")).toEqual([]);
  });
});

describe("findAccountForCode", () => {
  it("matches exact codes, subaccounts and more detailed suggestions", () => {
    expect(findAccountForCode(accounts, "628")?.id).toBe("628");
    expect(findAccountForCode([{ id: "sub", code: "6280001", name: "Luz local" }], "628")?.id).toBe("sub");
    expect(findAccountForCode(accounts, "6280000")?.id).toBe("628");
    expect(findAccountForCode(accounts, "999")).toBeUndefined();
    expect(findAccountForCode(accounts, "")).toBeUndefined();
  });
});

describe("suggestAccountCodeFromText", () => {
  it("suggests an account only when the document is unambiguous", () => {
    expect(suggestAccountCodeFromText("IBERDROLA CLIENTES\nFactura de electricidad\nConsumo 250 kWh")).toBe("628");
    expect(suggestAccountCodeFromText("Contrato de arrendamiento local comercial - alquiler marzo")).toBe("621");
    expect(suggestAccountCodeFromText("Factura 2026/15\nTotal 121,00")).toBeUndefined();
    // Una palabra de alquiler y otra de seguro: empate → sin sugerencia.
    expect(suggestAccountCodeFromText("alquiler y seguro")).toBeUndefined();
  });
});
