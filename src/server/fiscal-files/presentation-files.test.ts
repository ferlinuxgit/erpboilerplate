import { describe, expect, it } from "vitest";

import {
  alpha, amountSignedN, amountUnsigned, amountWithSignField, buildRecord, encodeLatin1, FiscalFileError, nifField, parseFilePeriod, sanitizeText,
  splitDeclarantName, type Declarant, type FilePeriod,
} from "@/server/fiscal-files/fields";
import { buildModelo111File } from "@/server/fiscal-files/modelo-111";
import { buildModelo115File } from "@/server/fiscal-files/modelo-115";
import { buildModelo130File } from "@/server/fiscal-files/modelo-130";
import { buildModelo303File, MODELO_303_PAGE_LENGTHS } from "@/server/fiscal-files/modelo-303";
import { buildModelo347File, provinceFromPostalCode } from "@/server/fiscal-files/modelo-347";
import { buildModelo349File } from "@/server/fiscal-files/modelo-349";

const company: Declarant = { taxId: "ES-B12345674", name: "Peñón & Hijos, S.L.", isIndividual: false, phone: "+34 912 345 678" };
const person: Declarant = { taxId: "12345678Z", name: "García López, María", isIndividual: true };
const q1 = parseFilePeriod("2026-Q1") as FilePeriod;

/** Trozo del texto por posición del diseño (la primera es la 1). */
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

describe("campos de los ficheros de la AEAT", () => {
  it("sanea el texto: mayúsculas, sin acentos, conserva Ñ y Ç", () => {
    expect(sanitizeText("Peñón & Hijos, S.L.")).toBe("PEÑON HIJOS S L");
    expect(sanitizeText("  Çà  et là  ")).toBe("ÇA ET LA");
    expect(alpha("áéíóú", 8)).toBe("AEIOU   ");
    expect(alpha("ABCDEFGHIJ", 4)).toBe("ABCD");
  });

  it("rellena los importes con ceros y pone la N de los negativos", () => {
    expect(amountUnsigned(123456, 17)).toBe("00000000000123456");
    expect(amountSignedN(-123456, 17)).toBe("N0000000000123456");
    expect(amountSignedN(0, 17)).toBe("00000000000000000");
    expect(amountWithSignField(-5010, 15)).toBe("N000000000005010");
    expect(amountWithSignField(5010, 15)).toBe(" 000000000005010");
    expect(() => amountUnsigned(-1, 17)).toThrow(FiscalFileError);
  });

  it("ajusta el NIF y reconoce los periodos", () => {
    expect(nifField("es b-1234567 4")).toBe("B12345674");
    expect(nifField("1234567L")).toBe("01234567L");
    expect(parseFilePeriod("2026-Q4")).toEqual({ year: 2026, code: "4T", isLastOfYear: true, isMonthly: false });
    expect(parseFilePeriod("2026-02")).toEqual({ year: 2026, code: "02", isLastOfYear: false, isMonthly: true });
    expect(parseFilePeriod("2026")?.code).toBe("0A");
    expect(parseFilePeriod("2026-13")).toBeNull();
  });

  it("separa apellidos y nombre por la coma y avisa si no puede", () => {
    expect(splitDeclarantName(person)).toEqual({ surname: "GARCIA LOPEZ", firstName: "MARIA", needsReview: false });
    expect(splitDeclarantName({ ...person, name: "María García" }).needsReview).toBe(true);
    expect(splitDeclarantName(company)).toEqual({ surname: "PEÑON HIJOS S L", firstName: "", needsReview: false });
  });

  it("no deja montar un registro con campos que se pisan o no miden lo que dice el diseño", () => {
    expect(() => buildRecord(10, [{ pos: 1, len: 3, value: "AB" }])).toThrow(/mide 2/);
    expect(() => buildRecord(10, [{ pos: 1, len: 3, value: "ABC" }, { pos: 3, len: 2, value: "XY" }])).toThrow(/pisa/);
    expect(() => buildRecord(10, [{ pos: 9, len: 3, value: "ABC" }])).toThrow(/se sale/);
    expect(buildRecord(6, [{ pos: 2, len: 2, value: "AB" }])).toBe(" AB   ");
  });

  it("codifica en ISO-8859-1 (Ñ = D1, Ç = C7)", () => {
    expect([...encodeLatin1("ÑÇA")]).toEqual([0xd1, 0xc7, 0x41]);
    expect(() => encodeLatin1("€")).toThrow();
  });
});

describe("modelo 111", () => {
  const file = buildModelo111File({ declarant: company, period: q1, professionals: { recipients: 3, baseCents: 1_000_000, withheldCents: 150_000 } });
  const page = file.text.slice(328, 1328);

  it("lleva la cabecera, la página de 1000 posiciones y el cierre", () => {
    expect(file.text.length).toBe(328 + 1000 + 18);
    expect(at(file.text, 1, 17)).toBe("<T111020261T0000>");
    expect(at(file.text, 18, 5)).toBe("<AUX>");
    expect(at(file.text, 323, 6)).toBe("</AUX>");
    expect(file.text.endsWith("</T111020261T0000>")).toBe(true);
    expect(at(page, 1, 11)).toBe("<T11101000>");
    expect(at(page, 989, 12)).toBe("</T11101000>");
    expect(file.fileName).toBe("111-2026-1T.txt");
    expect(file.bytes.length).toBe(file.text.length);
  });

  it("coloca identificación, actividades económicas y totales en su posición", () => {
    expect(at(page, 13, 1)).toBe("I");
    expect(at(page, 14, 9)).toBe("B12345674");
    expect(at(page, 23, 60).trim()).toBe("PEÑON HIJOS S L");
    expect(at(page, 103, 6)).toBe("20261T");
    // Trabajo (109-192) a ceros; actividades económicas dinerarias en 193, 201 y 218.
    expect(at(page, 109, 84)).toBe("0".repeat(84));
    expect(at(page, 193, 8)).toBe("00000003");
    expect(at(page, 201, 17)).toBe("00000000001000000");
    expect(at(page, 218, 17)).toBe("00000000000150000");
    expect(at(page, 487, 17)).toBe("00000000000150000");
    expect(at(page, 521, 17)).toBe("00000000000150000");
    expect(at(page, 538, 451)).toBe(" ".repeat(451));
  });

  it("es negativa (N) sin retenciones y valida los datos", () => {
    const empty = buildModelo111File({ declarant: company, period: q1, professionals: { recipients: 0, baseCents: 0, withheldCents: 0 } });
    expect(at(empty.text.slice(328), 13, 1)).toBe("N");
    expect(problemsOf(() => buildModelo111File({ declarant: { ...company, taxId: "" }, period: q1, professionals: { recipients: 1, baseCents: 100, withheldCents: 15 } }))[0]).toMatch(/Falta el NIF/);
    expect(problemsOf(() => buildModelo111File({ declarant: company, period: q1, professionals: { recipients: 0, baseCents: 100, withheldCents: 15 } }))[0]).toMatch(/perceptor/);
    expect(problemsOf(() => buildModelo111File({ declarant: company, period: q1, professionals: { recipients: 1, baseCents: -100, withheldCents: -15 } }))[0]).toMatch(/negativ/);
  });
});

describe("modelo 115", () => {
  it("genera la página de 500 posiciones con las casillas 01 a 03", () => {
    const file = buildModelo115File({ declarant: person, period: parseFilePeriod("2026-03") as FilePeriod, recipients: 1, baseCents: 90_000, withheldCents: 17_100 });
    const page = file.text.slice(328, 828);
    expect(file.text.length).toBe(328 + 500 + 18);
    expect(file.text.endsWith("</T1150202603" + "0000>")).toBe(true);
    expect(at(page, 1, 11)).toBe("<T11501000>");
    expect(at(page, 14, 9)).toBe("12345678Z");
    expect(at(page, 23, 60).trim()).toBe("GARCIA LOPEZ");
    expect(at(page, 83, 20).trim()).toBe("MARIA");
    expect(at(page, 103, 6)).toBe("202603");
    expect(at(page, 109, 15)).toBe("000000000000001");
    expect(at(page, 124, 17)).toBe("00000000000090000");
    expect(at(page, 141, 17)).toBe("00000000000017100");
    expect(at(page, 158, 17)).toBe("0".repeat(17));
    expect(at(page, 175, 17)).toBe("00000000000017100");
    expect(at(page, 489, 12)).toBe("</T11501000>");
  });
});

describe("modelo 130", () => {
  const boxes = { "01": 3_000_000, "02": 1_000_000, "03": 2_000_000, "04": 400_000, "05": 0, "06": 50_000, "07": 350_000, "12": 350_000, "14": 350_000, "17": 350_000, "19": 350_000 };

  it("coloca las 19 casillas seguidas desde la 109 y cierra en la 600", () => {
    const file = buildModelo130File({ declarant: person, period: q1, boxes });
    const page = file.text.slice(328, 928);
    expect(file.text.length).toBe(328 + 600 + 18);
    expect(file.text.endsWith("</T130020261T0000>")).toBe(true);
    expect(at(page, 13, 1)).toBe("I");
    expect(at(page, 109, 17)).toBe("00000000003000000");
    expect(at(page, 143, 17)).toBe("00000000002000000");
    expect(at(page, 415, 17)).toBe("00000000000350000");
    expect(at(page, 228, 68)).toBe("0".repeat(68));
    expect(at(page, 589, 12)).toBe("</T13001000>");
  });

  it("marca los negativos con N y el tipo B (a deducir)", () => {
    const file = buildModelo130File({ declarant: person, period: q1, boxes: { "01": 100_000, "02": 300_000, "03": -200_000, "07": 0, "19": -5_000 } });
    const page = file.text.slice(328, 928);
    expect(at(page, 13, 1)).toBe("B");
    expect(at(page, 143, 17)).toBe("N0000000000200000");
    expect(at(page, 415, 17)).toBe("N0000000000005000");
  });

  it("rechaza sociedades, periodos mensuales y casillas sin signo en negativo", () => {
    expect(problemsOf(() => buildModelo130File({ declarant: company, period: q1, boxes }))[0]).toMatch(/personas físicas/);
    expect(problemsOf(() => buildModelo130File({ declarant: person, period: parseFilePeriod("2026-02") as FilePeriod, boxes }))[0]).toMatch(/trimestral/);
    expect(problemsOf(() => buildModelo130File({ declarant: person, period: q1, boxes: { ...boxes, "02": -1 } }))[0]).toMatch(/casilla 02/);
  });
});

describe("modelo 303", () => {
  // 1.000 € al 21 %, 500 € al 10 %, rectificativa de −100 € al 21 %, compras de 400 € con 84 € deducibles.
  const boxes = {
    "07": 100_000, "09": 21_000, "04": 50_000, "06": 5_000, "14": -10_000, "15": -2_100, "27": 23_900,
    "28": 40_000, "29": 8_400, "45": 8_400, "46": 15_500, "64": 15_500, "66": 15_500, "110": 2_000, "78": 2_000, "87": 0,
    "69": 13_500, "71": 13_500, "59": 30_000, EXE: 1_000, "80": 150_000, "88": 150_000,
  };
  const file = buildModelo303File({ declarant: company, period: q1, boxes });
  const page1 = file.text.slice(328, 328 + 1581);
  const page3 = file.text.slice(328 + 1581, 328 + 1581 + 1017);
  const did = file.text.slice(328 + 1581 + 1017, 328 + 1581 + 1017 + 823);

  it("tiene las tres páginas con su longitud y sus marcas", () => {
    expect(MODELO_303_PAGE_LENGTHS).toEqual({ page1: 1581, page3: 1017, did: 823 });
    expect(file.text.length).toBe(328 + 1581 + 1017 + 823 + 18);
    expect(at(file.text, 1, 17)).toBe("<T303020261T0000>");
    expect(file.text.endsWith("</T303020261T0000>")).toBe(true);
    expect(at(page1, 1, 11)).toBe("<T30301000>");
    expect(at(page1, 1570, 12)).toBe("</T30301000>");
    expect(at(page3, 1, 11)).toBe("<T30303000>");
    expect(at(page3, 1006, 12)).toBe("</T30303000>");
    expect(at(did, 1, 11)).toBe("<T303DID00>");
    expect(at(did, 812, 12)).toBe("</T303DID00>");
  });

  it("coloca la identificación y las casillas del régimen general", () => {
    expect(at(page1, 13, 1)).toBe("I");
    expect(at(page1, 14, 9)).toBe("B12345674");
    expect(at(page1, 23, 80).trim()).toBe("PEÑON HIJOS S L");
    expect(at(page1, 103, 6)).toBe("20261T");
    // Marcas 109-117 y 127-130: no foral, no REDEME, solo régimen general, etc.
    expect(at(page1, 109, 9)).toBe("223222222");
    expect(at(page1, 127, 4)).toBe("2000");
    // Tipos constantes del diseño.
    expect(at(page1, 226, 5)).toBe("00400");
    expect(at(page1, 304, 5)).toBe("01000");
    expect(at(page1, 343, 5)).toBe("02100");
    expect(at(page1, 484, 5)).toBe("00175");
    expect(at(page1, 523, 5)).toBe("00050");
    expect(at(page1, 601, 5)).toBe("00140");
    expect(at(page1, 640, 5)).toBe("00520");
    // 04 y 06 (10 %), 07 y 09 (21 %).
    expect(at(page1, 287, 17)).toBe("00000000000050000");
    expect(at(page1, 309, 17)).toBe("00000000000005000");
    expect(at(page1, 326, 17)).toBe("00000000000100000");
    expect(at(page1, 348, 17)).toBe("00000000000021000");
    // 14 y 15 con signo.
    expect(at(page1, 433, 17)).toBe("N0000000000010000");
    expect(at(page1, 450, 17)).toBe("N0000000000002100");
    expect(at(page1, 696, 17)).toBe("00000000000023900");
    expect(at(page1, 713, 17)).toBe("00000000000040000");
    expect(at(page1, 730, 17)).toBe("00000000000008400");
    expect(at(page1, 1002, 17)).toBe("00000000000008400");
    expect(at(page1, 1019, 17)).toBe("00000000000015500");
    expect(at(page1, 1036, 534)).toBe(" ".repeat(534));
  });

  it("coloca el resultado y la compensación en la página 3", () => {
    expect(at(page3, 12, 17)).toBe("00000000000030000");
    expect(at(page3, 199, 17)).toBe("00000000000015500");
    expect(at(page3, 216, 5)).toBe("10000");
    expect(at(page3, 221, 17)).toBe("00000000000015500");
    expect(at(page3, 255, 17)).toBe("00000000000002000");
    expect(at(page3, 272, 17)).toBe("00000000000002000");
    expect(at(page3, 289, 17)).toBe("0".repeat(17));
    expect(at(page3, 340, 17)).toBe("00000000000013500");
    expect(at(page3, 408, 17)).toBe("00000000000013500");
    expect(at(page3, 425, 1)).toBe(" ");
    expect(at(did, 194, 1)).toBe("0");
  });

  it("deja a compensar el resultado negativo y marca el último periodo", () => {
    const negative = buildModelo303File({
      declarant: company,
      period: parseFilePeriod("2026-Q4") as FilePeriod,
      boxes: { "07": 10_000, "09": 2_100, "27": 2_100, "28": 100_000, "29": 21_000, "45": 21_000, "46": -18_900, "64": -18_900, "66": -18_900, "69": -18_900, "71": -18_900 },
    });
    const first = negative.text.slice(328, 328 + 1581);
    const third = negative.text.slice(328 + 1581, 328 + 1581 + 1017);
    expect(at(first, 13, 1)).toBe("C");
    expect(at(first, 128, 2)).toBe("20");
    expect(at(first, 1019, 17)).toBe("N0000000000018900");
    expect(at(third, 408, 17)).toBe("N0000000000018900");
  });

  it("pide el IBAN para la devolución y lo anota en la página DID", () => {
    const period = parseFilePeriod("2026-Q4") as FilePeriod;
    const negativeBoxes = { "29": 1_000, "28": 5_000, "45": 1_000, "46": -1_000, "71": -1_000 };
    expect(problemsOf(() => buildModelo303File({ declarant: company, period, boxes: negativeBoxes, declarationType: "D" }))[0]).toMatch(/IBAN/);
    const refund = buildModelo303File({ declarant: company, period, boxes: negativeBoxes, declarationType: "D", iban: "ES91 2100 0418 4502 0005 1332" });
    const page = refund.text.slice(328 + 1581 + 1017);
    expect(at(page, 23, 34).trim()).toBe("ES9121000418450200051332");
    expect(at(page, 194, 1)).toBe("1");
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: q1, boxes: negativeBoxes, declarationType: "D", iban: "ES9121000418450200051332" }))[0]).toMatch(/último periodo/);
  });

  it("no genera el fichero si las casillas no cuadran, hay tipos sin casilla o el ejercicio es anterior", () => {
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: q1, boxes: { ...boxes, "27": 99 } })).join(" ")).toMatch(/casilla 27/);
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: q1, boxes: { ...boxes, REV: 500 } })).join(" ")).toMatch(/no tiene casilla/);
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: parseFilePeriod("2025-Q4") as FilePeriod, boxes })).join(" ")).toMatch(/2026 en adelante/);
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: q1, boxes, cashAccounting: true })).join(" ")).toMatch(/criterio de caja/);
    expect(problemsOf(() => buildModelo303File({ declarant: company, period: q1, boxes, declarationType: "C" })).join(" ")).toMatch(/no corresponde/);
  });

  it("marca «sin actividad» y tipo N con todo a cero", () => {
    const empty = buildModelo303File({ declarant: company, period: q1, boxes: {}, noActivity: true });
    expect(at(empty.text.slice(328), 13, 1)).toBe("N");
    expect(at(empty.text.slice(328 + 1581), 425, 1)).toBe("X");
  });
});

describe("modelo 347", () => {
  const parties = [
    { key: "B" as const, taxId: "A58818501", name: "Cliente Uno, S.A.", postalCode: "08001", amountCents: 1_210_000, quartersCents: [605_000, 0, 605_000, 0] as [number, number, number, number], cashCents: 700_000 },
    { key: "A" as const, taxId: "12345678Z", name: "Proveedor Núñez", postalCode: "28013", amountCents: -400_000, quartersCents: [0, -400_000, 0, 0] as [number, number, number, number] },
  ];
  const file = buildModelo347File({ declarant: company, year: 2026, parties });
  const lines = file.text.split("\r\n");

  it("genera un registro de 500 posiciones por declarado más el del declarante", () => {
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    for (const line of lines.slice(0, 3)) expect(line.length).toBe(500);
    expect(file.fileName).toBe("347-2026.txt");
  });

  it("resume la declaración en el registro de tipo 1", () => {
    const head = lines[0];
    expect(at(head, 1, 8)).toBe("13472026");
    expect(at(head, 9, 9)).toBe("B12345674");
    expect(at(head, 18, 40).trim()).toBe("PEÑON HIJOS S L");
    expect(at(head, 58, 1)).toBe("T");
    expect(at(head, 59, 9)).toBe("912345678");
    expect(at(head, 108, 13)).toBe("3472026000001");
    expect(at(head, 123, 13)).toBe("0".repeat(13));
    expect(at(head, 136, 9)).toBe("000000002");
    // 12.100,00 − 4.000,00 = 8.100,00
    expect(at(head, 145, 16)).toBe(" 000000000810000");
    expect(at(head, 161, 9)).toBe("0".repeat(9));
    expect(at(head, 186, 315)).toBe(" ".repeat(315));
  });

  it("detalla cada declarado: clave, provincia, importes con signo, trimestres y metálico", () => {
    const customer = lines[1];
    expect(at(customer, 1, 17)).toBe("23472026B12345674");
    expect(at(customer, 18, 9)).toBe("A58818501");
    expect(at(customer, 36, 40).trim()).toBe("CLIENTE UNO S A");
    expect(at(customer, 76, 5)).toBe("D08  ");
    expect(at(customer, 82, 1)).toBe("B");
    expect(at(customer, 83, 16)).toBe(" 000000001210000");
    expect(at(customer, 101, 15)).toBe("000000000700000");
    expect(at(customer, 132, 4)).toBe("2026");
    expect(at(customer, 136, 16)).toBe(" 000000000605000");
    expect(at(customer, 168, 16)).toBe(" 000000000000000");
    expect(at(customer, 200, 16)).toBe(" 000000000605000");
    expect(at(customer, 232, 16)).toBe(" 000000000000000");
    expect(at(customer, 300, 6)).toBe("000000");
    expect(at(customer, 306, 195)).toBe(" ".repeat(195));

    const supplier = lines[2];
    expect(at(supplier, 18, 9)).toBe("12345678Z");
    expect(at(supplier, 36, 40).trim()).toBe("PROVEEDOR NUÑEZ");
    expect(at(supplier, 77, 2)).toBe("28");
    expect(at(supplier, 82, 1)).toBe("A");
    expect(at(supplier, 83, 16)).toBe("N000000000400000");
    expect(at(supplier, 132, 4)).toBe("0000");
    expect(at(supplier, 168, 16)).toBe("N000000000400000");
    // La Ñ viaja en un solo byte (D1).
    expect(file.bytes.length).toBe(file.text.length);
    expect(file.bytes[file.text.indexOf("Ñ", 1004)]).toBe(0xd1);
  });

  it("pide los datos que faltan en las fichas", () => {
    expect(provinceFromPostalCode("08001")).toBe("08");
    expect(provinceFromPostalCode("99001")).toBeNull();
    const problems = problemsOf(() => buildModelo347File({
      declarant: company,
      year: 2026,
      parties: [{ ...parties[0], postalCode: null }, { ...parties[1], taxId: "Sin NIF" }, { ...parties[0], quartersCents: [1, 0, 0, 0] }],
    })).join(" ");
    expect(problems).toMatch(/código postal/);
    expect(problems).toMatch(/falta el NIF/);
    expect(problems).toMatch(/suma de los trimestres/);
    expect(problemsOf(() => buildModelo347File({ declarant: company, year: 2026, parties: [] }))[0]).toMatch(/nada que declarar/);
  });
});

describe("modelo 349", () => {
  const operators = [
    { key: "E" as const, taxId: "FR12345678901", name: "Société Générale d'Équipement", amountCents: 500_000 },
    { key: "A" as const, taxId: "DE123456789", name: "Müller GmbH", amountCents: 250_050 },
  ];
  const file = buildModelo349File({ declarant: company, period: q1, operators });
  const lines = file.text.split("\r\n");

  it("genera registros de 500 posiciones con el resumen en el tipo 1", () => {
    expect(lines).toHaveLength(4);
    for (const line of lines.slice(0, 3)) expect(line.length).toBe(500);
    const head = lines[0];
    expect(at(head, 1, 17)).toBe("13492026B12345674");
    expect(at(head, 58, 1)).toBe(" ");
    expect(at(head, 108, 13)).toBe("3492026100001");
    expect(at(head, 136, 2)).toBe("1T");
    expect(at(head, 138, 9)).toBe("000000002");
    expect(at(head, 147, 15)).toBe("000000000750050");
    expect(at(head, 162, 24)).toBe("0".repeat(24));
    expect(at(head, 186, 315)).toBe(" ".repeat(315));
  });

  it("detalla cada operador con país, NIF-IVA, clave y base", () => {
    const first = lines[1];
    expect(at(first, 1, 17)).toBe("23492026B12345674");
    expect(at(first, 18, 58)).toBe(" ".repeat(58));
    expect(at(first, 76, 17)).toBe("FR12345678901    ");
    expect(at(first, 93, 40).trim()).toBe("SOCIETE GENERALE D EQUIPEMENT");
    expect(at(first, 133, 1)).toBe("E");
    expect(at(first, 134, 13)).toBe("0000000500000");
    expect(at(first, 147, 354)).toBe(" ".repeat(354));
    expect(at(lines[2], 76, 17)).toBe("DE123456789      ");
    expect(at(lines[2], 93, 40).trim()).toBe("MULLER GMBH");
    expect(at(lines[2], 133, 14)).toBe("A0000000250050");
  });

  it("no genera el fichero con rectificaciones, importes negativos, NIF-IVA español o periodo anual", () => {
    expect(problemsOf(() => buildModelo349File({ declarant: company, period: q1, operators, rectificationCount: 1 })).join(" ")).toMatch(/rectificaciones/);
    expect(problemsOf(() => buildModelo349File({ declarant: company, period: q1, operators: [{ ...operators[0], amountCents: -1 }] })).join(" ")).toMatch(/negativo/);
    expect(problemsOf(() => buildModelo349File({ declarant: company, period: q1, operators: [{ ...operators[0], taxId: "ESB12345674" }] })).join(" ")).toMatch(/NIF-IVA/);
    expect(problemsOf(() => buildModelo349File({ declarant: company, period: parseFilePeriod("2026") as FilePeriod, operators })).join(" ")).toMatch(/mensual o trimestral/);
  });
});
