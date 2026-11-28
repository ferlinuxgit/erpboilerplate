import { describe, expect, it } from "vitest";

import { buildSpfeStatusMessage, spfeStatusMessageProblems, type SpfeStatusMessageInput } from "@/server/einvoice/application-response";

const invoice = { number: "F2026-000012", issueDate: "2026-11-20", issuerTaxId: "B12345674", issuerName: "Talleres Norte, S.L.", payableAmount: 242 };
const message = (overrides: Partial<SpfeStatusMessageInput>): SpfeStatusMessageInput => ({ code: "SETTLEMENT", messageId: "SETTLEMENT-20261201-1", messageDate: "2026-12-01", effectiveDate: "2026-11-30", invoice, ...overrides });

describe("mensajes de estado UBL ApplicationResponse (anexo II de la Orden HAC/1028/2026)", () => {
  it("cobro del emisor como en el ejemplo oficial Cobrada.xml", () => {
    const { xml, fileName } = buildSpfeStatusMessage(message({ dueDate: "2026-12-20", financingArrangement: true }));
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
      + "<cbc:ID>SETTLEMENT-20261201-1</cbc:ID><cbc:IssueDate>2026-12-01</cbc:IssueDate><cac:SenderParty></cac:SenderParty><cac:ReceiverParty></cac:ReceiverParty>"
      + "<cac:DocumentResponse><cac:Response><cbc:ResponseCode>SETTLEMENT</cbc:ResponseCode><cbc:EffectiveDate>2026-11-30</cbc:EffectiveDate>"
      + "<cac:Status><cbc:ReferenceDate>2026-12-20</cbc:ReferenceDate><cac:Condition><cbc:AttributeID>DueDate</cbc:AttributeID></cac:Condition></cac:Status>"
      + "<cac:Status><cac:Condition><cbc:AttributeID>FinancingArrangement</cbc:AttributeID></cac:Condition></cac:Status></cac:Response>"
      + "<cac:DocumentReference><cbc:ID>F2026-000012</cbc:ID><cbc:IssueDate>2026-11-20</cbc:IssueDate><cbc:DocumentType>Invoice</cbc:DocumentType>"
      + "<cac:IssuerParty><cac:PartyTaxScheme><cbc:CompanyID>B12345674</cbc:CompanyID><cac:TaxScheme></cac:TaxScheme></cac:PartyTaxScheme>"
      + "<cac:PartyLegalEntity><cbc:RegistrationName>Talleres Norte, S.L.</cbc:RegistrationName></cac:PartyLegalEntity></cac:IssuerParty></cac:DocumentReference>"
      + "</cac:DocumentResponse></ApplicationResponse>",
    );
    expect(fileName).toBe("F2026-000012-settlement-2026-12-01.xml");
  });

  it("rechazo del destinatario con el motivo de la lista L1", () => {
    const { xml } = buildSpfeStatusMessage(message({ code: "REJECTION", effectiveDate: "2026-11-23", rejectionCode: "02" }));
    expect(xml).toContain("<cbc:ResponseCode>REJECTION</cbc:ResponseCode><cbc:EffectiveDate>2026-11-23</cbc:EffectiveDate><cac:Status><cbc:ConditionCode>02</cbc:ConditionCode></cac:Status>");
    expect(spfeStatusMessageProblems(message({ code: "REJECTION", effectiveDate: "2026-11-23" })).join(" ")).toContain("motivo del rechazo");
    expect(spfeStatusMessageProblems(message({ code: "REJECTION", effectiveDate: "2026-11-20", rejectionCode: "01" })).join(" ")).toContain("BR-RECHAZO-3");
  });

  it("pago del destinatario: exige el vencimiento y marca la rectificativa negativa", () => {
    expect(spfeStatusMessageProblems(message({ code: "PAYMENT" })).join(" ")).toContain("BR-PAGO-3");
    const { xml } = buildSpfeStatusMessage(message({ code: "PAYMENT", dueDate: "2026-12-20", invoice: { ...invoice, payableAmount: null, isCreditNote: true } }));
    expect(xml).toContain("<cbc:AttributeID>DueDate</cbc:AttributeID>");
    expect(xml).toContain("<cbc:StatusReason>NegativeAmountInvoice</cbc:StatusReason>");
  });

  it("bajas: solo la factura informada, sin fecha de efecto", () => {
    const { xml } = buildSpfeStatusMessage(message({ code: "CANCELSETTLEMENT", effectiveDate: null }));
    expect(xml).toContain("<cac:Response><cbc:ResponseCode>CANCELSETTLEMENT</cbc:ResponseCode></cac:Response>");
  });

  it("reglas: fecha no posterior al mensaje, importe no negativo y factura completa", () => {
    expect(spfeStatusMessageProblems(message({ effectiveDate: "2026-12-02" })).join(" ")).toContain("no puede ser posterior");
    expect(spfeStatusMessageProblems(message({ invoice: { ...invoice, payableAmount: -10 } })).join(" ")).toContain("importe a pagar negativo");
    expect(spfeStatusMessageProblems(message({ invoice: { ...invoice, issuerTaxId: "" } })).join(" ")).toContain("NIF del emisor");
    expect(spfeStatusMessageProblems(message({ receptionDate: "2026-11-19" })).join(" ")).toContain("recepción");
    expect(() => buildSpfeStatusMessage(message({ effectiveDate: null }))).toThrow("fecha del cobro");
    expect(spfeStatusMessageProblems(message({}))).toEqual([]);
  });
});
