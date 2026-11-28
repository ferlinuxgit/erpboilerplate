import { describe, expect, it } from "vitest";

import { FiscalFileError, informativeProvinceCode, parseFilePeriod, percent4, type Declarant, type FilePeriod } from "@/server/fiscal-files/fields";
import { buildModelo111File } from "@/server/fiscal-files/modelo-111";
import { buildModelo123File } from "@/server/fiscal-files/modelo-123";
import { buildModelo180File, type Modelo180FileRecipient } from "@/server/fiscal-files/modelo-180";
import { buildModelo190File, type Modelo190FileRecipient } from "@/server/fiscal-files/modelo-190";
import { buildModelo193File, type Modelo193FileRecipient } from "@/server/fiscal-files/modelo-193";

const company: Declarant = { taxId: "ES-B12345674", name: "Peñón & Hijos, S.L.", isIndividual: false, phone: "+34 912 345 678", contactName: "Ana Pérez" };
const q1 = parseFilePeriod("2026-Q1") as FilePeriod;

const at = (text: string, pos: number, len: number) => text.slice(pos - 1, pos - 1 + len);
const problemsOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof FiscalFileError) return error.problems;
    throw error;
  }
  return [];
};
const linesOf = (text: string) => {
  expect(text.endsWith("\r\n")).toBe(true);
  return text.slice(0, -2).split("\r\n");
};

describe("piezas de las informativas de retenciones", () => {
  it("saca la provincia del código postal, con La Palma aparte", () => {
    expect(informativeProvinceCode("28013")).toBe("28");
    expect(informativeProvinceCode("38700")).toBe("53");
    expect(informativeProvinceCode("38001")).toBe("38");
    expect(informativeProvinceCode("75001")).toBeNull();
    expect(informativeProvinceCode("123")).toBeNull();
  });

  it("escribe el porcentaje en cuatro posiciones", () => {
    expect(percent4(19)).toBe("1900");
    expect(percent4(7.5)).toBe("0750");
    expect(() => percent4(120)).toThrow(FiscalFileError);
  });
});

describe("modelo 111 completo", () => {
  const file = buildModelo111File({
    declarant: company,
    period: q1,
    blocks: [
      { block: "work", cash: { recipients: 2, baseCents: 600_000, withheldCents: 90_000 }, inKind: { recipients: 1, baseCents: 20_000, withheldCents: 3_000 } },
      { block: "economic", cash: { recipients: 1, baseCents: 100_000, withheldCents: 15_000 }, inKind: { recipients: 0, baseCents: 0, withheldCents: 0 } },
    ],
  });
  const page = file.text.slice(328, 1328);

  it("coloca trabajo dinerario (01-03), en especie (04-06) y actividades económicas (07-09)", () => {
    expect(at(page, 109, 8)).toBe("00000002");
    expect(at(page, 117, 17)).toBe("00000000000600000");
    expect(at(page, 134, 17)).toBe("00000000000090000");
    expect(at(page, 151, 8)).toBe("00000001");
    expect(at(page, 159, 17)).toBe("00000000000020000");
    expect(at(page, 176, 17)).toBe("00000000000003000");
    expect(at(page, 193, 8)).toBe("00000001");
    expect(at(page, 218, 17)).toBe("00000000000015000");
    // Premios, forestales e imagen a cero (235-486).
    expect(at(page, 235, 252)).toBe("0".repeat(252));
    // 28 = 03 + 06 + 09; 29 a cero; 30 = 28.
    expect(at(page, 487, 17)).toBe("00000000000108000");
    expect(at(page, 504, 17)).toBe("0".repeat(17));
    expect(at(page, 521, 17)).toBe("00000000000108000");
    expect(file.warnings.join(" ")).not.toMatch(/solo lleva las retenciones a profesionales/);
  });

  it("no genera la complementaria (casilla 29)", () => {
    expect(problemsOf(() => buildModelo111File({ declarant: company, period: q1, blocks: [], previousCents: 100 })).join(" ")).toMatch(/casilla 29/);
  });
});

describe("modelo 123", () => {
  const file = buildModelo123File({
    declarant: company,
    period: q1,
    dividends: { count: 2, baseCents: 1_000_000, withheldCents: 190_000 },
    other: { count: 1, baseCents: 50_000, withheldCents: 9_500 },
  });
  const page = file.text.slice(328, 928);

  it("lleva cabecera, página de 600 posiciones y cierre", () => {
    expect(file.text.length).toBe(328 + 600 + 18);
    expect(at(file.text, 1, 17)).toBe("<T123020261T0000>");
    expect(file.text.endsWith("</T123020261T0000>")).toBe(true);
    expect(at(page, 1, 11)).toBe("<T12301000>");
    expect(at(page, 589, 12)).toBe("</T12301000>");
    expect(file.fileName).toBe("123-2026-1T.txt");
  });

  it("coloca número de rentas, bases, retenciones y resultado", () => {
    expect(at(page, 13, 1)).toBe("I");
    expect(at(page, 14, 9)).toBe("B12345674");
    expect(at(page, 103, 6)).toBe("20261T");
    expect(at(page, 109, 15)).toBe("000000000000002");
    expect(at(page, 124, 15)).toBe("000000000000001");
    expect(at(page, 139, 15)).toBe("000000000000003");
    expect(at(page, 154, 17)).toBe("00000000001000000");
    expect(at(page, 188, 17)).toBe("00000000001050000");
    expect(at(page, 205, 17)).toBe("00000000000190000");
    expect(at(page, 222, 17)).toBe("00000000000009500");
    expect(at(page, 239, 17)).toBe("00000000000199500");
    expect(at(page, 290, 17)).toBe("00000000000199500");
    expect(at(page, 324, 17)).toBe("00000000000199500");
    expect(at(page, 355, 34)).toBe(" ".repeat(34));
  });

  it("es negativa sin retenciones y valida el tipo", () => {
    const empty = buildModelo123File({ declarant: company, period: q1, dividends: { count: 0, baseCents: 0, withheldCents: 0 }, other: { count: 0, baseCents: 0, withheldCents: 0 } });
    expect(at(empty.text.slice(328), 13, 1)).toBe("N");
    expect(problemsOf(() => buildModelo123File({ declarant: company, period: q1, dividends: { count: 1, baseCents: 100, withheldCents: 19 }, other: { count: 0, baseCents: 0, withheldCents: 0 }, declarationType: "U" })).join(" ")).toMatch(/IBAN/);
    expect(problemsOf(() => buildModelo123File({ declarant: company, period: parseFilePeriod("2023-Q1") as FilePeriod, dividends: { count: 0, baseCents: 0, withheldCents: 0 }, other: { count: 0, baseCents: 0, withheldCents: 0 } })).join(" ")).toMatch(/2024/);
  });
});

describe("modelo 190", () => {
  const recipients: Modelo190FileRecipient[] = [
    {
      taxId: "12345678Z", name: "García López, María", key: "A", subkey: null,
      cashCents: 2_400_000, withheldCents: 360_000, inKindCents: 50_000, inKindWithheldCents: 7_500, deductibleExpensesCents: 152_400,
      personal: { birthYear: 1985, familySituation: 2, disability: 0, contractType: 1, spouseTaxId: "87654321X" },
    },
    { taxId: "B87654321", name: "Asesores Norte SL", key: "G", subkey: "01", cashCents: 300_000, withheldCents: 45_000, inKindCents: 0, inKindWithheldCents: 0 },
  ];
  const file = buildModelo190File({ declarant: company, year: 2026, recipients, postalCodes: new Map([["B87654321", "38700"]]), defaultProvince: "28" });
  const lines = linesOf(file.text);

  it("genera un registro de 500 posiciones del declarante y uno por perceptor", () => {
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toHaveLength(500);
    expect(file.fileName).toBe("190-2026.txt");
  });

  it("resume la declaración en el tipo 1", () => {
    const head = lines[0];
    expect(at(head, 1, 8)).toBe("11902026");
    expect(at(head, 9, 9)).toBe("B12345674");
    expect(at(head, 18, 40).trim()).toBe("PEÑON HIJOS S L");
    expect(at(head, 58, 1)).toBe("T");
    expect(at(head, 59, 9)).toBe("912345678");
    expect(at(head, 68, 40).trim()).toBe("ANA PEREZ");
    expect(at(head, 108, 13)).toBe("1902026000001");
    expect(at(head, 121, 2)).toBe("  ");
    expect(at(head, 123, 13)).toBe("0".repeat(13));
    expect(at(head, 136, 9)).toBe("000000002");
    // Percepciones: dinerarias + en especie de todos, con campo de signo.
    expect(at(head, 145, 16)).toBe(" 000000002750000");
    expect(at(head, 161, 15)).toBe("000000000412500");
    expect(at(head, 176, 325)).toBe(" ".repeat(325));
  });

  it("detalla el empleado con sus datos adicionales y gastos deducibles", () => {
    const row = lines[1];
    expect(at(row, 1, 8)).toBe("21902026");
    expect(at(row, 9, 9)).toBe("B12345674");
    expect(at(row, 18, 9)).toBe("12345678Z");
    expect(at(row, 27, 9)).toBe(" ".repeat(9));
    expect(at(row, 36, 40).trim()).toBe("GARCIA LOPEZ MARIA");
    // Sin ficha de tercero: provincia indicada al descargar.
    expect(at(row, 76, 2)).toBe("28");
    expect(at(row, 78, 3)).toBe("A00");
    expect(at(row, 81, 14)).toBe(" 0000002400000");
    expect(at(row, 95, 13)).toBe("0000000360000");
    expect(at(row, 108, 14)).toBe(" 0000000050000");
    expect(at(row, 122, 13)).toBe("0000000007500");
    expect(at(row, 135, 13)).toBe("0".repeat(13));
    expect(at(row, 148, 5)).toBe("00000");
    expect(at(row, 153, 4)).toBe("1985");
    expect(at(row, 157, 1)).toBe("2");
    expect(at(row, 158, 9)).toBe("87654321X");
    expect(at(row, 167, 4)).toBe("0100");
    expect(at(row, 184, 13)).toBe("0000000152400");
    expect(at(row, 255, 1)).toBe(" ");
    expect(at(row, 395, 106)).toBe(" ".repeat(106));
  });

  it("detalla el profesional con su subclave y la provincia de su ficha", () => {
    const row = lines[2];
    expect(at(row, 76, 2)).toBe("53");
    expect(at(row, 78, 3)).toBe("G01");
    expect(at(row, 81, 14)).toBe(" 0000000300000");
    expect(at(row, 95, 13)).toBe("0000000045000");
    // Sin datos adicionales ni gastos deducibles.
    expect(at(row, 153, 4)).toBe("0000");
    expect(at(row, 158, 9)).toBe(" ".repeat(9));
    expect(at(row, 184, 13)).toBe("0".repeat(13));
  });

  it("pide lo que falta: provincia, NIF, datos del empleado, subclave", () => {
    const problems = problemsOf(() => buildModelo190File({
      declarant: company,
      year: 2026,
      recipients: [
        { ...recipients[0], personal: { birthYear: null, familySituation: null, contractType: null } },
        { ...recipients[1], taxId: "X", subkey: null },
      ],
    })).join(" ");
    expect(problems).toMatch(/provincia/);
    expect(problems).toMatch(/NIF español/);
    expect(problems).toMatch(/año de nacimiento/);
    expect(problems).toMatch(/subclave/);
    expect(problemsOf(() => buildModelo190File({ declarant: company, year: 2026, recipients: [] })).join(" ")).toMatch(/ningún perceptor/);
    expect(problemsOf(() => buildModelo190File({ declarant: company, year: 2024, recipients, defaultProvince: "28" })).join(" ")).toMatch(/2025/);
    expect(problemsOf(() => buildModelo190File({ declarant: company, year: 2026, recipients: [{ ...recipients[1], cashCents: -1 }], defaultProvince: "28" })).join(" ")).toMatch(/negativas/);
  });
});

describe("modelo 180", () => {
  const recipient: Modelo180FileRecipient = {
    taxId: "12345678Z", name: "Martínez Ruiz, Juan", modality: "1", baseCents: 1_200_000, rate: 19, withheldCents: 228_000,
    property: { situation: "1", cadastralReference: "9872023 VH5797S 0001 WX", address: "Calle Mayor 5, 2º B", postalCode: "28013", city: "Madrid" },
    propertyCount: 1,
  };
  const file = buildModelo180File({ declarant: company, year: 2026, recipients: [recipient], postalCodes: new Map([["12345678Z", "08001"]]) });
  const lines = linesOf(file.text);

  it("genera el tipo 1 con los totales", () => {
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveLength(500);
    expect(at(lines[0], 1, 8)).toBe("11802026");
    expect(at(lines[0], 108, 13)).toBe("1802026000001");
    expect(at(lines[0], 136, 9)).toBe("000000001");
    expect(at(lines[0], 145, 16)).toBe(" 000000001200000");
    expect(at(lines[0], 161, 15)).toBe("000000000228000");
  });

  it("detalla el arrendador y el inmueble", () => {
    const row = lines[1];
    expect(at(row, 1, 8)).toBe("21802026");
    expect(at(row, 18, 9)).toBe("12345678Z");
    expect(at(row, 76, 2)).toBe("08");
    expect(at(row, 78, 1)).toBe("1");
    expect(at(row, 79, 14)).toBe(" 0000001200000");
    expect(at(row, 93, 4)).toBe("1900");
    expect(at(row, 97, 13)).toBe("0000000228000");
    expect(at(row, 110, 4)).toBe("0000");
    expect(at(row, 114, 1)).toBe("1");
    expect(at(row, 115, 20)).toBe("9872023VH5797S0001WX");
    expect(at(row, 135, 5)).toBe(" ".repeat(5));
    expect(at(row, 140, 50).trim()).toBe("CALLE MAYOR 5 2 B");
    expect(at(row, 286, 30).trim()).toBe("MADRID");
    expect(at(row, 321, 2)).toBe("28");
    expect(at(row, 323, 5)).toBe("28013");
    expect(at(row, 328, 173)).toBe(" ".repeat(173));
  });

  it("pide el inmueble y su referencia catastral", () => {
    expect(problemsOf(() => buildModelo180File({ declarant: company, year: 2026, recipients: [{ ...recipient, property: null }], defaultProvince: "28" })).join(" ")).toMatch(/inmueble alquilado/);
    expect(problemsOf(() => buildModelo180File({ declarant: company, year: 2026, recipients: [{ ...recipient, property: { ...recipient.property!, cadastralReference: "123" } }], defaultProvince: "28" })).join(" ")).toMatch(/referencia catastral/);
    expect(buildModelo180File({ declarant: company, year: 2026, recipients: [{ ...recipient, propertyCount: 2 }], defaultProvince: "28" }).warnings.join(" ")).toMatch(/varios inmuebles/);
  });
});

describe("modelo 193", () => {
  const recipients: Modelo193FileRecipient[] = [
    { taxId: "12345678Z", name: "Socio Uno", key: "A", nature: "02", incomeCents: 1_000_000, baseCents: 1_000_000, rate: 19, withheldCents: 190_000, accrualDate: "2026-06-30", severalDates: true },
    { taxId: "87654321X", name: "Prestamista Dos", key: "B", nature: "03", incomeCents: 50_000, baseCents: 50_000, rate: null, withheldCents: 9_500 },
  ];
  const file = buildModelo193File({ declarant: company, year: 2026, recipients, defaultProvince: "46" });
  const lines = linesOf(file.text);

  it("genera el tipo 1 con la naturaleza «S» y los totales", () => {
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toHaveLength(500);
    const head = lines[0];
    expect(at(head, 1, 8)).toBe("11932026");
    expect(at(head, 136, 9)).toBe("000000002");
    expect(at(head, 145, 15)).toBe("000000001050000");
    expect(at(head, 160, 15)).toBe("000000000199500");
    expect(at(head, 175, 15)).toBe("0".repeat(15));
    expect(at(head, 220, 15)).toBe("0".repeat(15));
    expect(at(head, 235, 1)).toBe("S");
  });

  it("detalla el dividendo con su fecha de devengo y la clave de mercado", () => {
    const row = lines[1];
    expect(at(row, 1, 8)).toBe("21932026");
    expect(at(row, 76, 1)).toBe(" ");
    expect(at(row, 77, 2)).toBe("46");
    expect(at(row, 79, 1)).toBe("0");
    expect(at(row, 80, 12)).toBe(" ".repeat(12));
    expect(at(row, 92, 3)).toBe("A02");
    expect(at(row, 95, 2)).toBe("0 ");
    expect(at(row, 118, 5)).toBe("00001");
    expect(at(row, 123, 13)).toBe("0000001000000");
    expect(at(row, 139, 13)).toBe("0".repeat(13));
    expect(at(row, 152, 13)).toBe("0000001000000");
    expect(at(row, 165, 4)).toBe("1900");
    expect(at(row, 169, 13)).toBe("0000000190000");
    expect(at(row, 182, 11)).toBe("0".repeat(11));
    expect(at(row, 193, 12)).toBe(" ".repeat(12));
    expect(at(row, 208, 1)).toBe("S");
    expect(at(row, 315, 7)).toBe("0000001");
    expect(at(row, 331, 9)).toBe("30062026D");
    expect(file.warnings.join(" ")).toMatch(/varias fechas/);
  });

  it("los intereses no llevan fecha de devengo y el tipo se deduce", () => {
    const row = lines[2];
    expect(at(row, 92, 3)).toBe("B03");
    expect(at(row, 165, 4)).toBe("1900");
    expect(at(row, 315, 7)).toBe("0000002");
    expect(at(row, 331, 8)).toBe("00000000");
  });

  it("pide la fecha de pago del dividendo", () => {
    expect(problemsOf(() => buildModelo193File({ declarant: company, year: 2026, recipients: [{ ...recipients[0], accrualDate: null }], defaultProvince: "46" })).join(" ")).toMatch(/fecha de pago/);
    expect(problemsOf(() => buildModelo193File({ declarant: company, year: 2026, recipients: [{ ...recipients[0], key: "C" }], defaultProvince: "46" })).join(" ")).toMatch(/no sabe generar/);
  });
});
