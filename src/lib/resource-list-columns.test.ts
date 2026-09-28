import { describe, expect, it } from "vitest";

import { restoreVisibleHeaders } from "./resource-list-columns";

const current = ["Número", "Cliente", "Fecha emisión", "Vencimiento", "Total", "Pendiente", "Estado", "Acciones"];

describe("restoreVisibleHeaders", () => {
  it("shows renamed and new columns stored by an older version of the list", () => {
    // Old invoice list: "Factura", "Estado", "Importe", "Emisión", "Acciones" (all visible).
    const visible = restoreVisibleHeaders(current, ["Número"], ["Factura", "Estado", "Importe", "Emisión", "Acciones"]);
    expect([...visible].sort()).toEqual([...current].sort());
  });

  it("keeps a legacy selection when the columns did not change", () => {
    const visible = restoreVisibleHeaders(current, ["Número"], ["Número", "Cliente", "Total"]);
    expect([...visible].sort()).toEqual(["Cliente", "Número", "Total"]);
  });

  it("keeps hidden columns hidden and shows columns added after saving", () => {
    const known = current.filter((header) => header !== "Pendiente");
    const stored = known.filter((header) => header !== "Vencimiento");
    const visible = restoreVisibleHeaders(current, ["Número"], stored, known);
    expect(visible.has("Vencimiento")).toBe(false);
    expect(visible.has("Pendiente")).toBe(true);
    expect(visible.has("Cliente")).toBe(true);
  });
});
