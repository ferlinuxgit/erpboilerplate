/**
 * Reglas puras de las facturas recibidas (sin base de datos ni dependencias de servidor): las usan
 * el servicio, las rutas y los formularios.
 *
 * - Clase de documento: factura o rectificativa (abono del proveedor). Solo la rectificativa admite
 *   importes negativos.
 * - Estado de pago con signo: un abono nunca queda «pendiente de pago».
 * - NIF del proveedor obligatorio salvo factura simplificada / ticket (art. 64 RIVA).
 */

export const SUPPLIER_DOCUMENT_KINDS = ["INVOICE", "RECTIFICATION"] as const;
export type SupplierDocumentKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];

export const supplierDocumentKindLabels: Record<SupplierDocumentKind, string> = {
  INVOICE: "Factura",
  RECTIFICATION: "Rectificativa",
};

export function parseSupplierDocumentKind(value: string | null | undefined): SupplierDocumentKind {
  return value === "RECTIFICATION" ? "RECTIFICATION" : "INVOICE";
}

type AmountLine = { description?: string; quantity: number; unitPrice: number };

/**
 * Problema de las líneas según la clase de documento, o `null` si son válidas.
 * - Factura: cantidad > 0 y precio ≥ 0 (como siempre).
 * - Rectificativa: cantidad y precio con cualquier signo (abono total o parcial, o diferencia al
 *   alza), pero ninguna línea a cero: no rectificaría nada y el asiento quedaría vacío.
 */
export function supplierLinesProblem(lines: readonly AmountLine[], kind: SupplierDocumentKind): string | null {
  if (lines.length === 0) return "La factura necesita al menos una línea.";
  for (const line of lines) {
    if (line.description !== undefined && !line.description.trim()) return "Todas las líneas necesitan descripción.";
    if (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitPrice)) return "Cantidad y precio deben ser números válidos.";
    if (kind === "RECTIFICATION") {
      if (line.quantity === 0 || line.unitPrice === 0) return "En una rectificativa ninguna línea puede tener cantidad o importe a cero: quita la línea que no se rectifica.";
      continue;
    }
    if (line.quantity <= 0) return "La cantidad debe ser mayor que cero. Para registrar un abono, elige el tipo «Rectificativa».";
    if (line.unitPrice < 0) return "El precio unitario no puede ser negativo. Para registrar un abono, elige el tipo «Rectificativa».";
  }
  return null;
}

/**
 * Una rectificativa debe identificar la factura que rectifica (la registrada o su número) o, si es
 * un descuento por volumen de varias facturas, explicar el motivo.
 */
export function rectificationReferenceProblem(input: {
  kind: SupplierDocumentKind;
  rectifiedInvoiceId?: string | null;
  rectifiedDocumentNumber?: string | null;
  rectificationReason?: string | null;
}): string | null {
  if (input.kind !== "RECTIFICATION") return null;
  if (input.rectifiedInvoiceId || input.rectifiedDocumentNumber?.trim() || input.rectificationReason?.trim()) return null;
  return "Indica la factura que se rectifica (o su número) o, si es un descuento que afecta a varias, el motivo de la rectificación.";
}

export type SupplierPaymentStatus = "PAID" | "PARTIAL" | "OVERDUE" | "PENDING";

/**
 * Estado de pago de una factura recibida.
 *
 * Un documento con total ≤ 0 (abono del proveedor) no tiene nada que pagar: se guarda como `PAID`
 * para que ningún listado de pendientes, remesa ni aviso de vencimiento lo ofrezca como deuda.
 * Su importe es un saldo a favor frente al proveedor (queda en su subcuenta 400/410).
 */
export function supplierPaymentStatus(totalAmount: number, paidAmount: number, dueDate: Date | null | undefined, now: Date = new Date()): SupplierPaymentStatus {
  if (totalAmount <= 0) return "PAID";
  if (paidAmount >= totalAmount) return "PAID";
  if (paidAmount > 0) return "PARTIAL";
  if (dueDate && dueDate.getTime() < now.getTime()) return "OVERDUE";
  return "PENDING";
}

/** Abono con saldo a favor: rectificativa (o documento) de total negativo y no anulada. */
export function isSupplierCreditBalance(input: { totalAmount: number | string; status?: string | null }) {
  return input.status !== "VOID" && Number(input.totalAmount) < 0;
}

/**
 * Art. 64 RIVA: el libro registro de facturas recibidas anota el NIF del obligado a expedir. Es
 * obligatorio salvo en facturas simplificadas / tickets (que no lo llevan del destinatario y a veces
 * ni se conserva el del emisor) y en proveedores extranjeros que no son adquisiciones
 * intracomunitarias (un proveedor de fuera de la UE puede no tener NIF-IVA).
 */
export function supplierTaxIdProblem(input: {
  taxId?: string | null;
  supplierCountryCode?: string | null;
  homeCountryCode?: string | null;
  vatTreatment?: string | null;
  isSimplified?: boolean;
}): string | null {
  if (input.isSimplified) return null;
  if (input.taxId?.trim()) return null;
  const home = (input.homeCountryCode?.trim() || "ES").toUpperCase();
  const country = (input.supplierCountryCode?.trim() || home).toUpperCase();
  if (country !== home && input.vatTreatment !== "INTRA_EU") return null;
  return "Falta el NIF del proveedor, obligatorio en el libro registro de facturas recibidas. Complétalo en la ficha del proveedor o, si es un ticket o una factura simplificada sin NIF, márcalo así.";
}

/** Recargo de equivalencia soportado: solo cuando el proveedor repercute IVA (interior o importación). */
export function surchargeTreatmentProblem(vatTreatment: string | null | undefined, hasSurcharge: boolean): string | null {
  if (!hasSurcharge) return null;
  if (!vatTreatment || vatTreatment === "DOMESTIC" || vatTreatment === "IMPORT") return null;
  return "El recargo de equivalencia solo se admite en facturas con IVA repercutido por el proveedor (operación interior o importación).";
}

/**
 * Tipo de recargo de equivalencia que corresponde a un tipo de IVA (art. 161 LIVA): 21 → 5,2;
 * 10 → 1,4; 4 → 0,5. Para cualquier otro tipo (p. ej. el 1,75 del tabaco, que va con el 21) no se
 * propone nada: se indica a mano.
 */
export function defaultSurchargeRate(taxRate: number) {
  if (taxRate === 21) return 5.2;
  if (taxRate === 10) return 1.4;
  if (taxRate === 4) return 0.5;
  return 0;
}

/** Bien de inversión por defecto: cuentas de inmovilizado (grupo 2 del PGC) salvo que se indique otra cosa. */
export function defaultInvestmentGood(accountCode: string | null | undefined) {
  return (accountCode ?? "").startsWith("2");
}

export type RectificationSourceLine = {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate: number | string;
  taxDeductiblePct: number | string;
  retentionRate: number | string;
  surchargeRate?: number | string | null;
  expenseAccountId?: string | null;
  isInvestmentGood?: boolean | null;
};

/**
 * Líneas propuestas para el abono de una factura: las mismas con la cantidad en negativo (abono
 * total). El usuario las edita o borra para un abono parcial.
 */
export function rectificationLinesFrom(lines: readonly RectificationSourceLine[]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: -Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    taxRate: Number(line.taxRate),
    taxDeductiblePct: Number(line.taxDeductiblePct),
    retentionRate: Number(line.retentionRate),
    surchargeRate: Number(line.surchargeRate ?? 0),
    expenseAccountId: line.expenseAccountId ?? "",
    isInvestmentGood: Boolean(line.isInvestmentGood),
  }));
}

/** ¿El texto leído de un documento es una rectificativa / abono? (OCR). */
export function looksLikeRectification(text: string) {
  return /factura[ \t]+rectificativa|rectificativa[ \t]+de|nota[ \t]+de[ \t]+(?:abono|cr[eé]dito)|factura[ \t]+de[ \t]+abono|\babono[ \t]+(?:n[ºo°.]|de[ \t]+factura)|credit[ \t]+(?:note|memo)|corrective[ \t]+invoice/i.test(text);
}

/**
 * Pendiente de pago de una factura recibida, en céntimos: total − pagos − abonos compensados.
 * Nunca negativo; un abono (total ≤ 0) o una factura anulada no tienen nada pendiente.
 * Es la única regla de «pendiente» de compras: pagos, remesas, tesorería, ficha y panel la comparten
 * (en SQL, `supplierInvoiceOutstandingSql` de `outstanding.ts` hace el mismo cálculo).
 */
export function supplierOutstandingCents(input: { totalCents: number; paidCents: number; creditedCents?: number; isVoid?: boolean }) {
  if (input.isVoid || input.totalCents <= 0) return 0;
  return Math.max(input.totalCents - input.paidCents - (input.creditedCents ?? 0), 0);
}

/** Saldo a favor que le queda a un abono, en céntimos: |total| − lo ya compensado o devuelto. */
export function supplierCreditRemainingCents(input: { totalCents: number; appliedCents: number; isVoid?: boolean }) {
  if (input.isVoid || input.totalCents >= 0) return 0;
  return Math.max(-input.totalCents - input.appliedCents, 0);
}

/**
 * Cuánto de un abono se compensa contra una factura: lo menor entre el saldo del abono y lo
 * pendiente de la factura. El resto del abono queda como saldo a favor del proveedor.
 */
export function supplierCreditAllocationCents(creditRemainingCents: number, invoiceOutstandingCents: number) {
  return Math.max(Math.min(creditRemainingCents, invoiceOutstandingCents), 0);
}
