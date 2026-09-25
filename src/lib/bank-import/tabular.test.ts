import { describe, expect, it } from "vitest";

import {
  applyMapping,
  decodeText,
  detectDateFormat,
  detectDecimalSeparator,
  detectDelimiter,
  detectHeaderRow,
  guessMapping,
  parseAmountWith,
  parseDateWith,
  parseDelimited,
  validateMapping,
} from "@/lib/bank-import/tabular";

// Exportación típica de banca online española: líneas de título antes de la cabecera,
// fecha operación/valor, concepto, importe con signo y saldo en formato 1.234,56.
const santanderLike = [
  "Movimientos de la cuenta ES91 2100 0418 4502 0005 1332",
  "Titular: EMPRESA DEMO SL",
  "",
  "Fecha operación;Fecha valor;Concepto;Importe;Saldo",
  "02/09/2026;02/09/2026;COMISION MANTENIMIENTO;-12,50;14.987,50",
  "03/09/2026;03/09/2026;\"TRANSF. CLIENTE EJEMPLO; FRA F-2026-0042\";1.210,00;16.197,50",
  "05/09/2026;05/09/2026;RECIBO TGSS AUTONOMOS;-294,00;15.903,50",
  "05/09/2026;05/09/2026;RECIBO TGSS AUTONOMOS;-294,00;15.609,50",
  "Total;;;;",
].join("\r\n");

describe("tabular bank statements", () => {
  it("detects delimiter, header row, columns and Spanish formats", () => {
    expect(detectDelimiter(santanderLike)).toBe(";");
    const table = parseDelimited(santanderLike);
    expect(detectHeaderRow(table)).toBe(3);
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({
      headerRow: 3,
      dateColumn: 0,
      valueDateColumn: 1,
      descriptionColumns: [2],
      amountColumn: 3,
      balanceColumn: 4,
      dateFormat: "DMY",
      decimalSeparator: ",",
    });
    expect(validateMapping(mapping)).toEqual([]);
  });

  it("applies the mapping, keeps identical same-day charges and explains skipped rows", () => {
    const table = parseDelimited(santanderLike);
    const { movements, skipped } = applyMapping(table, guessMapping(table));
    expect(movements.map((movement) => [movement.line, movement.postedAt.toISOString().slice(0, 10), movement.amount, movement.balanceAfter])).toEqual([
      [5, "2026-09-02", -12.5, 14987.5],
      [6, "2026-09-03", 1210, 16197.5],
      [7, "2026-09-05", -294, 15903.5],
      [8, "2026-09-05", -294, 15609.5],
    ]);
    expect(movements[1].description).toBe("TRANSF. CLIENTE EJEMPLO; FRA F-2026-0042");
    expect(skipped).toEqual([{ line: 9, reason: "Fecha no reconocida: «Total»." }]);
  });

  it("supports separate debit/credit columns, dot decimals and US dates", () => {
    const csv = "Date,Description,Debit,Credit,Balance\n09/13/2026,Card payment,\"1,080.25\",,500.00\n09/14/2026,Refund,,20.5,520.50";
    const table = parseDelimited(csv);
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ dateColumn: 0, descriptionColumns: [1], debitColumn: 2, creditColumn: 3, amountColumn: null, dateFormat: "MDY", decimalSeparator: "." });
    const { movements } = applyMapping(table, mapping);
    expect(movements.map((movement) => movement.amount)).toEqual([-1080.25, 20.5]);
    expect(movements[0].postedAt).toEqual(new Date(Date.UTC(2026, 8, 13)));
  });

  it("guesses columns from the content when there is no header", () => {
    const table = parseDelimited("2026-09-01;Recibo luz;-80,25\n2026-09-02;Cobro F-1;100,00");
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ headerRow: -1, dateColumn: 0, amountColumn: 2, descriptionColumns: [1], dateFormat: "YMD" });
    expect(applyMapping(table, mapping).movements).toHaveLength(2);
  });

  it("inverts the sign when the bank exports charges as positive amounts", () => {
    const table = parseDelimited("fecha;concepto;importe\n01/09/2026;Cargo;12,00");
    const { movements } = applyMapping(table, { ...guessMapping(table), invertSign: true });
    expect(movements[0].amount).toBe(-12);
  });

  it("parses amounts and dates with the chosen formats", () => {
    expect(parseAmountWith("1.234,56 €", ",")).toBe(1234.56);
    expect(parseAmountWith("(12,50)", ",")).toBe(-12.5);
    expect(parseAmountWith("12,50-", ",")).toBe(-12.5);
    expect(parseAmountWith("1,234.56", ".")).toBe(1234.56);
    expect(parseAmountWith("abc", ",")).toBeNull();
    expect(parseDateWith("05/09/26", "DMY")).toEqual(new Date(Date.UTC(2026, 8, 5)));
    expect(parseDateWith("2026-09-05T00:00:00", "DMY")).toEqual(new Date(Date.UTC(2026, 8, 5)));
    expect(parseDateWith("31/02/2026", "DMY")).toBeNull();
    expect(detectDateFormat(["01/02/2026", "13/02/2026"])).toBe("DMY");
    expect(detectDateFormat(["02/13/2026"])).toBe("MDY");
    expect(detectDecimalSeparator(["1.234,56", "12,5"])).toBe(",");
    expect(detectDecimalSeparator(["1,234.56", "12.50"])).toBe(".");
  });

  it("reports mapping errors in plain Spanish", () => {
    const errors = validateMapping({ headerRow: 0, dateColumn: -1, descriptionColumns: [], dateFormat: "DMY", decimalSeparator: "," });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/fecha/);
  });

  it("decodes Windows-1252 files from Spanish banks", () => {
    const bytes = new Uint8Array([0x43, 0x6f, 0x6d, 0x69, 0x73, 0x69, 0xf3, 0x6e]); // "Comisión" en latin1
    expect(decodeText(bytes)).toBe("Comisión");
    expect(decodeText(new TextEncoder().encode("﻿Comisión"))).toBe("Comisión");
  });
});
