import { describe, expect, it } from "vitest";

import { NO_CHART_FILTERS } from "@/lib/chart-of-accounts/query";
import type { ChartNode } from "@/lib/chart-of-accounts/types";
import { buildChartCsv, chartExportRows } from "@/server/accounting/chart-export";
import {
  ancestorPrefixes,
  buildChartNode,
  buildMonthlySeries,
  distinctCodeLengths,
  nodePassesFilters,
  normalizeTaxIdQuery,
  relinkToPresentAncestors,
  type ChartAccountRow,
} from "@/server/accounting/chart-tree-model";
import { expandDotShortcut } from "@/server/accounting/subaccounts-model";

function row(code: string, partial: Partial<ChartAccountRow> = {}): ChartAccountRow {
  return {
    id: `id-${code}`,
    code,
    name: `Cuenta ${code}`,
    type: "ASSET",
    nature: null,
    parentCode: code.length > 1 ? code.slice(0, -1) : null,
    isPostable: code.length === 8,
    isBlocked: false,
    partnerId: null,
    partnerName: null,
    partnerTaxId: null,
    ...partial,
  };
}

function node(code: string, partial: Partial<ChartNode> = {}): ChartNode {
  return { ...buildChartNode(row(code), new Map(), new Map()), ...partial };
}

const context = { blockedCodes: ["57200001"], partnerPrefixes: ["430", "400", "410"] };

describe("atajo del punto", () => {
  it.each([
    ["43.1", 8, "43000001"],
    ["430.12", 8, "43000012"],
    ["572.", 8, "57200000"],
    ["4.12", 10, "4000000012"],
    [" 43.1 ", 8, "43000001"],
  ])("%s con %i dígitos → %s", (value, length, expected) => {
    expect(expandDotShortcut(value, length)).toBe(expected);
  });

  it.each(["43", "43.1.2", "a.1", "43.123456789", ""])("no expande %s", (value) => {
    expect(expandDotShortcut(value, 8)).toBeNull();
  });
});

describe("nodos del árbol", () => {
  it("toma las sumas del prefijo, calcula el saldo con el saldo inicial y deduce la naturaleza del tipo", () => {
    const totals = new Map([["43", { openingCents: 1000, debitCents: 500, creditCents: 200, entries: 3 }]]);
    const built = buildChartNode(row("43", { type: "ASSET" }), totals, new Map([["43", 4]]));
    expect(built).toMatchObject({ balanceCents: 1300, entries: 3, childCount: 4, hasMovements: true, nature: "DEBIT", level: 2 });
    expect(buildChartNode(row("70", { type: "REVENUE" }), new Map(), new Map())).toMatchObject({ balanceCents: 0, hasMovements: false, nature: "CREDIT" });
    expect(buildChartNode(row("55", { nature: "MIXED" }), new Map(), new Map()).nature).toBe("MIXED");
    // Solo saldo inicial: tiene movimientos a efectos del filtro.
    const openingOnly = buildChartNode(row("57"), new Map([["57", { openingCents: 10, debitCents: 0, creditCents: 0, entries: 0 }]]), new Map());
    expect(openingOnly.hasMovements).toBe(true);
  });

  it("filtra por movimientos, saldo, terceros y bloqueadas conservando los grupos de la rama", () => {
    const quiet = node("10");
    const busy = node("43", { entries: 2, hasMovements: true, balanceCents: 100 });
    expect(nodePassesFilters(quiet, { ...NO_CHART_FILTERS, movements: true }, context)).toBe(false);
    expect(nodePassesFilters(busy, { ...NO_CHART_FILTERS, movements: true }, context)).toBe(true);
    expect(nodePassesFilters(node("43000001", { balanceCents: 0 }), { ...NO_CHART_FILTERS, nonzero: true }, context)).toBe(false);

    const partners = { ...NO_CHART_FILTERS, partners: true };
    expect(["4", "43", "430", "4300", "43000001", "41", "410"].every((code) => nodePassesFilters(node(code), partners, context))).toBe(true);
    expect(["47", "477", "5", "44"].some((code) => nodePassesFilters(node(code), partners, context))).toBe(false);

    const blocked = { ...NO_CHART_FILTERS, blocked: true };
    expect(nodePassesFilters(node("5"), blocked, context)).toBe(true);
    expect(nodePassesFilters(node("572"), blocked, context)).toBe(true);
    expect(nodePassesFilters(node("57200000"), blocked, context)).toBe(false);
    expect(nodePassesFilters(node("57200001", { isBlocked: true }), blocked, context)).toBe(true);
    expect(nodePassesFilters(node("6"), blocked, context)).toBe(false);
  });

  it("calcula ancestros, longitudes y enlaza cada nodo con el antecesor presente más cercano", () => {
    expect(ancestorPrefixes(["43000001", "4300"]).sort()).toEqual(["4", "43", "430", "4300", "43000", "430000", "4300000"]);
    expect(distinctCodeLengths(["4", "43", "44", "43000001"])).toEqual([1, 2, 8]);
    const relinked = relinkToPresentAncestors([node("4"), node("43"), node("430"), node("43000001", { parentCode: "4300" })]);
    expect(relinked.map((entry) => entry.parentCode)).toEqual([null, "4", "43", "430"]);
  });

  it("normaliza el NIF buscado", () => {
    expect(normalizeTaxIdQuery(" b-12.345 674 ")).toBe("B12345674");
  });
});

describe("serie mensual de la ficha", () => {
  it("acumula el saldo mes a mes desde el saldo inicial y deja a cero los meses sin apuntes", () => {
    const byMonth = new Map([
      ["2026-01", { debitCents: 1000, creditCents: 0 }],
      ["2026-03", { debitCents: 0, creditCents: 300 }],
    ]);
    const series = buildMonthlySeries("Ejercicio 2026", ["2026-01", "2026-02", "2026-03"], byMonth, 500);
    expect(series).toEqual({ label: "Ejercicio 2026", debitCents: [1000, 0, 0], creditCents: [0, 0, 300], balanceCents: [1500, 1500, 1200] });
  });
});

describe("exportación del plan", () => {
  it("genera filas con saldo sin signo y su lado, y un CSV para Excel en español", () => {
    const nodes = [node("4", { name: "Acreedores", debitCents: 12345, balanceCents: 12345 }), node("41000001", { name: "=Proveedor", partnerId: "p", partnerName: "Luna", partnerTaxId: "B1", creditCents: 500, balanceCents: -500, isPostable: true, isBlocked: true })];
    expect(chartExportRows(nodes)).toEqual([
      ["4", "Acreedores", "1", "", "", 0, 123.45, 0, 123.45, "Deudor", ""],
      ["41000001", "=Proveedor", "Subcuenta", "Luna", "B1", 0, 0, 5, 5, "Acreedor", "Sí"],
    ]);
    const csv = buildChartCsv(nodes);
    expect(csv.startsWith("﻿Código;Cuenta;Nivel")).toBe(true);
    expect(csv).toContain("4;Acreedores;1;;;0,00;123,45;0,00;123,45;Deudor;");
    // Los textos que empiezan por «=» no se interpretan como fórmulas.
    expect(csv).toContain("41000001;'=Proveedor;Subcuenta");
  });
});
