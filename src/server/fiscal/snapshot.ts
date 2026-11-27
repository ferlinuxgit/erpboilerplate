/**
 * Foto de lo presentado (módulo puro). Al marcar un modelo como presentado se guarda su resumen
 * (casillas, totales y terceros) en `fiscal_report.filedSnapshot`. Desde entonces la vista del
 * modelo enseña esa foto y la compara con el cálculo en vivo: si los datos han cambiado, puede
 * proceder una autoliquidación complementaria o rectificativa.
 *
 * No se guardan las listas de documentos (pueden ser miles de facturas y la foto se lee con cada
 * listado de modelos) ni los avisos previos a la presentación: los totales y casillas bastan para
 * saber qué se presentó y detectar cambios.
 */
import type { FiscalReportSnapshot } from "@/db/schema";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

export const FISCAL_SNAPSHOT_VERSION = 1;

export type FiscalSnapshotDifference = {
  /** Qué ha cambiado: casilla, total o tercero. */
  label: string;
  /** Importe presentado (null si no figuraba). */
  filed: number | null;
  /** Importe con los datos actuales (null si ya no figura). */
  current: number | null;
};

export function buildFiledSnapshot(summary: SpanishFiscalSummary, takenAt = new Date()): FiscalReportSnapshot {
  const stored: SpanishFiscalSummary = {
    ...summary,
    automationChecks: [],
    sourceDocuments: { salesInvoices: [], supplierInvoices: [] },
  };
  return { version: FISCAL_SNAPSHOT_VERSION, takenAt: takenAt.toISOString(), summary: JSON.parse(JSON.stringify(stored)) as Record<string, unknown> };
}

/** Resumen guardado en la foto, o null si la foto no existe o no se reconoce. */
export function readFiledSnapshot(snapshot: FiscalReportSnapshot | null | undefined): SpanishFiscalSummary | null {
  if (!snapshot || snapshot.version !== FISCAL_SNAPSHOT_VERSION || !snapshot.summary || typeof snapshot.summary !== "object") return null;
  const summary = snapshot.summary as unknown as SpanishFiscalSummary;
  if (typeof summary.code !== "string" || !Array.isArray(summary.modelo303Boxes)) return null;
  return {
    ...summary,
    automationChecks: summary.automationChecks ?? [],
    sourceDocuments: summary.sourceDocuments ?? { salesInvoices: [], supplierInvoices: [] },
  };
}

type Row = { key: string; label: string; amount: number };

function boxRows(prefix: string, boxes: Array<{ box: string; label: string; amount: number }> | undefined): Row[] {
  return (boxes ?? []).map((box) => ({
    key: `${prefix}|${box.box}|${box.box && box.box !== "REV" ? "" : box.label}`,
    label: box.box && box.box !== "REV" && box.box !== "EXE" ? `Casilla ${box.box} · ${box.label}` : box.label,
    amount: box.amount,
  }));
}

/** Importes que identifican lo presentado: totales, casillas, operadores y terceros. */
function snapshotRows(summary: SpanishFiscalSummary): Row[] {
  const rows: Row[] = [];
  if (summary.amountDue !== null) rows.push({ key: "amountDue", label: "Resultado del modelo", amount: summary.amountDue });
  if (summary.modelo130) {
    rows.push(...boxRows("130", summary.modelo130.boxes));
  } else if (summary.modelo349) {
    for (const operator of summary.modelo349.operators) rows.push({ key: `349|${operator.key}|${operator.taxId}`, label: `Clave ${operator.key} · ${operator.name} (${operator.taxId})`, amount: operator.amount });
    for (const operator of summary.modelo349.rectifications) rows.push({ key: `349r|${operator.key}|${operator.taxId}|${operator.originalPeriod}`, label: `Rectificación ${operator.originalPeriod} · clave ${operator.key} · ${operator.name} (${operator.taxId})`, amount: operator.amount });
  } else if (summary.thirdPartyOperations) {
    for (const operation of summary.thirdPartyOperations) {
      const who = `${operation.type === "customer" ? "Cliente" : "Proveedor"} ${operation.name} (${operation.taxId})`;
      const id = `347|${operation.type}|${operation.taxId === "Sin NIF" ? operation.name : operation.taxId}`;
      rows.push({ key: id, label: who, amount: operation.amount });
      (operation.quarters ?? []).forEach((amount, index) => {
        if (amount !== 0) rows.push({ key: `${id}|T${index + 1}`, label: `${who} · ${index + 1}T`, amount });
      });
      if (operation.cashAmount !== undefined) rows.push({ key: `${id}|cash`, label: `${who} · cobrado en metálico`, amount: operation.cashAmount });
    }
  } else if (summary.canaryBoxes) {
    rows.push(...boxRows("canary", summary.canaryBoxes));
  } else if (summary.code === "303") {
    rows.push(...boxRows("303", summary.modelo303Boxes));
  } else if (summary.annualSummaryBoxes) {
    rows.push(...boxRows("390", summary.annualSummaryBoxes));
  } else {
    rows.push({ key: "withholdingBase", label: "Base de las retenciones", amount: summary.withholdingBase });
    rows.push({ key: "withholdingAmount", label: "Retenciones practicadas", amount: summary.withholdingAmount });
  }
  return rows;
}

/**
 * Diferencias entre lo presentado y el cálculo con los datos actuales. Lista vacía = nada ha cambiado.
 * Compara al céntimo; una fila que aparece o desaparece cuenta como diferencia salvo que valga cero.
 */
export function diffFiledSnapshot(filed: SpanishFiscalSummary, current: SpanishFiscalSummary): FiscalSnapshotDifference[] {
  const filedRows = new Map(snapshotRows(filed).map((row) => [row.key, row]));
  const currentRows = new Map(snapshotRows(current).map((row) => [row.key, row]));
  const cents = (value: number | undefined) => Math.round((value ?? 0) * 100);
  const differences: FiscalSnapshotDifference[] = [];
  for (const [key, row] of filedRows) {
    const now = currentRows.get(key);
    if (cents(row.amount) !== cents(now?.amount)) differences.push({ label: row.label, filed: row.amount, current: now ? now.amount : null });
  }
  for (const [key, row] of currentRows) {
    if (!filedRows.has(key) && cents(row.amount) !== 0) differences.push({ label: row.label, filed: null, current: row.amount });
  }
  return differences;
}
