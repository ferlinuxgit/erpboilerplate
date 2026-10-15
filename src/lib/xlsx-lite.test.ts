import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildXlsx, columnName } from "@/lib/xlsx-lite";

async function read(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

describe("xlsx-lite", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 51, 701].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "ZZ"]);
  });

  it("writes a workbook Excel can read: text, numbers as numbers and escaped characters", async () => {
    const workbook = await read(buildXlsx([
      ["Número", "Cliente", "Base", "IVA"],
      ["F-2026/0001", "Ñandú & <Hijos> \"SL\"", 100, 21],
      ["F-2026/0002", "", -50.5, null],
    ], "Facturas emitidas"));
    const sheet = workbook.getWorksheet("Facturas emitidas")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "Número", "Cliente", "Base", "IVA"]);
    expect(sheet.getRow(2).getCell(2).value).toBe("Ñandú & <Hijos> \"SL\"");
    expect(sheet.getRow(2).getCell(3).value).toBe(100);
    expect(sheet.getRow(3).getCell(3).value).toBe(-50.5);
    expect(sheet.getRow(3).getCell(4).value).toBeNull();
    expect(sheet.getRow(2).getCell(3).numFmt).toBe("#,##0.00");
  });
});
