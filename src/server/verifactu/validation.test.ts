import { describe, expect, it } from "vitest";

import {
  assertAltaContentSendable,
  assertVerifactuSeriesNumber,
  invalidSeriesNumberCharacters,
  isValidVerifactuSeriesNumber,
  subsanacionBlockFor,
} from "@/server/verifactu/validation";

describe("VeriFactu · NumSerieFactura", () => {
  it("accepts printable ASCII except the characters the AEAT forbids", () => {
    for (const number of ["FA000001", "2026/A-0001", "R-000001", "T 12.345_B", "A&B#1"]) {
      expect(isValidVerifactuSeriesNumber(number)).toBe(true);
      expect(() => assertVerifactuSeriesNumber(number)).not.toThrow();
    }
  });

  it("rejects quotes, <, >, = and anything outside ASCII 32-126, naming the offending characters", () => {
    expect(invalidSeriesNumberCharacters(`F"1'<2>=3`)).toEqual(['"', "'", "<", ">", "="]);
    expect(invalidSeriesNumberCharacters("FÁC-ñ€")).toEqual(["Á", "ñ", "€"]);
    expect(invalidSeriesNumberCharacters("F\t1")).toEqual(["\t"]);
    for (const number of ["FÁC-1", "Año-2026/1", 'F"1', "F=1", "F<1>", "F 1", "FAC—1"]) {
      expect(isValidVerifactuSeriesNumber(number)).toBe(false);
      expect(() => assertVerifactuSeriesNumber(number)).toThrowError(expect.objectContaining({ status: 422 }));
    }
    expect(() => assertVerifactuSeriesNumber("FÁC-1")).toThrow(/«Á»/);
  });

  it("rejects empty numbers and numbers longer than 60 characters", () => {
    expect(() => assertVerifactuSeriesNumber("   ")).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => assertVerifactuSeriesNumber("F".repeat(60))).not.toThrow();
    expect(() => assertVerifactuSeriesNumber("F".repeat(61))).toThrow(/más de 60 caracteres/);
  });
});

describe("VeriFactu · coherencia del alta antes de emitir", () => {
  const general = { Impuesto: "01", ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21.00", BaseImponibleOimporteNoSujeto: "100.00", CuotaRepercutida: "21.00" };
  const exempt = (code: string, regime = "01") => ({ Impuesto: "01", ClaveRegimen: regime, OperacionExenta: code, BaseImponibleOimporteNoSujeto: "100.00" });
  const spanish = { name: "Cliente", taxId: "B87654321", countryCode: "ES", idType: null };
  const french = { name: "Client", taxId: "FR12345678901", countryCode: "FR", idType: "02" };

  it("accepts an operation date equal to or before the issue date and rejects a later one", () => {
    expect(() => assertAltaContentSendable({ breakdown: [general], recipient: spanish, operationDate: null }, "06-09-2026")).not.toThrow();
    expect(() => assertAltaContentSendable({ breakdown: [general], recipient: spanish, operationDate: "28-08-2026" }, "06-09-2026")).not.toThrow();
    expect(() => assertAltaContentSendable({ breakdown: [general], recipient: spanish, operationDate: "06-09-2026" }, "06-09-2026")).not.toThrow();
    // Compara fechas, no textos: 01-10 es posterior a 30-09 aunque «01» < «30».
    expect(() => assertAltaContentSendable({ breakdown: [general], recipient: spanish, operationDate: "01-10-2026" }, "30-09-2026")).toThrow(/posterior a la fecha de expedición/);
    expect(() => assertAltaContentSendable({ breakdown: [general], recipient: spanish, operationDate: "01-01-2000" }, "30-09-2026")).toThrow(/veinte años/);
  });

  it("rejects E2/E3 with the general regime key and allows them for exports", () => {
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E1")], recipient: spanish }, "06-09-2026")).not.toThrow();
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E2")], recipient: spanish }, "06-09-2026")).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E3")], recipient: null }, "06-09-2026")).toThrow(/E3/);
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E2", "02")], recipient: french }, "06-09-2026")).not.toThrow();
  });

  it("requires a foreign-identified recipient for E5 (intra-community supply)", () => {
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E5")], recipient: french }, "06-09-2026")).not.toThrow();
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E5")], recipient: spanish }, "06-09-2026")).toThrow(/E5/);
    // Sin bloque Destinatario la regla no aplica (la AEAT solo la exige «cuando se cumplimente»).
    expect(() => assertAltaContentSendable({ breakdown: [exempt("E5")], recipient: null }, "06-09-2026")).not.toThrow();
  });
});

describe("VeriFactu · cuándo no procede subsanar", () => {
  it("does not offer a subsanación for 2004 and 2009", () => {
    expect(subsanacionBlockFor({ code: "2004" })).toMatchObject({ kind: "not-subsanable" });
    expect(subsanacionBlockFor({ code: "2009", message: "Si el campo Impuesto tiene valor IPSI(02)…" })).toMatchObject({ kind: "not-subsanable" });
  });

  it("sends recipient identification errors to a rectifying invoice", () => {
    expect(subsanacionBlockFor({ code: "2001", message: "El NIF del bloque Destinatarios no está identificado en el censo de la AEAT." })).toMatchObject({ kind: "recipient" });
    expect(subsanacionBlockFor({ code: "1283", message: "Si el NIF de la contraparte es persona fisica se debe informar tambien de su NombreRazon" })?.message).toContain("factura rectificativa");
    // Aunque el código no esté en la lista, el texto de la AEAT lo delata.
    expect(subsanacionBlockFor({ code: "9999", message: "Error en el bloque Destinatario." })).toMatchObject({ kind: "recipient" });
  });

  it("allows it for everything else", () => {
    expect(subsanacionBlockFor({ code: "1100", message: "Valor o tipo incorrecto del campo." })).toBeNull();
    expect(subsanacionBlockFor({ code: "SOAP", message: "Codigo[4102].El XML no cumple el esquema" })).toBeNull();
    expect(subsanacionBlockFor({ code: null, message: null })).toBeNull();
  });
});
