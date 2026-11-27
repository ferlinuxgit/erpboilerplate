import { describe, expect, it } from "vitest";

import {
  bookEntryKind,
  buildClosingInventory,
  buildLedger,
  buildOpeningInventory,
  buildQuarterlyTrialBalances,
  fileFingerprint,
  journalTotals,
  ledgerFingerprint,
  orderJournal,
  outOfOrderNumbers,
  quarterCutoffs,
  type BookEntry,
  type BookLine,
} from "@/server/accounting/books/books-model";
import { A3_RECORD_LENGTH, a3Amount, buildSuenlace, buildXDiario, buildXSubCta, toAscii, XDIARIO_RECORD_LENGTH, XSUBCTA_RECORD_LENGTH } from "@/server/accounting/books/exports-model";

const names: Record<string, string> = { "10000000": "Capital social", "57200001": "Banco", "70000000": "Ventas de mercaderías", "43000001": "Cliente Pérez, S.L.", "12900000": "Resultado del ejercicio", "62900000": "Otros servicios" };
const line = (code: string, debit: number, credit: number, concept: string | null = null): BookLine => ({ accountId: `id-${code}`, accountCode: code, accountName: names[code] ?? code, concept, debitCents: debit, creditCents: credit });
const entry = (number: string, day: string, kind: BookEntry["kind"], lines: BookLine[], hour = 10): BookEntry => ({ id: number, number, day, postedAt: new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`), reference: `Ref ${number}`, kind, lines });

const year = { startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) };

/** Ejercicio 2026 completo: apertura, dos ventas (numeradas al revés de sus fechas), un gasto, regularización y cierre. */
const entries: BookEntry[] = [
  entry("AS-2026/000005", "2026-12-31", "closing", [line("10000000", 300_000, 0), line("12900000", 120_000, 0), line("57200001", 0, 420_000)], 22),
  entry("AS-2026/000004", "2026-12-31", "regularization", [line("70000000", 150_000, 0), line("62900000", 0, 30_000), line("12900000", 0, 120_000)], 22),
  entry("AS-2026/000003", "2026-02-10", "normal", [line("43000001", 100_000, 0, "Fra. FA-1 · Pérez"), line("70000000", 0, 100_000, "Fra. FA-1 · Pérez")]),
  entry("AS-2026/000002", "2026-05-20", "normal", [line("57200001", 50_000, 0), line("70000000", 0, 50_000)]),
  entry("AS-2026/000001", "2026-01-01", "opening", [line("57200001", 300_000, 0), line("10000000", 0, 300_000)], 0),
  entry("AS-2026/000006", "2026-02-10", "normal", [line("57200001", 100_000, 0), line("43000001", 0, 100_000)], 12),
  entry("AS-2026/000007", "2026-11-03", "normal", [line("62900000", 30_000, 0), line("57200001", 0, 30_000)]),
];

describe("libro diario", () => {
  const journal = orderJournal(entries);

  it("ordena por fecha con apertura al principio y regularización y cierre al final, y numera correlativamente", () => {
    expect(journal.map((item) => [item.order, item.number])).toEqual([
      [1, "AS-2026/000001"],
      [2, "AS-2026/000003"],
      [3, "AS-2026/000006"],
      [4, "AS-2026/000002"],
      [5, "AS-2026/000007"],
      [6, "AS-2026/000004"],
      [7, "AS-2026/000005"],
    ]);
  });

  it("cuadra debe y haber", () => {
    expect(journalTotals(journal)).toEqual({ entries: 7, lines: 16, debitCents: 1_150_000, creditCents: 1_150_000 });
  });

  it("detecta números internos que no siguen el orden de las fechas", () => {
    expect(outOfOrderNumbers(journal)).toBe(1);
    expect(outOfOrderNumbers(orderJournal(entries.filter((item) => item.number !== "AS-2026/000002")))).toBe(0);
  });

  it("identifica los asientos del ciclo por su origen", () => {
    expect(bookEntryKind("fiscalYearOpening")).toBe("opening");
    expect(bookEntryKind("fiscalYearRegularization")).toBe("regularization");
    expect(bookEntryKind("fiscalYearClosing")).toBe("closing");
    expect(bookEntryKind("invoice")).toBe("normal");
    expect(bookEntryKind(null)).toBe("normal");
  });
});

describe("libro mayor", () => {
  it("lleva el saldo acumulado de cada cuenta en el orden del diario", () => {
    const ledger = buildLedger(orderJournal(entries), []);
    const bank = ledger.find((account) => account.code === "57200001");
    expect(bank?.lines.map((item) => [item.order, item.balanceCents])).toEqual([[1, 300_000], [3, 400_000], [4, 450_000], [5, 420_000], [7, 0]]);
    expect(bank).toMatchObject({ debitCents: 450_000, creditCents: 450_000, closingCents: 0 });
    expect(ledger.map((account) => account.code)).toEqual([...ledger.map((account) => account.code)].sort());
  });

  it("parte del saldo anterior cuando no hay asiento de apertura", () => {
    const ledger = buildLedger(orderJournal([entries[3]]), [{ accountId: "id-57200001", code: "57200001", name: "Banco", balanceCents: 300_000 }]);
    expect(ledger.find((account) => account.code === "57200001")).toMatchObject({ openingCents: 300_000, closingCents: 350_000 });
  });
});

describe("balances de comprobación trimestrales", () => {
  it("corta cada tres meses desde el inicio del ejercicio", () => {
    expect(quarterCutoffs(year).map((cutoff) => cutoff.to)).toEqual(["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"]);
    expect(quarterCutoffs({ startsAt: new Date(Date.UTC(2025, 6, 1)), endsAt: new Date(Date.UTC(2026, 5, 30)) }).map((cutoff) => cutoff.to)).toEqual(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]);
    // Ejercicio corto (constitución en octubre): un solo corte al cierre.
    expect(quarterCutoffs({ startsAt: new Date(Date.UTC(2026, 9, 15)), endsAt: new Date(Date.UTC(2026, 11, 31)) }).map((cutoff) => cutoff.to)).toEqual(["2026-12-31"]);
  });

  it("acumula sumas y saldos hasta cada corte, sin regularización ni cierre", () => {
    const [q1, q2, , q4] = buildQuarterlyTrialBalances(orderJournal(entries), [], year);
    expect(q1.rows.find((row) => row.code === "57200001")).toMatchObject({ debitCents: 400_000, creditCents: 0, debtorCents: 400_000, creditorCents: 0 });
    expect(q1.rows.find((row) => row.code === "43000001")).toMatchObject({ debitCents: 100_000, creditCents: 100_000, debtorCents: 0, creditorCents: 0 });
    expect(q1.totals).toEqual({ debitCents: 500_000, creditCents: 500_000, debtorCents: 400_000, creditorCents: 400_000 });
    expect(q2.rows.find((row) => row.code === "70000000")).toMatchObject({ creditorCents: 150_000 });
    // En el cuarto trimestre las ventas siguen con su saldo: el balance es anterior a la regularización.
    expect(q4.rows.find((row) => row.code === "70000000")).toMatchObject({ creditorCents: 150_000 });
    expect(q4.rows.find((row) => row.code === "12900000")).toBeUndefined();
    expect(q4.totals.debitCents).toBe(q4.totals.creditCents);
    expect(q4.totals.debtorCents).toBe(q4.totals.creditorCents);
  });
});

describe("inventarios", () => {
  const journal = orderJournal(entries);

  it("el inventario de cierre recoge los saldos antes del asiento de cierre", () => {
    const inventory = buildClosingInventory(journal, []);
    expect(inventory.assets).toEqual([{ code: "57200001", name: "Banco", amountCents: 420_000 }]);
    expect(inventory.equityAndLiabilities).toEqual([
      { code: "10000000", name: "Capital social", amountCents: 300_000 },
      { code: "12900000", name: "Resultado del ejercicio", amountCents: 120_000 },
    ]);
    expect(inventory.pendingResultCents).toBe(0);
    expect(inventory.totalAssetsCents).toBe(inventory.totalEquityAndLiabilitiesCents);
  });

  it("sin regularizar, el resultado figura aparte y el inventario sigue cuadrando", () => {
    const inventory = buildClosingInventory(journal.filter((item) => item.kind === "normal" || item.kind === "opening"), []);
    expect(inventory.pendingResultCents).toBe(120_000);
    expect(inventory.totalAssetsCents).toBe(420_000);
    expect(inventory.totalEquityAndLiabilitiesCents).toBe(420_000);
  });

  it("el balance inicial es el asiento de apertura", () => {
    const opening = buildOpeningInventory(journal, []);
    expect(opening.assets).toEqual([{ code: "57200001", name: "Banco", amountCents: 300_000 }]);
    expect(opening.totalEquityAndLiabilitiesCents).toBe(300_000);
  });
});

describe("huellas", () => {
  it("la huella del ejercicio cambia si cambia un apunte y no depende del orden de carga", () => {
    const base = ledgerFingerprint(orderJournal(entries));
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerFingerprint(orderJournal([...entries].reverse()))).toBe(base);
    const changed = entries.map((item) => item.number === "AS-2026/000007" ? { ...item, lines: [line("62900000", 30_001, 0), line("57200001", 0, 30_001)] } : item);
    expect(ledgerFingerprint(orderJournal(changed))).not.toBe(base);
  });

  it("SHA-256 de un fichero en hexadecimal y en base64", () => {
    // Vector de prueba conocido: SHA-256("abc").
    expect(fileFingerprint(new TextEncoder().encode("abc"))).toEqual({
      sha256Hex: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha256Base64: "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    });
  });
});

describe("exportación a A3 (SUENLACE.DAT, formato 4)", () => {
  const journal = orderJournal(entries);

  it("escribe registros de 256 bytes con CR LF y los campos en su posición", () => {
    const file = buildSuenlace(journal, { companyCode: 7 });
    const records = file.split("\r\n").filter(Boolean);
    expect(records).toHaveLength(16);
    for (const record of records) expect(record.length + 2).toBe(A3_RECORD_LENGTH);
    // Segundo asiento del diario: la venta a Pérez.
    const sale = records[2];
    expect(sale.slice(0, 1)).toBe("4");
    expect(sale.slice(1, 6)).toBe("00007");
    expect(sale.slice(6, 14)).toBe("20260210");
    expect(sale.slice(14, 15)).toBe("0");
    expect(sale.slice(15, 27)).toBe("43000001    ");
    expect(sale.slice(27, 57)).toBe("Cliente Perez, S.L.".padEnd(30));
    expect(sale.slice(57, 58)).toBe("D");
    expect(sale.slice(58, 68)).toBe("000003    ");
    expect(sale.slice(68, 69)).toBe("I");
    expect(sale.slice(69, 99)).toBe("Fra. FA-1 ? Perez".padEnd(30));
    expect(sale.slice(99, 113)).toBe("+0000001000.00");
    expect(sale.slice(113, 252)).toBe(" ".repeat(139));
    expect(sale.slice(252, 254)).toBe("EN");
    expect(records[3].slice(57, 58)).toBe("H");
    expect(records[3].slice(68, 69)).toBe("U");
  });

  it("marca inicio, medio y último apunte de cada asiento", () => {
    const records = buildSuenlace(journal, { companyCode: 1 }).split("\r\n").filter(Boolean);
    // Regularización (tres apuntes): I, M, U.
    expect(records.slice(10, 13).map((record) => record.slice(68, 69))).toEqual(["I", "M", "U"]);
  });

  it("formatea importes y valida el código de empresa", () => {
    expect(a3Amount(100_000)).toBe("+0000001000.00");
    expect(a3Amount(5)).toBe("+0000000000.05");
    expect(a3Amount(-1_234_567)).toBe("-0000012345.67");
    expect(() => buildSuenlace(journal, { companyCode: 0 })).toThrow();
    expect(() => buildSuenlace(journal, { companyCode: 100_000 })).toThrow();
  });

  it("solo usa ASCII", () => {
    expect(toAscii("Peña Ñú €")).toBe("Pena Nu EUR");
    expect(/^[\x20-\x7e\r\n]*$/.test(buildSuenlace(journal, { companyCode: 1 }))).toBe(true);
  });
});

describe("exportación a ContaPlus (XDiario y XSubCta)", () => {
  const journal = orderJournal(entries);

  it("XDiario: 347 caracteres por registro y los campos en las posiciones del protocolo", () => {
    const records = buildXDiario(journal).split("\r\n").filter(Boolean);
    expect(records).toHaveLength(16);
    for (const record of records) expect(record).toHaveLength(XDIARIO_RECORD_LENGTH);
    const sale = records[2];
    expect(sale.slice(0, 6)).toBe("     2"); // Asien (pos. 1)
    expect(sale.slice(6, 14)).toBe("20260210"); // Fecha (pos. 7)
    expect(sale.slice(14, 26)).toBe("43000001    "); // SubCta (pos. 15)
    expect(sale.slice(54, 79)).toBe("Fra. FA-1 ? Perez".padEnd(25)); // Concepto (pos. 55)
    expect(sale.slice(129, 139)).toBe("000003    "); // Documento (pos. 130)
    expect(sale.slice(237, 238)).toBe("2"); // MonedaUso (pos. 238)
    expect(sale.slice(238, 254)).toBe("1000.00".padStart(16)); // EuroDebe (pos. 239)
    expect(sale.slice(254, 270)).toBe("0.00".padStart(16)); // EuroHaber (pos. 255)
    expect(sale.slice(286, 287)).toBe("F"); // NoConv (pos. 287)
    expect(sale.slice(338, 339)).toBe("F"); // Rectifica (pos. 339)
    expect(records[3].slice(254, 270)).toBe("1000.00".padStart(16));
  });

  it("XSubCta: 161 caracteres, una subcuenta por registro sin repetir", () => {
    const records = buildXSubCta([
      { code: "57200001", name: "Banco" },
      { code: "43000001", name: "Cliente Pérez, S.L.", taxId: "B12345678", address: "Calle Mayor 1", city: "Madrid", province: "Madrid", postalCode: "28001" },
      { code: "57200001", name: "Banco" },
    ]).split("\r\n").filter(Boolean);
    expect(records).toHaveLength(2);
    for (const record of records) expect(record).toHaveLength(XSUBCTA_RECORD_LENGTH);
    const customer = records[0];
    expect(customer.slice(0, 12)).toBe("43000001    "); // Cod (pos. 1)
    expect(customer.slice(12, 52)).toBe("Cliente Perez, S.L.".padEnd(40)); // Titulo (pos. 13)
    expect(customer.slice(52, 67)).toBe("B12345678".padEnd(15)); // Nif (pos. 53)
    expect(customer.slice(67, 102)).toBe("Calle Mayor 1".padEnd(35)); // Domicilio (pos. 68)
    expect(customer.slice(102, 127)).toBe("Madrid".padEnd(25)); // Poblacion (pos. 103)
    expect(customer.slice(147, 152)).toBe("28001"); // CodPostal (pos. 148)
    expect(customer.slice(152, 153)).toBe("F"); // Divisa (pos. 153)
    expect(customer.slice(158, 160)).toBe("FF"); // Documento y Ajustame (pos. 159 y 160)
  });
});
