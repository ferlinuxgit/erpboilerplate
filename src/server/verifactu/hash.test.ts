import { describe, expect, it } from "vitest";

import { formatAeatAmount, formatAeatDate, formatAeatDateTime, isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";
import {
  buildAltaHashInput,
  buildAnulacionHashInput,
  canonicalJson,
  computeAltaHash,
  computeAnulacionHash,
  computeEventHash,
  recomputeRecordHash,
} from "@/server/verifactu/hash";

/**
 * Ejemplos oficiales de la AEAT: "Especificaciones técnicas para la generación de la huella o hash
 * de los registros de facturación" (Sistemas Informáticos de Facturación y VERI*FACTU, v0.1.2,
 * apartado 6 "Ejemplos"). Emisor de pruebas 89890001K, facturas 12345678/G33 y 12345679/G34.
 */
const AEAT_FIRST_ALTA = {
  issuerTaxId: "89890001K",
  invoiceNumber: "12345678/G33",
  invoiceIssueDate: "01-01-2024",
  invoiceTypeCode: "F1",
  taxAmount: "12.35",
  totalAmount: "123.45",
  previousHash: null,
  generatedAtText: "2024-01-01T19:20:30+01:00",
};
const AEAT_FIRST_ALTA_HASH = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

const AEAT_SECOND_ALTA = {
  issuerTaxId: "89890001K",
  invoiceNumber: "12345679/G34",
  invoiceIssueDate: "01-01-2024",
  invoiceTypeCode: "F1",
  taxAmount: "12.35",
  totalAmount: "123.45",
  previousHash: AEAT_FIRST_ALTA_HASH,
  generatedAtText: "2024-01-01T19:20:35+01:00",
};
const AEAT_SECOND_ALTA_HASH = "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97";

const AEAT_ANULACION = {
  issuerTaxId: "89890001K",
  invoiceNumber: "12345679/G34",
  invoiceIssueDate: "01-01-2024",
  previousHash: AEAT_SECOND_ALTA_HASH,
  generatedAtText: "2024-01-01T19:20:40+01:00",
};
const AEAT_ANULACION_HASH = "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68";

describe("VeriFactu huella (AEAT examples)", () => {
  it("builds the concatenated string exactly as documented for the first alta record (empty Huella)", () => {
    expect(buildAltaHashInput(AEAT_FIRST_ALTA)).toBe(
      "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00",
    );
  });

  it("matches the AEAT hash of the first alta record", () => {
    expect(computeAltaHash(AEAT_FIRST_ALTA)).toBe(AEAT_FIRST_ALTA_HASH);
  });

  it("matches the AEAT hash of the chained second alta record", () => {
    expect(computeAltaHash(AEAT_SECOND_ALTA)).toBe(AEAT_SECOND_ALTA_HASH);
  });

  it("matches the AEAT hash of the anulación record", () => {
    expect(buildAnulacionHashInput(AEAT_ANULACION)).toBe(
      `IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34&FechaExpedicionFacturaAnulada=01-01-2024&Huella=${AEAT_SECOND_ALTA_HASH}&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00`,
    );
    expect(computeAnulacionHash(AEAT_ANULACION)).toBe(AEAT_ANULACION_HASH);
  });

  it("trims leading and trailing spaces of every value", () => {
    expect(computeAltaHash({ ...AEAT_FIRST_ALTA, invoiceNumber: "  12345678/G33 ", issuerTaxId: " 89890001K" })).toBe(AEAT_FIRST_ALTA_HASH);
  });

  it("changes when any hashed field changes (amount format is significant)", () => {
    expect(computeAltaHash({ ...AEAT_FIRST_ALTA, totalAmount: "123.450" })).not.toBe(AEAT_FIRST_ALTA_HASH);
    expect(computeAltaHash({ ...AEAT_FIRST_ALTA, invoiceTypeCode: "F2" })).not.toBe(AEAT_FIRST_ALTA_HASH);
  });

  it("recomputes stored records of both types", () => {
    expect(recomputeRecordHash({ recordType: "ALTA", ...AEAT_SECOND_ALTA })).toBe(AEAT_SECOND_ALTA_HASH);
    expect(recomputeRecordHash({ recordType: "ANULACION", ...AEAT_ANULACION, invoiceTypeCode: null, taxAmount: null, totalAmount: null })).toBe(AEAT_ANULACION_HASH);
  });
});

describe("VeriFactu formats", () => {
  it("formats the issue date as dd-mm-yyyy in Spain", () => {
    expect(formatAeatDate(new Date("2024-01-01T00:00:00Z"))).toBe("01-01-2024");
    // Medianoche peninsular guardada en UTC (día anterior 23:00Z) sigue siendo el mismo día en España.
    expect(formatAeatDate(new Date("2024-06-30T22:00:00Z"))).toBe("01-07-2024");
  });

  it("formats FechaHoraHusoGenRegistro with seconds and offset (winter/summer)", () => {
    expect(formatAeatDateTime(new Date("2024-01-01T18:20:30Z"))).toBe("2024-01-01T19:20:30+01:00");
    expect(formatAeatDateTime(new Date("2024-07-15T10:00:05.900Z"))).toBe("2024-07-15T12:00:05+02:00");
  });

  it("formats amounts with dot and two decimals", () => {
    expect(formatAeatAmount(123.45)).toBe("123.45");
    expect(formatAeatAmount(100)).toBe("100.00");
    expect(formatAeatAmount(-12.3)).toBe("-12.30");
    expect(formatAeatAmount(-0.001)).toBe("0.00");
  });

  it("normalizes and validates the issuer NIF", () => {
    expect(normalizeIssuerNif("es b-12345678")).toBe("B12345678");
    expect(isValidIssuerNifFormat("B12345678")).toBe(true);
    expect(isValidIssuerNifFormat("")).toBe(false);
    expect(isValidIssuerNifFormat("123")).toBe(false);
  });
});

describe("event hash", () => {
  it("is stable regardless of payload key order (jsonb reorders keys)", () => {
    const base = { companyId: "c1", sequence: 1, eventType: "EXPORT", description: "x", previousHash: null, generatedAtText: "2024-01-01T19:20:30+01:00" };
    expect(computeEventHash({ ...base, payload: { b: 1, a: [{ y: 2, x: 1 }] } })).toBe(computeEventHash({ ...base, payload: { a: [{ x: 1, y: 2 }], b: 1 } }));
    expect(canonicalJson({ b: 1, a: undefined, c: null })).toBe('{"b":1,"c":null}');
  });
});
