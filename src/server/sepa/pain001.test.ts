import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import { PAIN001_NAMESPACE, buildPain001, sepaText, validatePain001Input, type Pain001Input } from "@/server/sepa/pain001";

const input: Pain001Input = {
  messageId: "REM20260925103000ABCD",
  createdAt: new Date("2026-09-25T10:30:00.000Z"),
  executionDate: new Date("2026-09-28T00:00:00.000Z"),
  debtor: { name: "Empresa Demo, S.L.", taxId: "B12345678", iban: "ES91 2100 0418 4502 0005 1332", bic: "CAIXESBBXXX" },
  transfers: [
    { endToEndId: "REM20260925103000ABCD-1", amount: 1210, creditorName: "Transportes García & Hijos", creditorIban: "ES7620770024003102575766", creditorBic: null, remittanceInformation: "Factura A/123" },
    { endToEndId: "REM20260925103000ABCD-2", amount: 99.99, creditorName: "Papelería Ñandú", creditorIban: "DE89 3704 0044 0532 0130 00", creditorBic: "COBADEFFXXX", remittanceInformation: "Factura 2026-77" },
  ],
};

function parse(xml: string) {
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false }).parse(xml);
}

describe("SEPA credit transfer pain.001.001.03", () => {
  it("builds the ISO 20022 structure with header and payment information totals", () => {
    const xml = buildPain001(input);
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true);
    const document = parse(xml).Document;
    expect(document["@xmlns"]).toBe(PAIN001_NAMESPACE);
    const initiation = document.CstmrCdtTrfInitn;
    expect(initiation.GrpHdr).toMatchObject({ MsgId: input.messageId, CreDtTm: "2026-09-25T10:30:00", NbOfTxs: "2", CtrlSum: "1309.99" });
    expect(initiation.GrpHdr.InitgPty.Nm).toBe("Empresa Demo, S.L.");
    expect(initiation.GrpHdr.InitgPty.Id.OrgId.Othr.Id).toBe("B12345678");

    const info = initiation.PmtInf;
    expect(info).toMatchObject({ PmtMtd: "TRF", BtchBookg: "true", NbOfTxs: "2", CtrlSum: "1309.99", ReqdExctnDt: "2026-09-28", ChrgBr: "SLEV" });
    expect(info.PmtTpInf.SvcLvl.Cd).toBe("SEPA");
    expect(info.DbtrAcct.Id.IBAN).toBe("ES9121000418450200051332");
    expect(info.DbtrAcct.Ccy).toBe("EUR");
    expect(info.DbtrAgt.FinInstnId.BIC).toBe("CAIXESBBXXX");

    const [first, second] = info.CdtTrfTxInf;
    expect(first.PmtId.EndToEndId).toBe("REM20260925103000ABCD-1");
    expect(first.Amt.InstdAmt).toEqual({ "#text": "1210.00", "@Ccy": "EUR" });
    expect(first.CdtrAgt).toBeUndefined();
    expect(first.Cdtr.Nm).toBe("Transportes Garcia Hijos");
    expect(first.CdtrAcct.Id.IBAN).toBe("ES7620770024003102575766");
    expect(first.RmtInf.Ustrd).toBe("Factura A/123");
    expect(second.CdtrAgt.FinInstnId.BIC).toBe("COBADEFFXXX");
    expect(second.Cdtr.Nm).toBe("Papeleria Nandu");
    expect(second.Amt.InstdAmt["#text"]).toBe("99.99");
  });

  it("keeps the element order required by the XSD", () => {
    const xml = buildPain001(input);
    const order = ["<PmtInfId>", "<PmtMtd>", "<BtchBookg>", "<NbOfTxs>", "<CtrlSum>", "<PmtTpInf>", "<ReqdExctnDt>", "<Dbtr>", "<DbtrAcct>", "<DbtrAgt>", "<ChrgBr>", "<CdtTrfTxInf>"];
    const section = xml.slice(xml.indexOf("<PmtInf>"));
    const positions = order.map((tag) => section.indexOf(tag));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const transaction = section.slice(section.indexOf("<CdtTrfTxInf>"));
    const txOrder = ["<PmtId>", "<Amt>", "<Cdtr>", "<CdtrAcct>", "<RmtInf>"].map((tag) => transaction.indexOf(tag));
    expect([...txOrder].sort((a, b) => a - b)).toEqual(txOrder);
  });

  it("uses NOTPROVIDED when the debtor BIC is unknown", () => {
    const document = parse(buildPain001({ ...input, debtor: { ...input.debtor, bic: null } })).Document;
    expect(document.CstmrCdtTrfInitn.PmtInf.DbtrAgt.FinInstnId.Othr.Id).toBe("NOTPROVIDED");
  });

  it("validates IBANs, amounts and duplicated references before generating", () => {
    const errors = validatePain001Input({
      ...input,
      debtor: { ...input.debtor, iban: "ES12 3456 7890 1234 5678 9012" },
      transfers: [
        { ...input.transfers[0], creditorIban: "ES7620770024003102575767" },
        { ...input.transfers[1], amount: 0, endToEndId: input.transfers[0].endToEndId },
      ],
    });
    expect(errors.join(" ")).toMatch(/cuenta de cargo/);
    expect(errors.join(" ")).toMatch(/dígitos de control/);
    expect(errors.join(" ")).toMatch(/mayor que 0/);
    expect(errors.join(" ")).toMatch(/referencia repetida/);
    expect(() => buildPain001({ ...input, transfers: [] })).toThrow(/al menos una factura/);
  });

  it("restricts free text to the SEPA character set", () => {
    expect(sepaText("Café & Té <S.L.> «ñ»", 70)).toBe("Cafe Te S.L. n");
    expect(sepaText("x".repeat(200), 140)).toHaveLength(140);
  });
});
