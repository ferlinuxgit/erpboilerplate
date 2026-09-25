import { describe, expect, it } from "vitest";

import { buildNavigationCommands, quickActions, rankCommands } from "@/components/layout/command-search";

const catalog = [...quickActions, ...buildNavigationCommands()];
const top = (query: string, count = 3) => rankCommands(catalog, query).slice(0, count).map((command) => command.href);

describe("command palette search", () => {
  it.each([
    ["iva", "/fiscal"],
    ["impuestos", "/fiscal"],
    ["hacienda", "/fiscal"],
    ["gestor", "/settings/team"],
    ["asesor", "/settings/team"],
    ["invitar", "/settings/team"],
    ["usuarios", "/settings/team"],
    ["contraseña", "/settings/security"],
    ["conciliar", "/treasury/reconciliation"],
    ["banco", "/treasury"],
    ["gasto", "/expenses/new"],
    ["ticket", "/expenses/new"],
  ])("finds «%s» → %s among the first results", (query, href) => {
    expect(top(query, 4)).toContain(href);
  });

  it("includes context sub-pages such as reconciliation, tax calendar, chart of accounts, entries, forecast and VERI*FACTU", () => {
    const hrefs = buildNavigationCommands().map((command) => command.href);
    expect(hrefs).toEqual(expect.arrayContaining([
      "/treasury/reconciliation",
      "/fiscal/calendar",
      "/accounting/accounts",
      "/accounting/entries",
      "/treasury/forecast",
      "/fiscal/verifactu",
    ]));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(top("calendario fiscal", 1)).toEqual(["/fiscal/calendar"]);
    expect(top("verifactu", 2)).toContain("/fiscal/verifactu");
    expect(top("plan contable", 2)).toContain("/accounting/accounts");
  });

  it("ignores accents and case and prefers modules over actions on equal score", () => {
    expect(top("INVENTARIO", 1)).toEqual(["/inventory"]);
    expect(top("tesoreria", 1)).toEqual(["/treasury"]);
  });

  it("returns nothing for an empty query or unrelated text", () => {
    expect(rankCommands(catalog, "   ")).toEqual([]);
    expect(rankCommands(catalog, "zzzqqq")).toEqual([]);
  });

  it("describes navigation results in words, not with “Código NN”", () => {
    for (const command of buildNavigationCommands()) {
      expect(command.description ?? "").not.toMatch(/C[oó]digo/);
    }
  });
});
