import {
  buildClosingInventory,
  buildLedger,
  buildOpeningInventory,
  buildQuarterlyTrialBalances,
  journalTotals,
  type AccountBalance,
  type Inventory,
  type OrderedBookEntry,
} from "@/server/accounting/books/books-model";
import type { BookDocument, DocSection, DocTable } from "@/server/accounting/books/document";

/** Los tres libros como documentos (para XLSX y PDF). Funciones puras. */

export type BookHeader = { companyName: string; taxId: string | null; yearCode: string; startsAt: Date; endsAt: Date };

const euros = (cents: number) => cents / 100;
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const formatDate = (date: Date) => formatDay(date.toISOString().slice(0, 10));

function subtitle(header: BookHeader) {
  return `${header.companyName}${header.taxId ? ` · NIF ${header.taxId}` : ""} · Ejercicio ${header.yearCode} (${formatDate(header.startsAt)} a ${formatDate(header.endsAt)})`;
}

const KIND_LABEL = { opening: "Asiento de apertura", regularization: "Regularización", closing: "Asiento de cierre", normal: "" } as const;

/** Libro Diario: un bloque por asiento, en orden cronológico y con su número de orden. */
export function journalDocument(header: BookHeader, journal: OrderedBookEntry[]): BookDocument {
  const totals = journalTotals(journal);
  const rows: DocTable["rows"] = [];
  for (const entry of journal) {
    // Dentro de cada asiento, primero las líneas al debe.
    const lines = [...entry.lines].sort((a, b) => Number(b.debitCents > 0) - Number(a.debitCents > 0));
    lines.forEach((line, index) => {
      rows.push({
        cells: [
          index === 0 ? String(entry.order) : "",
          index === 0 ? formatDay(entry.day) : "",
          index === 0 ? entry.number : "",
          line.accountCode,
          line.accountName,
          line.concept ?? entry.reference ?? KIND_LABEL[entry.kind],
          line.debitCents ? euros(line.debitCents) : null,
          line.creditCents ? euros(line.creditCents) : null,
        ],
      });
    });
  }
  rows.push({ cells: ["", "", "", "", "", "SUMAS DEL DIARIO", euros(totals.debitCents), euros(totals.creditCents)], strong: true });
  return {
    title: "Libro Diario",
    subtitle: subtitle(header),
    landscape: true,
    sections: [{
      heading: `Libro Diario del ejercicio ${header.yearCode}`,
      sheetName: "Diario",
      paragraphs: [`${totals.entries} asientos numerados correlativamente por orden de fecha (art. 28.2 del Código de Comercio). La columna «Asiento» es el número interno del programa.`],
      tables: [{
        columns: [
          { header: "N.º", width: 0.5 },
          { header: "Fecha", width: 0.8 },
          { header: "Asiento", width: 1.2 },
          { header: "Cuenta", width: 0.9 },
          { header: "Título de la cuenta", width: 2.4 },
          { header: "Concepto", width: 3 },
          { header: "Debe", align: "right" },
          { header: "Haber", align: "right" },
        ],
        rows,
      }],
    }],
  };
}

/** Libro Mayor: una tabla por cuenta con el saldo acumulado. */
export function ledgerDocument(header: BookHeader, journal: OrderedBookEntry[], prior: AccountBalance[]): BookDocument {
  const rows: DocTable["rows"] = [];
  for (const account of buildLedger(journal, prior)) {
    rows.push({ cells: [`${account.code} ${account.name}`, "", "", "", null, null, null], strong: true });
    if (account.openingCents !== 0) rows.push({ cells: ["", "", "", "Saldo anterior", null, null, euros(account.openingCents)], indent: 1 });
    for (const line of account.lines) {
      rows.push({ cells: ["", String(line.order), formatDay(line.day), line.concept ?? "", line.debitCents ? euros(line.debitCents) : null, line.creditCents ? euros(line.creditCents) : null, euros(line.balanceCents)] });
    }
    rows.push({ cells: ["", "", "", "Sumas y saldo final", euros(account.debitCents), euros(account.creditCents), euros(account.closingCents)], strong: true });
  }
  return {
    title: "Libro Mayor",
    subtitle: subtitle(header),
    landscape: true,
    sections: [{
      heading: `Libro Mayor del ejercicio ${header.yearCode}`,
      sheetName: "Mayor",
      paragraphs: ["Libro auxiliar. Saldo = debe − haber (en negativo, saldo acreedor). «N.º» es el número de orden del asiento en el Libro Diario."],
      tables: [{
        columns: [
          { header: "Cuenta", width: 2.2 },
          { header: "N.º", width: 0.5 },
          { header: "Fecha", width: 0.8 },
          { header: "Concepto", width: 3 },
          { header: "Debe", align: "right" },
          { header: "Haber", align: "right" },
          { header: "Saldo", align: "right" },
        ],
        rows,
      }],
    }],
  };
}

function inventoryTables(inventory: Inventory): DocTable[] {
  const table = (title: string, rows: Inventory["assets"], total: number, extra?: DocTable["rows"]): DocTable => ({
    title,
    columns: [{ header: "Cuenta", width: 1 }, { header: "Título", width: 4 }, { header: "Importe", align: "right" }],
    rows: [
      ...rows.map((row) => ({ cells: [row.code, row.name, euros(row.amountCents)] })),
      ...(extra ?? []),
      { cells: ["", `Total ${title.toLowerCase()}`, euros(total)], strong: true },
    ],
  });
  return [
    table("Activo", inventory.assets, inventory.totalAssetsCents),
    table("Patrimonio neto y pasivo", inventory.equityAndLiabilities, inventory.totalEquityAndLiabilitiesCents,
      inventory.pendingResultCents !== 0 ? [{ cells: ["", "Resultado del ejercicio pendiente de regularizar (grupos 6 y 7)", euros(inventory.pendingResultCents)] }] : []),
  ];
}

/**
 * Libro de Inventarios y Cuentas Anuales (art. 28.1 del Código de Comercio): balance inicial
 * detallado, balances de comprobación trimestrales con sumas y saldos, inventario de cierre y las
 * cuentas anuales (`annualAccounts`: secciones ya preparadas).
 */
export function inventoryBookDocument(header: BookHeader, journal: OrderedBookEntry[], prior: AccountBalance[], annualAccounts: DocSection[]): BookDocument {
  const sections: DocSection[] = [{
    heading: `Balance inicial detallado al ${formatDate(header.startsAt)}`,
    sheetName: "Balance inicial",
    paragraphs: ["Saldos con los que se abre el ejercicio: el asiento de apertura o, si el ejercicio anterior no se ha cerrado, los saldos que vienen de él."],
    tables: inventoryTables(buildOpeningInventory(journal, prior)),
  }];
  for (const balance of buildQuarterlyTrialBalances(journal, prior, header)) {
    sections.push({
      heading: `Balance de comprobación de sumas y saldos — ${balance.label} (acumulado al ${formatDay(balance.to)})`,
      sheetName: `Sumas y saldos T${balance.label[0]}`,
      paragraphs: ["Sumas acumuladas desde el inicio del ejercicio, antes de la regularización y del cierre."],
      tables: [{
        columns: [
          { header: "Cuenta", width: 1 },
          { header: "Título", width: 3.4 },
          { header: "Suma debe", align: "right" },
          { header: "Suma haber", align: "right" },
          { header: "Saldo deudor", align: "right" },
          { header: "Saldo acreedor", align: "right" },
        ],
        rows: [
          ...balance.rows.map((row) => ({ cells: [row.code, row.name, euros(row.debitCents), euros(row.creditCents), row.debtorCents ? euros(row.debtorCents) : null, row.creditorCents ? euros(row.creditorCents) : null] })),
          { cells: ["", "TOTALES", euros(balance.totals.debitCents), euros(balance.totals.creditCents), euros(balance.totals.debtorCents), euros(balance.totals.creditorCents)], strong: true },
        ],
      }],
    });
  }
  sections.push({
    heading: `Inventario de cierre al ${formatDate(header.endsAt)}`,
    sheetName: "Inventario de cierre",
    paragraphs: ["Saldo de cada cuenta de balance al cierre del ejercicio, antes del asiento de cierre."],
    tables: inventoryTables(buildClosingInventory(journal, prior)),
  });
  sections.push(...annualAccounts);
  return { title: "Libro de Inventarios y Cuentas Anuales", subtitle: subtitle(header), landscape: true, sections };
}
