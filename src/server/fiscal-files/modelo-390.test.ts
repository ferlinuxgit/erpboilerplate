import { describe, expect, it } from "vitest";

import { FiscalFileError, type Declarant } from "@/server/fiscal-files/fields";
import { buildModelo390File, MODELO_390_PAGE_LENGTHS } from "@/server/fiscal-files/modelo-390";

const company: Declarant = { taxId: "ES-B12345674", name: "Peñón & Hijos, S.L.", isIndividual: false };
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

// Año: 10.000 € al 21 % (2.100 €), compras 4.000 € (840 €), 300 € compensados del año anterior.
// Ingresado en los 303: 1.200 €; último periodo negativo: 240 € a compensar y 60 € más pendientes del año.
const boxes = {
  "05": 1_000_000, "06": 210_000, "33": 1_000_000, "34": 210_000, "47": 210_000,
  "605": 400_000, "606": 84_000, "48": 400_000, "49": 84_000, "64": 84_000, "65": 126_000,
  "84": 126_000, "85": 30_000, "86": 96_000, "95": 120_000, "97": 24_000, "662": 6_000,
  "99": 1_000_000, "103": 50_000, "108": 1_050_000,
};
const activity = { description: "Consultoría informática", code: "A03", iaeCode: "849.9" };
const lengths = MODELO_390_PAGE_LENGTHS;

describe("modelo 390", () => {
  const file = buildModelo390File({ declarant: company, year: 2026, boxes, activity, has347Operations: true, lastPeriodResult: "compensar" });
  let offset = 328;
  const take = (length: number) => {
    const page = file.text.slice(offset, offset + length);
    offset += length;
    return page;
  };
  const page1 = take(lengths.page1);
  const page2 = take(lengths.page2);
  const page2b = take(lengths.page2b);
  const page3 = take(lengths.page3);
  const page4 = take(lengths.page4);
  const page6 = take(lengths.page6);

  it("lleva cabecera, las páginas 01, 02, 02B, 03, 04 y 06 y el cierre", () => {
    expect(file.text.length).toBe(328 + lengths.page1 + lengths.page2 + lengths.page2b + lengths.page3 + lengths.page4 + lengths.page6 + 18);
    expect(at(file.text, 1, 17)).toBe("<T390020260A0000>");
    expect(file.text.endsWith("</T390020260A0000>")).toBe(true);
    for (const [page, code] of [[page1, "01000"], [page2, "02000"], [page2b, "02B00"], [page3, "03000"], [page4, "04000"], [page6, "06000"]] as const) {
      expect(at(page, 1, 11)).toBe(`<T390${code}>`);
      expect(page.endsWith(`</T390${code}>`)).toBe(true);
    }
    expect(file.fileName).toBe("390-2026.txt");
  });

  it("identifica al sujeto pasivo con la actividad principal y la marca del 347", () => {
    expect(at(page1, 14, 9)).toBe("B12345674");
    expect(at(page1, 23, 60).trim()).toBe("PEÑON HIJOS S L");
    expect(at(page1, 103, 4)).toBe("2026");
    expect(at(page1, 130, 4)).toBe("2222");
    expect(at(page1, 149, 40).trim()).toBe("CONSULTORIA INFORMATICA");
    expect(at(page1, 189, 7)).toBe("A038499");
    expect(at(page1, 431, 1)).toBe("1");
  });

  it("coloca el devengado, el deducible y el resultado del régimen general", () => {
    expect(at(page2, 217, 17)).toBe("00000000001000000");
    expect(at(page2, 234, 17)).toBe("00000000000210000");
    expect(at(page2, 13, 17)).toBe("0".repeat(17));
    expect(at(page2, 1611, 17)).toBe("00000000001000000");
    expect(at(page2b, 353, 17)).toBe("00000000000210000");
    expect(at(page3, 183, 17)).toBe("00000000000400000");
    expect(at(page3, 234, 17)).toBe("00000000000084000");
    expect(at(page4, 659, 17)).toBe("00000000000084000");
    expect(at(page4, 676, 17)).toBe("00000000000126000");
  });

  it("coloca 84, 85, 86, 95, 97, 98 y 662 y el volumen de operaciones en la página 06", () => {
    expect(at(page6, 30, 17)).toBe("00000000000126000");
    expect(at(page6, 64, 17)).toBe("00000000000030000");
    expect(at(page6, 98, 17)).toBe("00000000000096000");
    expect(at(page6, 115, 144)).toBe("0".repeat(144));
    expect(at(page6, 259, 17)).toBe("00000000000120000");
    expect(at(page6, 310, 17)).toBe("00000000000024000");
    expect(at(page6, 327, 17)).toBe("0".repeat(17));
    expect(at(page6, 344, 17)).toBe("00000000000006000");
    expect(at(page6, 395, 17)).toBe("00000000001000000");
    expect(at(page6, 429, 17)).toBe("00000000000050000");
    expect(at(page6, 684, 17)).toBe("00000000001050000");
  });

  it("pasa el resultado a la 98 si se pidió la devolución y pone la N de los negativos", () => {
    const negative = { ...boxes, "65": -84_000, "47": 0, "05": 0, "06": 0, "33": 0, "34": 0, "84": -84_000, "86": -114_000, "99": 0, "108": 50_000 };
    const refund = buildModelo390File({ declarant: company, year: 2026, boxes: negative, activity, lastPeriodResult: "devolver" });
    const page6b = refund.text.slice(328 + lengths.page1 + lengths.page2 + lengths.page2b + lengths.page3 + lengths.page4).slice(0, lengths.page6);
    expect(at(page6b, 30, 17)).toBe("N0000000000084000");
    expect(at(page6b, 98, 17)).toBe("N0000000000114000");
    expect(at(page6b, 310, 17)).toBe("0".repeat(17));
    expect(at(page6b, 327, 17)).toBe("00000000000024000");
  });

  it("añade la página 07 con el criterio de caja y la prorrata", () => {
    const withExtras = buildModelo390File({
      declarant: company, year: 2026, boxes: { ...boxes, "654": 200_000, "655": 42_000, "115": 1_050_000, "116": 840_000 }, activity, lastPeriodResult: "compensar",
      cashAccounting: { ownRegime: true, recipient: false }, prorrata: { cnae: "6201", pct: 80 },
    });
    expect(at(withExtras.text.slice(328), 131, 2)).toBe("12");
    const page7 = withExtras.text.slice(-18 - lengths.page7, -18);
    expect(at(page7, 1, 11)).toBe("<T39007000>");
    expect(at(page7, 132, 17)).toBe("00000000000200000");
    expect(at(page7, 149, 17)).toBe("00000000000042000");
    expect(at(page7, 200, 40).trim()).toBe("CONSULTORIA INFORMATICA");
    expect(at(page7, 240, 4)).toBe("6201");
    expect(at(page7, 244, 17)).toBe("00000000001050000");
    expect(at(page7, 261, 17)).toBe("00000000000840000");
    expect(at(page7, 278, 6)).toBe("G08000");
    expect(at(page7, 284, 40)).toBe(" ".repeat(40));
    expect(at(page7, 328, 34)).toBe("0".repeat(34));
  });

  it("pide los datos que el programa no guarda", () => {
    const problems = problemsOf(() => buildModelo390File({ declarant: company, year: 2026, boxes, activity: { description: "", code: "X" } })).join(" ");
    expect(problems).toMatch(/descripción de la actividad/);
    expect(problems).toMatch(/código de la actividad/);
    expect(problems).toMatch(/compensar \(casilla 97\)/);
    expect(problemsOf(() => buildModelo390File({ declarant: company, year: 2026, boxes: { ...boxes, "115": 1, "116": 1 }, activity, lastPeriodResult: "compensar", prorrata: { cnae: "", pct: 80 } })).join(" ")).toMatch(/CNAE/);
    expect(problemsOf(() => buildModelo390File({ declarant: company, year: 2026, boxes: { ...boxes, "115": 1 }, activity, lastPeriodResult: "compensar" })).join(" ")).toMatch(/porcentaje definitivo/);
    expect(problemsOf(() => buildModelo390File({ declarant: company, year: 2026, boxes, activity: { ...activity, iaeCode: "" }, lastPeriodResult: "compensar" })).join(" ")).toMatch(/epígrafe/);
  });

  it("no genera el fichero si no cuadra, hay tipos sin casilla, casillas ajenas o el ejercicio es anterior", () => {
    const run = (extra: Record<string, number>, year = 2026) => problemsOf(() => buildModelo390File({ declarant: company, year, boxes: { ...boxes, ...extra }, activity, lastPeriodResult: "compensar" })).join(" ");
    expect(run({ "65": 1 })).toMatch(/casilla 65/);
    expect(run({ "86": 1 })).toMatch(/casilla 86/);
    expect(run({ "108": 1 })).toMatch(/casilla 108/);
    expect(run({ REV: 100 })).toMatch(/Revisar/);
    expect(run({ "668": 100 })).toMatch(/sin vigencia/);
    expect(run({ "9999": 100 })).toMatch(/no existe/);
    expect(run({ "85": -1, "86": 126_001 })).toMatch(/negativ/);
    expect(run({}, 2025)).toMatch(/2026 en adelante/);
  });
});
