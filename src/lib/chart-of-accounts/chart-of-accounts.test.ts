import { describe, expect, it } from "vitest";

import { balanceSideLetter, contradictsNature, groupAccentVar, splitCode } from "@/lib/chart-of-accounts/format";
import { chartApiParams, NO_CHART_FILTERS, parseChartFilters, parseChartUrlState, parseDateKey, serializeChartUrlState } from "@/lib/chart-of-accounts/query";
import { barShares, buildSchemeGroups, MIN_VISIBLE_SHARE, schemeResult } from "@/lib/chart-of-accounts/scheme";
import {
  ancestorsInStore,
  expandedFromLoaded,
  flattenVisible,
  highlightParts,
  mergeTreeResponse,
  nextMatchCode,
  scrollToReveal,
  treeKeyAction,
  treeStoreFromResponse,
  updateStoreNode,
  visibleWindow,
  type VisibleRow,
} from "@/lib/chart-of-accounts/tree";
import type { ChartNode } from "@/lib/chart-of-accounts/types";

function node(code: string, partial: Partial<ChartNode> = {}): ChartNode {
  return {
    id: `id-${code}`,
    code,
    name: `Cuenta ${code}`,
    type: "ASSET",
    nature: "DEBIT",
    parentCode: code.length > 1 ? code.slice(0, code.length === 8 ? 4 : -1) : null,
    level: code.length,
    isPostable: code.length === 8,
    isBlocked: false,
    partnerId: null,
    partnerName: null,
    partnerTaxId: null,
    openingCents: 0,
    debitCents: 0,
    creditCents: 0,
    balanceCents: 0,
    entries: 0,
    childCount: 0,
    hasMovements: false,
    ...partial,
  };
}

/** Niveles 1–2 cargados (como la primera petición): 4 → 43, 47; 5 → 57. */
function levelTwoStore() {
  return treeStoreFromResponse({
    nodes: [node("4", { childCount: 2 }), node("43", { childCount: 1 }), node("47", { childCount: 0 }), node("5", { childCount: 1 }), node("57", { childCount: 3 })],
    loadedParents: ["", "4", "5"],
  });
}

function nodeRows(rows: VisibleRow[]) {
  return rows.map((row) => (row.kind === "node" ? `${"  ".repeat(row.depth - 1)}${row.key}${row.expandable ? (row.expanded ? " -" : " +") : ""}` : `${"  ".repeat(row.depth - 1)}[${row.kind}]`));
}

describe("almacén y filas visibles del árbol", () => {
  it("aplana solo las ramas desplegadas, con nivel, posición y tamaño del grupo (ARIA)", () => {
    const store = levelTwoStore();
    const expanded = expandedFromLoaded(store);
    expect([...expanded].sort()).toEqual(["4", "5"]);
    const rows = flattenVisible(store, expanded);
    expect(nodeRows(rows)).toEqual(["4 -", "  43 +", "  47", "5 -", "  57 +"]);
    const first = rows[1];
    expect(first.kind === "node" && [first.depth, first.posinset, first.setsize]).toEqual([2, 1, 2]);
  });

  it("muestra esqueletos al desplegar sin datos, el error con reintento y los hijos al llegar", () => {
    let store = levelTwoStore();
    const expanded = new Set(["4", "5", "57"]);
    const loading = flattenVisible(store, expanded);
    expect(nodeRows(loading)).toEqual(["4 -", "  43 +", "  47", "5 -", "  57 -", "    [loading]", "    [loading]", "    [loading]"]);
    const failed = flattenVisible(store, expanded, new Map([["57", { state: "error", message: "Sin conexión" }]]));
    expect(nodeRows(failed).at(-1)).toBe("    [error]");

    store = mergeTreeResponse(store, { nodes: [node("572", { childCount: 1 }), node("570")], loadedParents: ["57"] });
    expect(nodeRows(flattenVisible(store, expanded)).slice(-3)).toEqual(["  57 -", "    570", "    572 +"]);
    // Una rama sin hijos con los filtros vigentes se indica en su lugar.
    store = mergeTreeResponse(store, { nodes: [], loadedParents: ["43"] });
    expect(nodeRows(flattenVisible(store, new Set(["4", "43"])))).toContain("    [empty]");
  });

  it("fusiona resultados sueltos (búsqueda, revelar) sin perder hermanos y actualiza nodos", () => {
    let store = levelTwoStore();
    store = mergeTreeResponse(store, { nodes: [node("430", { childCount: 1 }), node("4300", { childCount: 1 }), node("43000001")], loadedParents: ["43", "430", "4300"] });
    expect(ancestorsInStore(store, "43000001")).toEqual(["4", "43", "430", "4300"]);
    expect(store.children.get("4")).toEqual(["43", "47"]);
    store = updateStoreNode(store, "43000001", { isBlocked: true });
    expect(store.nodes.get("43000001")?.isBlocked).toBe(true);
    expect(updateStoreNode(store, "999", { isBlocked: true })).toBe(store);
  });
});

describe("teclado del treegrid", () => {
  const store = levelTwoStore();
  const rows = flattenVisible(store, new Set(["4", "5"]));
  const press = (index: number, key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => treeKeyAction(rows, index, { key, ...modifiers });

  it("se mueve con flechas, Inicio, Fin y páginas", () => {
    expect(press(0, "ArrowDown")).toEqual({ type: "focus", index: 1 });
    expect(press(0, "ArrowUp")).toBeNull();
    expect(press(4, "ArrowDown")).toBeNull();
    expect(press(3, "Home")).toEqual({ type: "focus", index: 0 });
    expect(press(0, "End")).toEqual({ type: "focus", index: 4 });
    expect(press(0, "PageDown")).toEqual({ type: "focus", index: 4 });
    expect(press(4, "PageUp")).toEqual({ type: "focus", index: 0 });
  });

  it("→ despliega o entra en el primer hijo; ← pliega o sube al padre", () => {
    expect(press(1, "ArrowRight")).toEqual({ type: "expand", code: "43" });
    expect(press(0, "ArrowRight")).toEqual({ type: "focus", index: 1 });
    expect(press(2, "ArrowRight")).toBeNull();
    expect(press(0, "ArrowLeft")).toEqual({ type: "collapse", code: "4" });
    expect(press(2, "ArrowLeft")).toEqual({ type: "focus", index: 0 });
    expect(press(4, "ArrowLeft")).toEqual({ type: "focus", index: 3 });
  });

  it("* despliega los hermanos; Intro abre la ficha y Ctrl+Intro el mayor; /, n y el menú", () => {
    expect(press(1, "*")).toEqual({ type: "expandSiblings", codes: ["43"] });
    expect(press(1, "Enter")).toEqual({ type: "open", code: "43" });
    expect(press(1, "Enter", { ctrlKey: true })).toEqual({ type: "ledger", code: "43" });
    expect(press(1, "/")).toEqual({ type: "search" });
    expect(press(1, "n")).toEqual({ type: "newChild", code: "43" });
    expect(press(1, "n", { ctrlKey: true })).toBeNull();
    expect(press(1, "F10", { shiftKey: true })).toEqual({ type: "menu", code: "43" });
    expect(press(1, "ContextMenu")).toEqual({ type: "menu", code: "43" });
    expect(press(1, "x")).toBeNull();
  });

  it("salta las filas de carga al moverse", () => {
    const withSkeleton = flattenVisible(store, new Set(["4", "5", "57"]));
    const last = withSkeleton.length - 1;
    expect(withSkeleton[last].kind).toBe("loading");
    expect(treeKeyAction(withSkeleton, 4, { key: "ArrowDown" })).toBeNull();
    expect(treeKeyAction(withSkeleton, last, { key: "ArrowDown" })).toEqual({ type: "focus", index: 0 });
  });
});

describe("búsqueda y virtualización", () => {
  it("recorre las coincidencias dando la vuelta y resalta el texto", () => {
    expect(nextMatchCode(["1", "2", "3"], null)).toBe("1");
    expect(nextMatchCode(["1", "2", "3"], "3")).toBe("1");
    expect(nextMatchCode(["1", "2", "3"], "1", -1)).toBe("3");
    expect(nextMatchCode([], "1")).toBeNull();
    expect(highlightParts("Clientes, efectos comerciales", "EFECTOS")).toEqual([
      { text: "Clientes, ", match: false },
      { text: "efectos", match: true },
      { text: " comerciales", match: false },
    ]);
    expect(highlightParts("Caja", "")).toEqual([{ text: "Caja", match: false }]);
  });

  it("pinta solo la ventana visible y calcula el desplazamiento para revelar una fila", () => {
    expect(visibleWindow({ scrollTop: 0, viewportHeight: 280, rowHeight: 28, total: 10_000, overscan: 5 })).toEqual({ start: 0, end: 20 });
    expect(visibleWindow({ scrollTop: 28_000, viewportHeight: 280, rowHeight: 28, total: 10_000, overscan: 5 })).toEqual({ start: 995, end: 1015 });
    expect(visibleWindow({ scrollTop: 279_900, viewportHeight: 280, rowHeight: 28, total: 10_000 }).end).toBe(10_000);
    expect(scrollToReveal({ index: 5, scrollTop: 0, viewportHeight: 280, rowHeight: 28, headerHeight: 28 })).toBeNull();
    expect(scrollToReveal({ index: 50, scrollTop: 0, viewportHeight: 280, rowHeight: 28, headerHeight: 28 })).toBe(50 * 28 + 28 - 280 + 28);
    expect(scrollToReveal({ index: 2, scrollTop: 500, viewportHeight: 280, rowHeight: 28 })).toBe(56);
  });
});

describe("esquema por grupos del PGC", () => {
  it("escala las barras por el mayor saldo absoluto y deja visible un saldo pequeño", () => {
    expect(barShares([100, -50, 0, 1])).toEqual([1, 0.5, 0, MIN_VISIBLE_SHARE]);
    expect(barShares([0, 0])).toEqual([0, 0]);
    expect(barShares([])).toEqual([]);
  });

  it("siempre devuelve los 9 grupos con sus subgrupos y calcula el resultado 7 − 6", () => {
    const groups = buildSchemeGroups([
      node("6", { balanceCents: 30_000, hasMovements: true, name: "Compras y gastos" }),
      node("60", { balanceCents: 20_000 }),
      node("62", { balanceCents: 10_000 }),
      node("7", { balanceCents: -50_000, hasMovements: true, nature: "CREDIT" }),
      node("70", { balanceCents: -50_000 }),
    ]);
    expect(groups.map((group) => group.code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(groups[0]).toMatchObject({ name: "Financiación básica", id: null, subgroups: [] });
    expect(groups[5].subgroups.map((subgroup) => [subgroup.code, subgroup.share])).toEqual([["60", 1], ["62", 0.5]]);
    expect(schemeResult(groups)).toEqual({ revenueCents: 50_000, expenseCents: 30_000, resultCents: 20_000 });
  });
});

describe("estado en la URL y formato", () => {
  it("lee y escribe el estado sin los valores por defecto", () => {
    const state = parseChartUrlState(new URLSearchParams("view=scheme&level=sub&q=43.1&fy=fy1&from=2026-01-01&to=2026-03-31&sel=43000001&f=movements,blocked,raro&density=comfortable"));
    expect(state).toEqual({
      view: "scheme",
      level: "sub",
      q: "43.1",
      fy: "fy1",
      from: "2026-01-01",
      to: "2026-03-31",
      sel: "43000001",
      filters: { movements: true, nonzero: false, partners: false, blocked: true },
      density: "comfortable",
    });
    expect(serializeChartUrlState(state)).toBe("view=scheme&level=sub&q=43.1&fy=fy1&from=2026-01-01&to=2026-03-31&sel=43000001&f=movements%2Cblocked&density=comfortable");
    const defaults = parseChartUrlState({ level: "9", from: "2026-02-30", view: ["list", "tree"] });
    expect(defaults).toMatchObject({ view: "list", level: "2", from: null, filters: NO_CHART_FILTERS, density: "compact" });
    expect(serializeChartUrlState({ ...defaults, view: "tree" })).toBe("");
    expect(parseChartFilters(null)).toEqual(NO_CHART_FILTERS);
    expect(parseDateKey("2026-13-01")).toBeNull();
    expect(chartApiParams({ fy: null, from: "2026-01-01", to: null, filters: { ...NO_CHART_FILTERS, partners: true } }).toString()).toBe("from=2026-01-01&f=partners");
  });

  it("segmenta el código, marca el lado del saldo y avisa si contradice la naturaleza", () => {
    expect(splitCode("43000001", "4300")).toEqual({ inherited: "4300", own: "0001" });
    expect(splitCode("4", null)).toEqual({ inherited: "", own: "4" });
    expect(splitCode("57200000", "430")).toEqual({ inherited: "", own: "57200000" });
    expect([balanceSideLetter(5), balanceSideLetter(-5), balanceSideLetter(0)]).toEqual(["D", "A", null]);
    expect(contradictsNature(-100, "DEBIT")).toBe(true);
    expect(contradictsNature(100, "CREDIT")).toBe(true);
    expect(contradictsNature(-100, "MIXED")).toBe(false);
    expect(groupAccentVar("43000001")).toBe("var(--chart-4)");
    expect(groupAccentVar("7")).toBe("var(--chart-2)");
  });
});
