import { describe, expect, it } from "vitest";

import { buildCsv, escapeCsvValue } from "@/components/ui/resource-list";

describe("resource list CSV export", () => {
  it("uses the Spanish Excel dialect with a UTF-8 BOM", () => {
    const csv = buildCsv([
      ["Número", "Importe"],
      ["F-2026/0001", 1234.5],
    ]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["Número;Importe", "F-2026/0001;1234,5"]);
  });

  it("quotes separators and neutralises formula injection", () => {
    expect(escapeCsvValue("Pérez; Hijos")).toBe('"Pérez; Hijos"');
    expect(escapeCsvValue('Dice "hola"')).toBe('"Dice ""hola"""');
    expect(escapeCsvValue("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("keeps negative amounts and empty values intact", () => {
    expect(escapeCsvValue(-12.5)).toBe("-12,5");
    expect(escapeCsvValue("-12,50 €")).toBe('"-12,50 €"');
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(Number.NaN)).toBe("");
  });
});
