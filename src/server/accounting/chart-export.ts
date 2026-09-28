import ExcelJS from "exceljs";

import type { ChartNode } from "@/lib/chart-of-accounts/types";

/**
 * Exportación del plan contable (CSV para Excel en español y XLSX) con las mismas columnas que el
 * árbol: código, cuenta, nivel, tercero, saldo inicial, debe, haber y saldo con su lado.
 */

const CSV_DELIMITER = ";";
const MONEY_FORMAT = '#,##0.00 "€";-#,##0.00 "€"';

export const CHART_EXPORT_HEADERS = ["Código", "Cuenta", "Nivel", "Tercero", "NIF", "Saldo inicial", "Debe", "Haber", "Saldo", "Lado", "Bloqueada"] as const;

function side(balanceCents: number) {
  if (balanceCents === 0) return "Saldado";
  return balanceCents > 0 ? "Deudor" : "Acreedor";
}

export function chartExportRows(nodes: readonly ChartNode[]): Array<Array<string | number>> {
  return nodes.map((node) => [
    node.code,
    node.name,
    node.isPostable ? "Subcuenta" : String(node.level),
    node.partnerName ?? "",
    node.partnerTaxId ?? "",
    node.openingCents / 100,
    node.debitCents / 100,
    node.creditCents / 100,
    Math.abs(node.balanceCents) / 100,
    side(node.balanceCents),
    node.isBlocked ? "Sí" : "",
  ]);
}

function escapeCsvValue(value: string | number) {
  if (typeof value === "number") return value.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 2, minimumFractionDigits: 2 });
  let text = value;
  // Evita la inyección de fórmulas en la hoja de cálculo con textos del usuario.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";,\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildChartCsv(nodes: readonly ChartNode[]) {
  const rows = [[...CHART_EXPORT_HEADERS], ...chartExportRows(nodes)];
  // BOM para que Excel detecte UTF-8 (tildes, €).
  return `﻿${rows.map((row) => row.map(escapeCsvValue).join(CSV_DELIMITER)).join("\r\n")}`;
}

export async function buildChartXlsx(nodes: readonly ChartNode[], meta: { title: string; period: string }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Plan contable");
  sheet.columns = [
    { header: "Código", key: "code", width: 12 },
    { header: "Cuenta", key: "name", width: 44 },
    { header: "Nivel", key: "level", width: 11 },
    { header: "Tercero", key: "partner", width: 28 },
    { header: "NIF", key: "taxId", width: 13 },
    { header: "Saldo inicial", key: "opening", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Debe", key: "debit", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Haber", key: "credit", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Saldo", key: "balance", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Lado", key: "side", width: 10 },
    { header: "Bloqueada", key: "blocked", width: 10 },
  ];
  for (const row of chartExportRows(nodes)) {
    const added = sheet.addRow(row);
    const node = nodes[added.number - 2];
    // Los grupos en negrita y sangrados por nivel, como en el árbol.
    if (node && !node.isPostable) added.font = { bold: true };
    if (node) added.getCell(2).alignment = { indent: Math.min(node.level - 1, 5) };
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([]);
  sheet.addRow([meta.title, meta.period]);
  return workbook.xlsx.writeBuffer();
}
