import { describe, expect, it } from "vitest";

import { investmentGoodsDueDate, mapInvestmentGoods, type SiiInvestmentGoodSource } from "@/server/sii/investment-goods";

function good(overrides: Partial<SiiInvestmentGoodSource> = {}): SiiInvestmentGoodSource {
  return {
    lineId: "line-1",
    invoiceId: "sup-1",
    number: "FR-0001",
    description: "Máquina cortadora",
    purchaseYear: 2026,
    baseCents: 1_000_000,
    vatCents: 210_000,
    deductiblePct: 100,
    appliedProrrataPct: 80,
    realEstate: false,
    issuer: { name: "Proveedor SL", nif: "B85121501" },
    invoiceNumber: "A/2026/7",
    invoiceIssueDate: "10-03-2026",
    accountingDate: "12-03-2026",
    asset: null,
    ...overrides,
  };
}

describe("libro de bienes de inversión", () => {
  it("año de compra: apunte con la prorrata definitiva y sin regularización", () => {
    const [entry] = mapInvestmentGoods([good()], { year: 2026, finalPct: 80 });
    expect(entry).toEqual({
      sourceId: "line-1:2026",
      problems: [],
      good: {
        invoiceSourceId: "sup-1",
        year: "2026",
        issuer: { name: "Proveedor SL", nif: "B85121501" },
        number: "A/2026/7",
        issueDate: "10-03-2026",
        goodId: "Máquina cortadora",
        startOfUseDate: "12-03-2026",
        finalProrrata: "80.00",
        annualRegularization: null,
      },
    });
  });

  it("años siguientes: regularización (art. 107 LIVA) con la misma función que la casilla 43 del 303", () => {
    // (2.100 × 50 % − 2.100 × 80 %) / 5 = −126 €: la diferencia supera los 10 puntos.
    const [entry] = mapInvestmentGoods([good()], { year: 2027, finalPct: 50, finalByYear: { 2026: 80, 2027: 50 } });
    expect(entry.good).toMatchObject({ year: "2027", finalProrrata: "50.00", annualRegularization: "-126.00" });
    // Diferencia de 10 puntos o menos: el apunte va, con regularización cero.
    expect(mapInvestmentGoods([good()], { year: 2027, finalPct: 75, finalByYear: { 2026: 80 } })[0].good.annualRegularization).toBe("0.00");
  });

  it("solo durante el periodo de regularización (5 años; 10 en terrenos y edificaciones) y desde 3.005,06 €", () => {
    expect(mapInvestmentGoods([good()], { year: 2031, finalPct: 80 })).toEqual([]);
    expect(mapInvestmentGoods([good({ realEstate: true })], { year: 2031, finalPct: 80 })).toHaveLength(1);
    expect(mapInvestmentGoods([good({ baseCents: 300_505 })], { year: 2026, finalPct: 80 })).toEqual([]);
    expect(mapInvestmentGoods([good({ vatCents: 0 })], { year: 2026, finalPct: 80 })).toEqual([]);
  });

  it("con ficha de inmovilizado: su código y descripción identifican el bien y su puesta en servicio es el inicio de utilización", () => {
    const [entry] = mapInvestmentGoods([good({ asset: { code: "INM-0003", description: "Cortadora láser modelo X de alta precisión industrial", inServiceDate: "01-04-2026", disposalYear: null } })], { year: 2026, finalPct: 80 });
    expect(entry.good.goodId).toBe("INM-0003 Cortadora láser modelo X de alt");
    expect(entry.good.goodId.length).toBeLessThanOrEqual(40);
    expect(entry.good.startOfUseDate).toBe("01-04-2026");
  });

  it("dos bienes iguales en la misma factura se numeran", () => {
    const entries = mapInvestmentGoods([good(), good({ lineId: "line-2" })], { year: 2026, finalPct: 80 });
    expect(entries.map((entry) => entry.good.goodId)).toEqual(["Máquina cortadora", "Máquina cortadora (2)"]);
  });

  it("bien transmitido: bloqueado el año de la baja (art. 110 LIVA no calculado) y sin apuntes después; proveedor sin NIF bloqueado", () => {
    const sold = good({ asset: { code: "INM-1", description: "Máquina", inServiceDate: "01-04-2026", disposalYear: 2027 } });
    expect(mapInvestmentGoods([sold], { year: 2027, finalPct: 80 })[0].problems[0]).toMatch(/art\. 110/);
    expect(mapInvestmentGoods([sold], { year: 2028, finalPct: 80 })).toEqual([]);
    expect(mapInvestmentGoods([good({ issuer: null })], { year: 2026, finalPct: 80 })[0].problems[0]).toMatch(/NIF/);
  });

  it("plazo: 30 de enero del año siguiente, trasladado si es inhábil", () => {
    expect(investmentGoodsDueDate(2026)).toBe("2027-02-01"); // 30-01-2027 es sábado
    expect(investmentGoodsDueDate(2027)).toBe("2028-01-31"); // 30-01-2028 es domingo
    expect(investmentGoodsDueDate(2028)).toBe("2029-01-30");
  });
});
