import { describe, expect, it } from "vitest";

import {
  enterAtRowEnd,
  focusTargetsAfter,
  isAddLineShortcut,
  isPlainEnter,
  lineFieldId,
  linesGridTemplate,
  linesSectionId,
  moveItem,
  retentionRateLabel,
  retentionRateOptions,
  taxPickerLabel,
  vatRateLabel,
  vatRateOptions,
} from "@/components/invoices/lines-editor-model";

const key = (overrides: Partial<{ key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: "Enter",
  code: "Enter",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

describe("lines editor model", () => {
  it("ofrece los tipos de IVA habituales más el actual y el predeterminado, de mayor a menor", () => {
    expect(vatRateOptions(undefined, 21)).toEqual([21, 10, 4, 0]);
    expect(vatRateOptions("5", 21)).toEqual([21, 10, 5, 4, 0]);
    expect(vatRateOptions(7.5, 3)).toEqual([21, 10, 7.5, 4, 3, 0]);
    expect(vatRateOptions("no es un número", 21)).toEqual([21, 10, 4, 0]);
  });

  it("etiqueta el IVA y la retención", () => {
    expect(vatRateLabel(0)).toBe("Exento 0 %");
    expect(vatRateLabel(21)).toMatch(/^IVA 21/);
    expect(retentionRateLabel(0)).toBe("Sin retención");
    expect(retentionRateOptions(19, 2)).toEqual([0, 2, 7, 15, 19]);
  });

  it("nombra el selector de impuestos con los elegidos", () => {
    expect(taxPickerLabel(2, [])).toBe("Impuestos línea 2: sin impuestos");
    expect(taxPickerLabel(1, ["IVA 21 %", "IRPF −15 %"])).toBe("Impuestos línea 1: IVA 21 %, IRPF −15 %");
  });

  it("mueve elementos sin mutar la lista y deja igual los movimientos fuera de rango", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(items, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(items, 0, 3)).toEqual(items);
    expect(moveItem(items, -1, 0)).toEqual(items);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("construye ids deterministas por posición", () => {
    expect(lineFieldId("invoice-line", 0, "description")).toBe("invoice-line-1-description");
    expect(linesSectionId("quote-line")).toBe("quote-lines-section");
  });

  it("decide el foco tras cada acción", () => {
    expect(focusTargetsAfter({ type: "add", newIndex: 2 }, "po-line", "item")).toEqual(["po-line-3-item"]);
    expect(focusTargetsAfter({ type: "duplicate", index: 0 }, "invoice-line")).toEqual(["invoice-line-2-description"]);
    expect(focusTargetsAfter({ type: "move", from: 1, to: 0 }, "invoice-line")).toEqual(["invoice-line-1-move-up", "invoice-line-1-description"]);
    expect(focusTargetsAfter({ type: "move", from: 0, to: 1 }, "invoice-line")).toEqual(["invoice-line-2-move-down", "invoice-line-2-description"]);
    expect(focusTargetsAfter({ type: "remove", index: 0, remaining: 2 }, "invoice-line")).toEqual(["invoice-line-1-description"]);
    expect(focusTargetsAfter({ type: "remove", index: 3, remaining: 3 }, "invoice-line")).toEqual(["invoice-line-3-description"]);
    expect(focusTargetsAfter({ type: "remove", index: 0, remaining: 0 }, "credit-note-line")).toEqual(["credit-note-lines-section"]);
  });

  it("Enter al final de la fila crea línea, salta a la siguiente o deja enviar el formulario", () => {
    expect(enterAtRowEnd({ canAdd: true, index: 1, lineCount: 2 })).toBe("add");
    expect(enterAtRowEnd({ canAdd: true, index: 0, lineCount: 2 })).toBe("next");
    expect(enterAtRowEnd({ canAdd: false, index: 0, lineCount: 2 })).toBe("next");
    expect(enterAtRowEnd({ canAdd: false, index: 1, lineCount: 2 })).toBe("none");
  });

  it("reconoce Enter sin modificadores y Alt+L", () => {
    expect(isPlainEnter(key())).toBe(true);
    expect(isPlainEnter(key({ ctrlKey: true }))).toBe(false);
    expect(isPlainEnter(key({ shiftKey: true }))).toBe(false);
    expect(isAddLineShortcut(key({ key: "l", code: "KeyL", altKey: true }))).toBe(true);
    expect(isAddLineShortcut(key({ key: "¬", code: "KeyL", altKey: true }))).toBe(true);
    expect(isAddLineShortcut(key({ key: "l", code: "KeyL" }))).toBe(false);
    expect(isAddLineShortcut(key({ key: "l", code: "KeyL", altKey: true, ctrlKey: true }))).toBe(false);
  });

  it("une las pistas de la rejilla de escritorio", () => {
    expect(linesGridTemplate([{ track: "minmax(13rem,1fr)" }, { track: "6rem" }])).toBe("minmax(13rem,1fr) 6rem");
  });
});
