import {
  apportionCents,
  isOrdinaryLine,
  lineTaxGroupKey,
  type InvoiceCalculationLine,
  type InvoiceTotals,
} from "@/lib/invoice-totals";
import { amountToCents, bucketKey, centsToNumber, legacyLineTaxes } from "@/server/taxation/engine";

/**
 * Anticipos de clientes, suplidos y descuento global: reglas puras (sin base de datos).
 *
 * Anticipo (art. 75.Dos de la Ley 37/1992): el pago anterior a la operación devenga el IVA por el
 * importe cobrado. Se documenta con una FACTURA DE ANTICIPO (`invoice.isAdvance`) que repercute su
 * IVA; la factura final lleva toda la operación y, además, una línea negativa por cada anticipo
 * («Anticipo según factura X», `invoice_line.advanceInvoiceId`) que resta base y cuota al mismo
 * tipo. Cada factura declara así solo su parte: el anticipo en su periodo y la final por la
 * diferencia. En contabilidad la base del anticipo se abona en la (438) «Anticipos de clientes» y
 * la factura final la carga (PGC, cuarta parte, subgrupo 43).
 */

/** Tipos repercutidos de una línea (IVA y recargo): un anticipo solo se descuenta al mismo tipo. */
export function advanceTaxKey(line: Pick<InvoiceCalculationLine, "taxes" | "taxRate" | "retentionRate">): string {
  const taxes = line.taxes !== undefined && line.taxes !== null ? line.taxes : legacyLineTaxes(line);
  const keys = taxes.filter((selectedTax) => selectedTax.operation === "ADD" && Number(selectedTax.rate) > 0).map((selectedTax) => bucketKey(selectedTax)).sort();
  return keys.join("+") || "SIN_IMPUESTO";
}

/** Texto legible de la clave de tipos, para los mensajes. */
export function advanceTaxKeyLabel(key: string) {
  if (key === "SIN_IMPUESTO") return "sin IVA";
  return key
    .split("+")
    .map((part) => {
      const [, kind, rate] = part.split("|");
      const label = kind === "SURCHARGE" ? "recargo" : kind === "VAT" || !kind ? "IVA" : kind.toLowerCase();
      return `${label} ${String(Number(rate)).replace(".", ",")} %`;
    })
    .join(" + ");
}

/** Bases (en céntimos, con signo) de un conjunto de líneas, por clave de tipos. */
export function basesByAdvanceTaxKey(lines: InvoiceCalculationLine[], totals: InvoiceTotals, filter: (line: InvoiceCalculationLine) => boolean = () => true) {
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    if (line.isDisbursement || !filter(line)) return;
    const cents = amountToCents(totals.lines[index]?.subtotal ?? 0);
    if (cents === 0) return;
    const key = advanceTaxKey(line);
    result.set(key, (result.get(key) ?? 0) + cents);
  });
  return result;
}

export type AdvanceInvoiceState = {
  id: string;
  number: string;
  customerId: string;
  isAdvance: boolean;
  invoiceType: string;
  /** Emitida y no anulada. */
  issued: boolean;
  /** Base del anticipo por clave de tipos, ya minorada por sus rectificativas (céntimos). */
  baseByTaxKey: Map<string, number>;
  /** Ya descontado en otras facturas emitidas (céntimos, en positivo), por clave de tipos. */
  deductedByTaxKey: Map<string, number>;
};

export type AdvanceDeduction = { advanceInvoiceId: string; taxKey: string; /** Céntimos que se descuentan (positivo). */ cents: number };

/** Descuentos de anticipo de una factura, agrupados por anticipo y clave de tipos. */
export function advanceDeductionsOf(lines: InvoiceCalculationLine[], totals: InvoiceTotals): AdvanceDeduction[] {
  const grouped = new Map<string, AdvanceDeduction>();
  lines.forEach((line, index) => {
    if (!line.advanceInvoiceId) return;
    const taxKey = advanceTaxKey(line);
    const key = `${line.advanceInvoiceId}|${taxKey}`;
    const entry = grouped.get(key) ?? { advanceInvoiceId: line.advanceInvoiceId, taxKey, cents: 0 };
    entry.cents -= amountToCents(totals.lines[index]?.subtotal ?? 0);
    grouped.set(key, entry);
  });
  return [...grouped.values()];
}

const euros = (cents: number) => `${centsToNumber(cents).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * ¿Se pueden descontar estos anticipos en una factura de este cliente? Devuelve el primer problema
 * (texto para el usuario) o null.
 */
export function advanceDeductionProblem(input: {
  customerId: string;
  /** La propia factura es de anticipo: no puede descontar otro. */
  invoiceIsAdvance: boolean;
  deductions: AdvanceDeduction[];
  advances: Map<string, AdvanceInvoiceState>;
}): string | null {
  if (input.deductions.length === 0) return null;
  if (input.invoiceIsAdvance) return "Una factura de anticipo no puede descontar otro anticipo: los anticipos se descuentan en la factura final de la operación.";
  for (const deduction of input.deductions) {
    const advance = input.advances.get(deduction.advanceInvoiceId);
    if (!advance) return "El anticipo que se quiere descontar no existe en esta empresa.";
    if (advance.invoiceType !== "INVOICE" || !advance.isAdvance) return `La factura ${advance.number} no es una factura de anticipo: no se puede descontar.`;
    if (!advance.issued) return `La factura de anticipo ${advance.number} todavía no está emitida (o está anulada): emítela antes de descontarla.`;
    if (advance.customerId !== input.customerId) return `La factura de anticipo ${advance.number} es de otro cliente: solo se descuentan anticipos del mismo cliente.`;
    if (deduction.cents <= 0) return `La línea que descuenta el anticipo ${advance.number} debe llevar el importe en negativo.`;
    const base = advance.baseByTaxKey.get(deduction.taxKey);
    if (base === undefined || base <= 0) {
      const available = [...advance.baseByTaxKey.entries()].filter(([, cents]) => cents > 0).map(([key]) => advanceTaxKeyLabel(key)).join(", ");
      return `El anticipo ${advance.number} se facturó ${available ? `con ${available}` : "sin importe pendiente"}: la línea que lo descuenta debe llevar los mismos impuestos (ahora va ${advanceTaxKeyLabel(deduction.taxKey)}).`;
    }
    const remaining = base - (advance.deductedByTaxKey.get(deduction.taxKey) ?? 0);
    if (deduction.cents > remaining) {
      return `Del anticipo ${advance.number} quedan por descontar ${euros(Math.max(remaining, 0))} de base y la factura descuenta ${euros(deduction.cents)}.`;
    }
  }
  return null;
}

export type PostingSalesLine = { itemId: string | null; subtotal: number; role: "sales" | "advance" };

/**
 * Bases de una factura para su asiento, línea a línea:
 * - línea corriente → cuenta de ventas (o la 438 si la factura es de anticipo);
 * - anticipo descontado → 438 en negativo (se carga: el anticipo deja de ser deuda con el cliente);
 * - descuento global → minora las líneas corrientes de sus mismos impuestos, en proporción a su
 *   base (así el descuento reduce la misma cuenta de ventas en la que está la venta);
 * - suplido → no es base: no aparece (va a la cuenta puente por su importe total).
 * La suma de lo devuelto es siempre la base imponible de la factura.
 */
export function buildPostingSalesLines(
  lines: Array<InvoiceCalculationLine & { itemId?: string | null }>,
  totals: InvoiceTotals,
  options: { advanceInvoice?: boolean } = {},
): PostingSalesLine[] {
  const ordinaryRole = options.advanceInvoice ? "advance" as const : "sales" as const;
  const entries = lines.map((line, index) => ({ line, cents: amountToCents(totals.lines[index]?.subtotal ?? 0) }));
  const ordinary = entries
    .filter((entry) => isOrdinaryLine(entry.line))
    .map((entry) => ({ itemId: entry.line.itemId ?? null, cents: entry.cents, role: ordinaryRole, key: lineTaxGroupKey(entry.line) }));
  const extra: Array<{ itemId: string | null; cents: number; role: "sales" | "advance" }> = [];

  for (const entry of entries) {
    if (entry.line.isDisbursement || entry.cents === 0) continue;
    if (entry.line.advanceInvoiceId) {
      extra.push({ itemId: null, cents: entry.cents, role: "advance" });
      continue;
    }
    if (!entry.line.isGlobalDiscount) continue;
    // El descuento tiene signo contrario al de las líneas que minora (negativo en una factura, positivo en su abono).
    const sign = entry.cents < 0 ? 1 : -1;
    const targets = ordinary.filter((target) => target.key === lineTaxGroupKey(entry.line) && Math.sign(target.cents) === sign);
    if (targets.length === 0) {
      extra.push({ itemId: null, cents: entry.cents, role: ordinaryRole });
      continue;
    }
    const shares = apportionCents(Math.abs(entry.cents), targets.map((target) => Math.abs(target.cents)));
    targets.forEach((target, index) => {
      target.cents -= sign * shares[index]!;
    });
  }

  return [...ordinary, ...extra]
    .filter((entry) => entry.cents !== 0)
    .map((entry) => ({ itemId: entry.itemId, subtotal: centsToNumber(entry.cents), role: entry.role }));
}

/** Una factura no puede contener solo suplidos: «eso no sería una factura» (FAQ de VERI*FACTU de la AEAT). */
export function onlyDisbursementsProblem(lines: InvoiceCalculationLine[], totals: InvoiceTotals): string | null {
  if (!lines.some((line) => line.isDisbursement)) return null;
  const hasOperation = lines.some((line, index) => isOrdinaryLine(line) && amountToCents(totals.lines[index]?.subtotal ?? 0) !== 0);
  return hasOperation
    ? null
    : "Una factura no puede contener solo suplidos: los suplidos acompañan a una entrega o un servicio facturado. Añade la línea de la operación o cobra el suplido sin factura.";
}

/** En una factura ordinaria ninguna base por tipo puede quedar negativa (un anticipo o descuento mayor que la operación). */
export function negativeBaseProblem(totals: InvoiceTotals): string | null {
  const negative = totals.taxBuckets.find((bucket) => bucket.operation === "ADD" && amountToCents(bucket.baseAmount) < 0);
  if (negative) {
    return `La base al ${String(negative.rate).replace(".", ",")} % queda en negativo: el anticipo descontado no puede superar el importe de la operación a ese mismo tipo.`;
  }
  return amountToCents(totals.subtotal) < 0 ? "La base imponible queda en negativo: el anticipo descontado no puede superar el importe de la operación." : null;
}
