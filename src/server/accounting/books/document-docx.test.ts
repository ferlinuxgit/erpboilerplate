import { XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildCashFlowStatement } from "@/server/accounting/annual-accounts/cash-flow-model";
import { annualAccountsDocument, annualAccountsNotesDocument, type AnnualAccountsDocumentInput } from "@/server/accounting/annual-accounts/documents";
import { buildEquityChangesStatement } from "@/server/accounting/annual-accounts/equity-changes-model";
import { fixedAssetTables } from "@/server/accounting/annual-accounts/notes-model";
import { renderDocumentDocx } from "@/server/accounting/books/document-docx";
import { buildOfficialStatements, officialStatementModelInfo, type OfficialStatementModelId } from "@/server/accounting/official-statements-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";

function row(code: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

const rows = [
  row("10000000", { priorCents: -300_000 }),
  row("57200001", { priorCents: 300_000, debitCents: 100_000 }),
  row("70000000", { creditCents: 100_000, yearToDateCents: -100_000 }),
];

function input(model: OfficialStatementModelId): AnnualAccountsDocumentInput {
  return {
    company: { name: "Ejemplo & Hijos, S.L.", taxId: "B12345678" },
    year: { code: "2026", endsAt: new Date(Date.UTC(2026, 11, 31)) },
    previousYear: null,
    modelInfo: officialStatementModelInfo(model),
    statements: buildOfficialStatements(rows, null, model),
    equityChanges: buildEquityChangesStatement({ label: "2026", opening: [{ code: "10000000", cents: 300_000 }], pendingPriorResultCents: 0, yearResultCents: 100_000, entries: [] }, null, model),
    recognizedIncome: null,
    cashFlow: buildCashFlowStatement(rows),
    cashFlowRequired: model === "normal",
    notes: [
      { title: "1. Actividad de la empresa", text: "La sociedad <S.L.> se dedica a…\nSegundo párrafo.", tables: [] },
      { title: "4. Inmovilizado", text: "Cuadro:", tables: fixedAssetTables(rows) },
    ],
  };
}

const generatedAt = new Date(Date.UTC(2027, 0, 15, 9, 30));

function open(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  return { names: Object.keys(files).sort(), text: (name: string) => strFromU8(files[name]) };
}

describe("exportación a Word (.docx)", () => {
  it("es un ZIP con las partes obligatorias y XML bien formado", () => {
    const docx = open(renderDocumentDocx(annualAccountsDocument(input("normal")), generatedAt));
    expect(docx.names).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
    for (const name of docx.names) expect(XMLValidator.validate(docx.text(name)), name).toBe(true);
    expect(docx.text("[Content_Types].xml")).toContain('PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"');
    expect(docx.text("_rels/.rels")).toContain('Target="word/document.xml"');
    expect(docx.text("word/_rels/document.xml.rels")).toContain('Target="styles.xml"');
    expect(docx.text("docProps/core.xml")).toContain("2027-01-15T09:30:00Z");
  });

  it("lleva títulos, párrafos y tablas con importes en formato español", () => {
    const body = open(renderDocumentDocx(annualAccountsDocument(input("normal")), generatedAt)).text("word/document.xml");
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain("Ejemplo &amp; Hijos, S.L.");
    expect(body).toContain("La sociedad &lt;S.L.&gt; se dedica a…");
    expect(body).toContain("Estado de flujos de efectivo del ejercicio terminado el 31/12/2026");
    expect(body).toContain("<w:tblHeader/>");
    expect(body).toContain(">4.000,00<");
    // Apaisado, como el PDF.
    expect(body).toContain('w:orient="landscape"');
    expect((body.match(/<w:tbl>/g) ?? []).length).toBe((body.match(/<\/w:tbl>/g) ?? []).length);
  });

  it("la memoria sola no trae los estados y el resultado es estable", () => {
    const document = annualAccountsNotesDocument(input("abbreviated"));
    expect(document.sections.map((section) => section.heading)).toEqual(["Memoria del ejercicio 2026 — 1. Actividad de la empresa", "4. Inmovilizado"]);
    const first = renderDocumentDocx(document, generatedAt);
    expect(renderDocumentDocx(document, generatedAt)).toEqual(first);
    const body = open(first).text("word/document.xml");
    expect(body).not.toContain("Balance al cierre");
    expect(body).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });
});

describe("estado de flujos de efectivo en las cuentas anuales", () => {
  it("va con el modelo normal y, con los demás, solo si se pide", () => {
    const sheets = (model: OfficialStatementModelId, includeCashFlow?: boolean) => annualAccountsDocument(input(model), { includeCashFlow }).sections.map((section) => section.sheetName);
    expect(sheets("normal")).toContain("Flujos de efectivo");
    expect(sheets("abbreviated")).not.toContain("Flujos de efectivo");
    expect(sheets("pymes", true)).toContain("Flujos de efectivo");
    const section = annualAccountsDocument(input("pymes"), { includeCashFlow: true }).sections.find((item) => item.sheetName === "Flujos de efectivo");
    expect(section?.paragraphs?.join(" ")).toContain("voluntario");
    expect(section?.paragraphs?.join(" ")).toContain("1.000,00 €");
  });
});
