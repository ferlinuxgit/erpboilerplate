import { describe, expect, it } from "vitest";

import { buildCreditorId } from "@/lib/bank-import/sepa-creditor";
import { buildPain008, PAIN008_NAMESPACE, validatePain008Input, type Pain008Input } from "@/server/sepa/pain008";

const creditorId = buildCreditorId("B12345678");

function input(overrides: Partial<Pain008Input> = {}): Pain008Input {
  return {
    messageId: "ADE20260925120000ABCD",
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
    collectionDate: new Date("2026-10-01T00:00:00.000Z"),
    creditor: { name: "Talleres Núñez, S.L.", creditorId, iban: "ES9121000418450200051332", bic: "CAIXESBBXXX" },
    debits: [
      { endToEndId: "ADE-1", amount: 121, sequenceType: "FRST", mandateReference: "MDT-001", mandateSignatureDate: new Date("2026-01-15T00:00:00.000Z"), debtorName: "Cliente Uno & Cía", debtorIban: "ES7921000813610123456789", remittanceInformation: "Factura F-2026-0001" },
      { endToEndId: "ADE-2", amount: 60.5, sequenceType: "RCUR", mandateReference: "MDT-002", mandateSignatureDate: new Date("2025-03-01T00:00:00.000Z"), debtorName: "Cliente Dos", debtorIban: "ES6000491500051234567892", debtorBic: "BSCHESMMXXX", remittanceInformation: "Factura F-2026-0002" },
      { endToEndId: "ADE-3", amount: 10, sequenceType: "RCUR", mandateReference: "MDT-003", mandateSignatureDate: new Date("2025-03-01T00:00:00.000Z"), debtorName: "Cliente Tres", debtorIban: "ES6000491500051234567892", remittanceInformation: "Factura F-2026-0003" },
    ],
    ...overrides,
  };
}

function count(xml: string, tag: string) {
  return (xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
}

describe("pain.008.001.02 (adeudos SEPA CORE)", () => {
  it("genera la cabecera con totales y el acreedor como iniciador", () => {
    const xml = buildPain008(input());
    expect(xml).toContain(`<Document xmlns="${PAIN008_NAMESPACE}"`);
    expect(xml).toContain("<CstmrDrctDbtInitn>");
    expect(xml).toMatch(/<GrpHdr>[\s\S]*<NbOfTxs>3<\/NbOfTxs>[\s\S]*<CtrlSum>191\.50<\/CtrlSum>[\s\S]*<\/GrpHdr>/);
    expect(xml).toContain(`<Id>${creditorId}</Id>`);
  });

  it("agrupa un PmtInf por secuencia con CORE, fecha de cobro e identificador de acreedor", () => {
    const xml = buildPain008(input());
    expect(count(xml, "PmtInf")).toBe(2);
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
    expect(xml).toContain("<SeqTp>RCUR</SeqTp>");
    expect((xml.match(/<Cd>CORE<\/Cd>/g) ?? []).length).toBe(2);
    expect((xml.match(/<ReqdColltnDt>2026-10-01<\/ReqdColltnDt>/g) ?? []).length).toBe(2);
    expect(xml).toMatch(/<PmtInfId>ADE20260925120000ABCD-RCUR<\/PmtInfId>\s*<PmtMtd>DD<\/PmtMtd>\s*<BtchBookg>true<\/BtchBookg>\s*<NbOfTxs>2<\/NbOfTxs>\s*<CtrlSum>70\.50<\/CtrlSum>/);
    expect(xml).toMatch(/<CdtrSchmeId>[\s\S]*<Prtry>SEPA<\/Prtry>[\s\S]*<\/CdtrSchmeId>/);
    expect(count(xml, "DrctDbtTxInf")).toBe(3);
  });

  it("incluye mandato, deudor y concepto; sin BIC usa NOTPROVIDED y limpia caracteres no SEPA", () => {
    const xml = buildPain008(input());
    expect(xml).toMatch(/<MndtId>MDT-001<\/MndtId>\s*<DtOfSgntr>2026-01-15<\/DtOfSgntr>/);
    expect(xml).toContain('<InstdAmt Ccy="EUR">121.00</InstdAmt>');
    expect(xml).toContain("<IBAN>ES7921000813610123456789</IBAN>");
    expect(xml).toContain("<BIC>BSCHESMMXXX</BIC>");
    expect(xml).toContain("<Id>NOTPROVIDED</Id>");
    expect(xml).toContain("<Nm>Talleres Nunez, S.L.</Nm>");
    expect(xml).toContain("<Nm>Cliente Uno Cia</Nm>");
    expect(xml).toContain("<Ustrd>Factura F-2026-0001</Ustrd>");
  });

  it("rechaza datos que el banco no aceptaría", () => {
    const errors = validatePain008Input(input({
      creditor: { name: "Empresa", creditorId: "ES00000B12345678", iban: "ES00123", bic: null },
      debits: [{ endToEndId: "X", amount: 0, sequenceType: "RCUR", mandateReference: "", mandateSignatureDate: new Date("2027-01-01T00:00:00.000Z"), debtorName: "A", debtorIban: "ES9121000418450200051333", remittanceInformation: "x" }],
    }));
    expect(errors.join(" ")).toMatch(/acreedor SEPA/);
    expect(errors.join(" ")).toMatch(/cuenta de abono/);
    expect(errors.join(" ")).toMatch(/mayor que 0/);
    expect(errors.join(" ")).toMatch(/referencia del mandato/);
    expect(errors.join(" ")).toMatch(/después de la fecha de cobro/);
    expect(errors.join(" ")).toMatch(/dígitos de control/);
    expect(() => buildPain008(input({ debits: [] }))).toThrow();
  });
});
