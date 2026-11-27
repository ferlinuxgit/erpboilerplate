import type { EquityChangesStatement, RecognizedIncomeLine } from "@/server/accounting/annual-accounts/equity-changes-model";
import type { NoteTable } from "@/server/accounting/annual-accounts/notes-model";
import type { BookDocument, DocSection, DocTable } from "@/server/accounting/books/document";
import type { OfficialStatementLine, OfficialStatements } from "@/server/accounting/official-statements-model";

/** Cuentas anuales como documento (secciones para PDF y XLSX). Funciones puras. */

export type AnnualAccountsDocumentInput = {
  company: { name: string; taxId: string | null };
  year: { code: string; endsAt: Date };
  previousYear: { code: string } | null;
  modelInfo: { name: string; source: string };
  statements: OfficialStatements;
  equityChanges: EquityChangesStatement;
  recognizedIncome: { lines: RecognizedIncomeLine[] } | null;
  notes: Array<{ title: string; text: string; tables: NoteTable[]; extraLegalBasis?: string }>;
};

function statementTable(title: string, lines: OfficialStatementLine[], current: string, previous: string | null): DocTable {
  return {
    columns: [{ header: title, width: 5 }, { header: current, align: "right" }, ...(previous ? [{ header: previous, align: "right" as const }] : [])],
    rows: lines.map((line) => ({
      cells: [line.label, line.amount, ...(previous ? [line.previous ?? 0] : [])],
      strong: line.kind === "total" || line.depth === 0,
      indent: line.depth,
    })),
  };
}

function noteTable(table: NoteTable): DocTable {
  return {
    title: table.title,
    columns: [{ header: "Concepto", width: 4 }, ...table.columns.map((header) => ({ header, align: "right" as const }))],
    rows: table.rows.map((row) => ({ cells: [row.label, ...row.values], strong: row.strong })),
    note: table.note,
  };
}

const formatDate = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

export function annualAccountsSections(input: AnnualAccountsDocumentInput): DocSection[] {
  const previous = input.previousYear?.code ?? null;
  const closing = formatDate(input.year.endsAt);
  const sections: DocSection[] = [
    {
      heading: `Balance al cierre del ejercicio ${input.year.code} (${closing})`,
      sheetName: "Balance",
      paragraphs: [`${input.modelInfo.name}. ${input.modelInfo.source}. Importes en euros.`],
      tables: [
        statementTable("ACTIVO", input.statements.assets, input.year.code, previous),
        statementTable("PATRIMONIO NETO Y PASIVO", input.statements.equityAndLiabilities, input.year.code, previous),
      ],
    },
    {
      heading: `Cuenta de pérdidas y ganancias del ejercicio terminado el ${closing}`,
      sheetName: "Pérdidas y ganancias",
      tables: [statementTable("(Debe) Haber", input.statements.incomeStatement, input.year.code, previous)],
    },
  ];
  if (input.recognizedIncome) {
    sections.push({
      heading: `Estado de ingresos y gastos reconocidos del ejercicio terminado el ${closing}`,
      sheetName: "Ingresos y gastos reconocidos",
      tables: [{
        columns: [{ header: "", width: 5 }, { header: input.year.code, align: "right" }, ...(previous ? [{ header: previous, align: "right" as const }] : [])],
        rows: input.recognizedIncome.lines.map((line) => ({ cells: [line.label, line.amount, ...(previous ? [line.previous ?? 0] : [])], strong: line.kind === "total" || line.depth === 0, indent: line.depth })),
      }],
    });
  }
  sections.push({
    heading: `Estado total de cambios en el patrimonio neto del ejercicio terminado el ${closing}`,
    sheetName: "Cambios patrimonio neto",
    paragraphs: ["Las variaciones se clasifican automáticamente a partir de los asientos del ejercicio; revísalas antes de formular las cuentas."],
    tables: [{
      columns: [{ header: "", width: 3.2 }, ...input.equityChanges.columns.map((column) => ({ header: column.label, align: "right" as const })), { header: "TOTAL", align: "right" as const }],
      rows: input.equityChanges.rows.map((row) => ({
        cells: row.kind === "group" ? [row.label] : [row.label, ...input.equityChanges.columns.map((column) => row.values[column.id] ?? 0), row.total],
        strong: row.kind === "balance" || row.kind === "group",
        indent: row.kind === "movement" ? 1 : 0,
      })),
    }],
  });
  input.notes.forEach((note, index) => {
    sections.push({
      heading: index === 0 ? `Memoria del ejercicio ${input.year.code} — ${note.title}` : note.title,
      sheetName: `Memoria ${index + 1}`,
      paragraphs: [...(note.extraLegalBasis ? [`(Apartado exigido por: ${note.extraLegalBasis}.)`] : []), note.text],
      tables: note.tables.map(noteTable),
    });
  });
  return sections;
}

export function annualAccountsDocument(input: AnnualAccountsDocumentInput): BookDocument {
  return {
    title: `Cuentas anuales ${input.year.code}`,
    subtitle: `${input.company.name}${input.company.taxId ? ` · NIF ${input.company.taxId}` : ""} · ${input.modelInfo.name}`,
    sections: annualAccountsSections(input),
    landscape: true,
  };
}
