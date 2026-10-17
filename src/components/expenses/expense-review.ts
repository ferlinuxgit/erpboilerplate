/**
 * Reglas de revisión de la bandeja de facturas (OCR). Decide qué documentos pueden
 * registrarse en bloque con "Registrar preparados" y por qué los demás necesitan revisión.
 * Lógica pura para poder probarla sin navegador.
 */

import { isSelfAssessedTreatment, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { parseDecimalInput } from "@/lib/format";
import type { AccountSource } from "@/lib/supplier-defaults";
import { centsToNumber, computeEngineDocument, legacyLineTaxes } from "@/server/taxation/engine";

export type ReviewLine = {
  description: string;
  expenseAccountId: string;
  accountSource: AccountSource;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxDeductiblePct: string;
  retentionRate: string;
};

export type ReviewItem = {
  status: string;
  confidence?: "high" | "medium" | "low";
  warnings: readonly string[];
  duplicateLevel: "none" | "possible" | "exact";
  acknowledgeBlocking: boolean;
  /** El usuario ha revisado el documento y lo marca como correcto. */
  reviewed: boolean;
  supplierPartnerId: string;
  supplierName: string;
  supplierTaxId: string;
  supplierDocumentNumber: string;
  issueDate: string;
  currencyCode: string;
  extractedTotal?: number;
  /** Diferencia admitida con el total leído (más amplia si los importes se han convertido de moneda). */
  totalTolerance?: number;
  vatTreatment?: SupplierVatTreatment | "";
  lines: readonly ReviewLine[];
};

export type ReviewReason =
  | "account"
  | "supplier"
  | "number"
  | "date"
  | "currency"
  | "lines"
  | "totals"
  | "blocking"
  | "duplicate"
  | "confidence";

export const reviewReasonLabels: Record<ReviewReason, string> = {
  account: "Revisar cuenta",
  supplier: "Falta el proveedor",
  number: "Falta el número de factura",
  date: "Falta la fecha",
  currency: "Factura en otra moneda: conviértela a euros",
  lines: "Revisar importes de las líneas",
  totals: "Las líneas no cuadran con el total",
  blocking: "Aviso bloqueante sin revisar",
  duplicate: "Posible duplicado",
  confidence: "Lectura poco fiable: revisa y marca como revisada",
};

export type ItemReadiness = {
  /** Se puede registrar en bloque sin intervención. */
  ready: boolean;
  reasons: ReviewReason[];
  total: number;
};

const parseQuantity = (raw: string) => parseDecimalInput(raw) ?? Number.NaN;
const parseMoney = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;
const parsePercent = (raw: string) => parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? Number.NaN;

/** El proveedor no cobra IVA: autorepercusión (UE, inversión del sujeto pasivo) o no sujeta. */
function supplierChargesNoVat(vatTreatment?: SupplierVatTreatment | "") {
  return Boolean(vatTreatment) && (isSelfAssessedTreatment(vatTreatment as SupplierVatTreatment) || vatTreatment === "NOT_SUBJECT");
}

/**
 * Total a pagar de una línea (base + IVA − retención; sin IVA si el proveedor no lo cobra);
 * 0 si algún importe no es válido.
 */
export function reviewLineTotal(line: Pick<ReviewLine, "quantity" | "unitPrice" | "taxRate" | "retentionRate">, vatTreatment?: SupplierVatTreatment | "") {
  const subtotal = parseQuantity(line.quantity) * parseMoney(line.unitPrice);
  const tax = supplierChargesNoVat(vatTreatment) ? 0 : subtotal * parsePercent(line.taxRate) / 100;
  const retention = subtotal * parsePercent(line.retentionRate) / 100;
  const total = subtotal + tax - retention;
  return Number.isFinite(total) ? Math.round((total + Number.EPSILON) * 100) / 100 : 0;
}

/**
 * Total del documento como lo calcula el servidor al registrarlo: base por línea y IVA/retención
 * por tipo sobre la suma de bases (con muchas líneas, sumar cuotas redondeadas línea a línea
 * se desvía unos céntimos del total de la factura).
 */
export function reviewDocumentTotal(lines: readonly Pick<ReviewLine, "quantity" | "unitPrice" | "taxRate" | "retentionRate">[], vatTreatment?: SupplierVatTreatment | "") {
  const parsed = lines.map((line) => ({
    quantity: parseQuantity(line.quantity),
    unitPrice: parseMoney(line.unitPrice),
    taxRate: parsePercent(line.taxRate),
    retentionRate: parsePercent(line.retentionRate),
  })).filter((line) => [line.quantity, line.unitPrice, line.taxRate, line.retentionRate].every(Number.isFinite));
  const document = computeEngineDocument(parsed.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, taxes: legacyLineTaxes(line) })));
  if (supplierChargesNoVat(vatTreatment)) return centsToNumber(document.subtotalCents - document.retentionCents);
  return centsToNumber(document.totalCents);
}

export function isBlockingWarning(warning: string) {
  return warning.toLocaleLowerCase("es-ES").startsWith("bloqueo:");
}

/** Una línea tiene cuenta fiable si viene de la IA/OCR, del proveedor o la eligió el usuario. */
export function lineAccountIsTrusted(line: Pick<ReviewLine, "expenseAccountId" | "accountSource">) {
  return Boolean(line.expenseAccountId) && line.accountSource !== "none";
}

function lineAmountsValid(line: ReviewLine) {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseMoney(line.unitPrice);
  const percentages = [parsePercent(line.taxRate), parsePercent(line.taxDeductiblePct), parsePercent(line.retentionRate)];
  return Boolean(line.description.trim())
    && Number.isFinite(quantity) && quantity > 0
    && Number.isFinite(unitPrice) && unitPrice >= 0
    && percentages.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
}

export function assessReadiness(item: ReviewItem, baseCurrencyCode: string): ItemReadiness {
  const reasons: ReviewReason[] = [];
  const total = reviewDocumentTotal(item.lines, item.vatTreatment);
  if (item.lines.length === 0 || item.lines.some((line) => !lineAmountsValid(line))) reasons.push("lines");
  if (item.lines.length === 0 || item.lines.some((line) => !lineAccountIsTrusted(line))) reasons.push("account");
  if (!item.supplierPartnerId && !item.supplierName.trim() && !item.supplierTaxId.trim()) reasons.push("supplier");
  if (!item.supplierDocumentNumber.trim()) reasons.push("number");
  if (!item.issueDate) reasons.push("date");
  if (item.currencyCode !== baseCurrencyCode) reasons.push("currency");
  if (item.extractedTotal !== undefined && Math.abs(total - item.extractedTotal) > (item.totalTolerance ?? 0.03)) reasons.push("totals");
  if (item.warnings.some(isBlockingWarning) && !item.acknowledgeBlocking) reasons.push("blocking");
  if (item.duplicateLevel !== "none") reasons.push("duplicate");
  // Una lectura de confianza media o baja solo entra en el lote si alguien la ha revisado.
  if (item.confidence !== "high" && !item.reviewed) reasons.push("confidence");
  return { ready: item.status === "DONE" && reasons.length === 0, reasons, total };
}

/** Documentos que "Registrar preparados" puede registrar y el importe total del lote. */
export function selectSafeToPost<T extends ReviewItem>(items: readonly T[], baseCurrencyCode: string) {
  const ready: Array<{ item: T; total: number }> = [];
  for (const item of items) {
    const readiness = assessReadiness(item, baseCurrencyCode);
    if (readiness.ready) ready.push({ item, total: readiness.total });
  }
  const total = Math.round(ready.reduce((sum, entry) => sum + entry.total, 0) * 100) / 100;
  return { ready, total };
}
