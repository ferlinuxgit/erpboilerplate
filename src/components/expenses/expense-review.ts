/**
 * Reglas de revisión de la bandeja de facturas (OCR). Decide qué documentos pueden
 * registrarse en bloque con "Registrar preparados" y por qué los demás necesitan revisión.
 * Lógica pura para poder probarla sin navegador.
 */

import { isSelfAssessedTreatment, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { parseDecimalInput } from "@/lib/format";
import type { AccountSource } from "@/lib/supplier-defaults";
import { supplierLinesProblem, type SupplierDocumentKind } from "@/server/supplier-invoices/document-rules";
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
  /** Recargo de equivalencia soportado, en % (vacío o 0 = sin recargo). */
  surchargeRate?: string;
  /** Bien de inversión; sin indicar lo decide la cuenta (grupo 2). */
  isInvestmentGood?: boolean;
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
  /** Convertida de moneda con el cambio de otra fecha (se corrigió la fecha después). */
  exchangeStale?: boolean;
  vatTreatment?: SupplierVatTreatment | "";
  /** Rectificativa (abono): admite líneas en negativo y pide la factura rectificada o el motivo. */
  documentKind?: SupplierDocumentKind;
  rectifiedDocumentNumber?: string;
  rectificationReason?: string;
  /** Falta el NIF del proveedor y no está marcada como ticket / simplificada. */
  taxIdMissing?: boolean;
  lines: readonly ReviewLine[];
};

export type ReviewReason =
  | "account"
  | "supplier"
  | "taxId"
  | "rectified"
  | "number"
  | "date"
  | "currency"
  | "exchange"
  | "lines"
  | "totals"
  | "blocking"
  | "duplicate"
  | "confidence";

export const reviewReasonLabels: Record<ReviewReason, string> = {
  account: "Revisar cuenta",
  supplier: "Falta el proveedor",
  taxId: "Falta el NIF del proveedor (o marca ticket / simplificada)",
  rectified: "Indica la factura rectificada o el motivo",
  number: "Falta el número de factura",
  date: "Falta la fecha",
  currency: "Factura en otra moneda: conviértela a euros",
  exchange: "Cambio de divisa de otra fecha: vuelve a convertir",
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
/** Recargo de equivalencia de la línea (0 si no lleva o no es válido). */
export const parseSurchargeRate = (raw: string | undefined) => {
  const rate = raw?.trim() ? parsePercent(raw) : 0;
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
};

/** El proveedor no cobra IVA: autorepercusión (UE, inversión del sujeto pasivo) o no sujeta. */
function supplierChargesNoVat(vatTreatment?: SupplierVatTreatment | "") {
  return Boolean(vatTreatment) && (isSelfAssessedTreatment(vatTreatment as SupplierVatTreatment) || vatTreatment === "NOT_SUBJECT");
}

/**
 * Total a pagar de una línea (base + IVA − retención; sin IVA si el proveedor no lo cobra);
 * 0 si algún importe no es válido.
 */
export function reviewLineTotal(line: Pick<ReviewLine, "quantity" | "unitPrice" | "taxRate" | "retentionRate" | "surchargeRate">, vatTreatment?: SupplierVatTreatment | "") {
  const subtotal = parseQuantity(line.quantity) * parseMoney(line.unitPrice);
  const noVat = supplierChargesNoVat(vatTreatment);
  const tax = noVat ? 0 : subtotal * parsePercent(line.taxRate) / 100;
  const surcharge = noVat ? 0 : subtotal * parseSurchargeRate(line.surchargeRate) / 100;
  const retention = subtotal * parsePercent(line.retentionRate) / 100;
  const total = subtotal + tax + surcharge - retention;
  return Number.isFinite(total) ? Math.round((total + Number.EPSILON) * 100) / 100 : 0;
}

/**
 * Total del documento como lo calcula el servidor al registrarlo: base por línea y IVA/retención
 * por tipo sobre la suma de bases (con muchas líneas, sumar cuotas redondeadas línea a línea
 * se desvía unos céntimos del total de la factura).
 */
export function reviewDocumentTotal(lines: readonly Pick<ReviewLine, "quantity" | "unitPrice" | "taxRate" | "retentionRate" | "surchargeRate">[], vatTreatment?: SupplierVatTreatment | "", documentKind: SupplierDocumentKind = "INVOICE") {
  const parsed = lines.map((line) => ({
    quantity: parseQuantity(line.quantity),
    unitPrice: parseMoney(line.unitPrice),
    taxRate: parsePercent(line.taxRate),
    retentionRate: parsePercent(line.retentionRate),
    surchargeRate: parseSurchargeRate(line.surchargeRate),
  })).filter((line) => [line.quantity, line.unitPrice, line.taxRate, line.retentionRate].every(Number.isFinite));
  // Una rectificativa conserva el signo de sus líneas (abono); una factura nunca es negativa.
  const document = computeEngineDocument(parsed.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, taxes: legacyLineTaxes(line) })), { allowNegative: documentKind === "RECTIFICATION" });
  if (supplierChargesNoVat(vatTreatment)) return centsToNumber(document.subtotalCents - document.retentionCents);
  // Recargo de equivalencia: se suma a lo que se paga al proveedor (cuota por línea, al céntimo).
  const surchargeCents = parsed.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice * line.surchargeRate), 0);
  return centsToNumber(document.totalCents + surchargeCents);
}

export function isBlockingWarning(warning: string) {
  return warning.toLocaleLowerCase("es-ES").startsWith("bloqueo:");
}

/** Una línea tiene cuenta fiable si viene de la IA/OCR, del proveedor o la eligió el usuario. */
export function lineAccountIsTrusted(line: Pick<ReviewLine, "expenseAccountId" | "accountSource">) {
  return Boolean(line.expenseAccountId) && line.accountSource !== "none";
}

function lineAmountsValid(line: ReviewLine, documentKind: SupplierDocumentKind) {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseMoney(line.unitPrice);
  const percentages = [parsePercent(line.taxRate), parsePercent(line.taxDeductiblePct), parsePercent(line.retentionRate)];
  // Mismas reglas de signo que el servidor: solo la rectificativa admite negativos.
  return supplierLinesProblem([{ description: line.description, quantity, unitPrice }], documentKind) === null
    && percentages.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
}

export function assessReadiness(item: ReviewItem, baseCurrencyCode: string): ItemReadiness {
  const reasons: ReviewReason[] = [];
  const documentKind = item.documentKind ?? "INVOICE";
  const total = reviewDocumentTotal(item.lines, item.vatTreatment, documentKind);
  if (item.lines.length === 0 || item.lines.some((line) => !lineAmountsValid(line, documentKind))) reasons.push("lines");
  if (item.lines.length === 0 || item.lines.some((line) => !lineAccountIsTrusted(line))) reasons.push("account");
  if (!item.supplierPartnerId && !item.supplierName.trim() && !item.supplierTaxId.trim()) reasons.push("supplier");
  else if (item.taxIdMissing) reasons.push("taxId");
  if (documentKind === "RECTIFICATION" && !item.rectifiedDocumentNumber?.trim() && !item.rectificationReason?.trim()) reasons.push("rectified");
  if (!item.supplierDocumentNumber.trim()) reasons.push("number");
  if (!item.issueDate) reasons.push("date");
  if (item.currencyCode !== baseCurrencyCode) reasons.push("currency");
  if (item.exchangeStale) reasons.push("exchange");
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
