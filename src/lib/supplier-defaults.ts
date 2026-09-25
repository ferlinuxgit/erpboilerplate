/**
 * Valores habituales de un proveedor aplicados a sus facturas (OCR y alta manual) y cálculo
 * del vencimiento. Módulo puro: lo usan tanto los formularios (cliente) como el servidor.
 */

import type { SupplierVatTreatment } from "@/lib/fiscal-spain";

export type SupplierDefaults = {
  defaultExpenseAccountId: string | null;
  /** Retención IRPF habitual en %. */
  defaultRetentionRate: number | null;
  /** IVA deducible habitual en %. */
  defaultTaxDeductiblePct: number | null;
  defaultVatTreatment: SupplierVatTreatment | null;
  paymentTermsDays: number | null;
};

export const SUPPLIER_VAT_TREATMENTS: readonly SupplierVatTreatment[] = ["DOMESTIC", "INTRA_EU", "REVERSE_CHARGE", "IMPORT", "NOT_SUBJECT"];

export function parseSupplierVatTreatment(value: string | null | undefined): SupplierVatTreatment | null {
  return SUPPLIER_VAT_TREATMENTS.find((treatment) => treatment === value) ?? null;
}

function numberOrNull(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Convierte la fila de `partner` (numéricos como texto) en valores por defecto tipados. */
export function supplierDefaultsFromRow(row: {
  defaultExpenseAccountId?: string | null;
  defaultRetentionRate?: string | number | null;
  defaultTaxDeductiblePct?: string | number | null;
  defaultVatTreatment?: string | null;
  paymentTermsDays?: number | null;
}): SupplierDefaults {
  return {
    defaultExpenseAccountId: row.defaultExpenseAccountId || null,
    defaultRetentionRate: numberOrNull(row.defaultRetentionRate),
    defaultTaxDeductiblePct: numberOrNull(row.defaultTaxDeductiblePct),
    defaultVatTreatment: parseSupplierVatTreatment(row.defaultVatTreatment),
    paymentTermsDays: row.paymentTermsDays ?? null,
  };
}

/** "2026-01-31" + 30 días → "2026-03-02". Trabaja en UTC para no depender de la zona horaria. */
export function addDaysToDateInput(dateInput: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match || !Number.isFinite(days)) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Math.trunc(days), 12));
  return date.toISOString().slice(0, 10);
}

/**
 * Vencimiento = fecha de la factura + días de pago del proveedor. Sin días configurados no
 * se inventa un vencimiento; 0 días significa pago al contado (vence el mismo día).
 */
export function dueDateInputFor(issueDateInput: string, paymentTermsDays: number | null | undefined) {
  if (!issueDateInput || paymentTermsDays === null || paymentTermsDays === undefined || paymentTermsDays < 0) return "";
  return addDaysToDateInput(issueDateInput, paymentTermsDays);
}

/** Versión servidor: devuelve la fecha de vencimiento (mediodía UTC) o `undefined`. */
export function computeDueDate(issueDate: Date, paymentTermsDays: number | null | undefined): Date | undefined {
  if (Number.isNaN(issueDate.getTime())) return undefined;
  const due = dueDateInputFor(issueDate.toISOString().slice(0, 10), paymentTermsDays);
  return due ? new Date(`${due}T12:00:00.000Z`) : undefined;
}

/** Origen de la cuenta de gasto de una línea: solo "none" obliga a revisarla. */
export type AccountSource = "ai" | "ocr" | "supplier" | "user" | "none";

export type DefaultableLine = {
  expenseAccountId: string;
  accountSource: AccountSource;
  taxDeductiblePct: string;
  retentionRate: string;
};

function isBlankOrZero(value: string) {
  const normalized = value.trim().replace(",", ".");
  return normalized === "" || Number(normalized) === 0;
}

function decimalText(value: number) {
  return String(value).replace(".", ",");
}

/**
 * Aplica los valores del proveedor a una línea sin pisar lo que el documento o el usuario
 * ya indicaron:
 * - cuenta: solo si la línea no tiene una cuenta propuesta ni elegida;
 * - retención: solo si la línea no trae retención y el documento no mostró ninguna;
 * - deducible: la política del proveedor (p. ej. 50 % vehículo) prevalece salvo que el
 *   usuario ya lo haya cambiado a mano (`userEditedDeductible`).
 */
export function applySupplierDefaultsToLine<T extends DefaultableLine>(
  line: T,
  defaults: SupplierDefaults,
  options: { documentHasRetention?: boolean; userEditedDeductible?: boolean } = {},
): T {
  const next = { ...line };
  if (defaults.defaultExpenseAccountId && (line.accountSource === "none" || !line.expenseAccountId)) {
    next.expenseAccountId = defaults.defaultExpenseAccountId;
    next.accountSource = "supplier";
  }
  if (defaults.defaultRetentionRate !== null && !options.documentHasRetention && isBlankOrZero(line.retentionRate)) {
    next.retentionRate = decimalText(defaults.defaultRetentionRate);
  }
  if (defaults.defaultTaxDeductiblePct !== null && !options.userEditedDeductible) {
    next.taxDeductiblePct = decimalText(defaults.defaultTaxDeductiblePct);
  }
  return next;
}
