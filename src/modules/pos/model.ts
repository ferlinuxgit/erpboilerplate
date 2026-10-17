/**
 * Modelo del TPV (sin servidor): importes del carrito con el mismo motor fiscal que la factura,
 * precios con IVA incluido, reparto del cobro (efectivo/tarjeta), cambio y arqueo de caja.
 */

import { amountToCents, centsToNumber, computeEngineDocument, legacyLineTaxes, roundHalfAwayFromZero, taxOnBaseCents } from "@/server/taxation/engine";

export type CartLine = {
  key: string;
  itemId: string | null;
  description: string;
  quantity: number;
  /** Precio unitario sin IVA (2 decimales): es lo que se guarda en la factura. */
  unitPrice: number;
  taxRate: number;
  /** Impuesto configurado del artículo (si lo tiene): se usa al emitir. */
  taxId?: string | null;
};

export type CartTotals = {
  subtotal: number;
  tax: number;
  total: number;
  /** Desglose por tipo de IVA (obligatorio en la factura simplificada si hay varios tipos). */
  taxBreakdown: Array<{ rate: number; base: number; tax: number }>;
  /** Importe de cada línea del carrito con IVA (PVP × cantidad): suman exactamente el total. */
  lines: Array<{ key: string; total: number }>;
  /** Líneas que se facturan: las del carrito con el redondeo del IVA ya absorbido. */
  settled: CartLine[];
};

const lineBase = (line: Pick<CartLine, "quantity" | "unitPrice">) => roundHalfAwayFromZero(line.quantity * line.unitPrice * 100);
const lineGross = (line: Pick<CartLine, "quantity" | "unitPrice" | "taxRate">) => amountToCents(grossPrice(line.unitPrice, line.taxRate) * line.quantity);

/**
 * En el mostrador los precios llevan el IVA incluido: el total de cada tipo de IVA debe ser la suma de
 * los PVP. La factura guarda precios sin IVA con 2 decimales y calcula la cuota sobre la suma de bases,
 * lo que puede desviar algún céntimo (2 × 2,00 € + 0,50 € daría 4,49 €). Se elige la base que con su
 * cuota da exactamente esa suma y la diferencia de céntimos se absorbe en una línea (separando una
 * unidad si todas tienen varias). Base + cuota = total en cada tipo, como exige la factura.
 */
export function settleCartLines(lines: readonly CartLine[]): CartLine[] {
  const result = lines.map((line) => ({ ...line }));
  const rates = [...new Set(result.map((line) => line.taxRate))];
  for (const rate of rates) {
    const group = result.filter((line) => line.taxRate === rate);
    const grossCents = group.reduce((sum, line) => sum + lineGross(line), 0);
    const estimate = Math.round(grossCents / (1 + rate / 100));
    const targetBase = [estimate, estimate - 1, estimate + 1, estimate - 2, estimate + 2].find((base) => base >= 0 && base + taxOnBaseCents(base, rate) === grossCents) ?? estimate;
    const diff = targetBase - group.reduce((sum, line) => sum + lineBase(line), 0);
    if (diff === 0) continue;
    const single = group
      .filter((line) => line.quantity === 1 && line.unitPrice * 100 + diff >= 0)
      .sort((a, b) => b.unitPrice - a.unitPrice)[0];
    if (single) {
      single.unitPrice = centsToNumber(roundHalfAwayFromZero(single.unitPrice * 100) + diff);
      continue;
    }
    // Todas con varias unidades: se separa una unidad con el precio ajustado (misma descripción y artículo).
    const multi = group.filter((line) => Number.isInteger(line.quantity) && line.quantity > 1 && line.unitPrice * 100 + diff >= 0).sort((a, b) => b.quantity - a.quantity)[0];
    if (!multi) continue;
    multi.quantity -= 1;
    result.splice(result.indexOf(multi) + 1, 0, { ...multi, key: `${multi.key}:redondeo`, quantity: 1, unitPrice: centsToNumber(roundHalfAwayFromZero(multi.unitPrice * 100) + diff) });
  }
  return result;
}

/** Totales del carrito idénticos a los de la factura emitida, con el total = suma de los PVP. */
export function cartTotals(lines: readonly CartLine[]): CartTotals {
  const settled = settleCartLines(lines);
  const document = computeEngineDocument(settled.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, taxes: legacyLineTaxes({ taxRate: line.taxRate }) })));
  return {
    subtotal: centsToNumber(document.subtotalCents),
    tax: centsToNumber(document.taxCents),
    total: centsToNumber(document.totalCents),
    taxBreakdown: document.buckets
      .filter((bucket) => bucket.operation === "ADD")
      .map((bucket) => ({ rate: bucket.rate, base: centsToNumber(bucket.baseCents), tax: centsToNumber(bucket.amountCents) }))
      .sort((a, b) => b.rate - a.rate),
    lines: lines.map((line) => ({ key: line.key, total: centsToNumber(lineGross(line)) })),
    settled,
  };
}

/** Precio con IVA de un precio sin IVA (lo que ve el cliente en el mostrador). */
export function grossPrice(netUnitPrice: number, taxRate: number) {
  return centsToNumber(amountToCents(netUnitPrice * (1 + taxRate / 100)));
}

/**
 * Precio sin IVA (2 decimales) que da exactamente el PVP tecleado. Algunos PVP no se pueden obtener
 * con 2 decimales (p. ej. 10,00 € al 21 %): se usa el más cercano y se indica la diferencia.
 */
export function netFromGross(gross: number, taxRate: number): { net: number; gross: number; exact: boolean } {
  const factor = 1 + taxRate / 100;
  const base = Math.round((gross / factor) * 100);
  let best = { net: base / 100, gross: grossPrice(base / 100, taxRate) };
  for (const candidate of [base - 1, base, base + 1]) {
    const net = candidate / 100;
    const result = grossPrice(net, taxRate);
    if (Math.abs(result - gross) < Math.abs(best.gross - gross) - 1e-9) best = { net, gross: result };
    if (amountToCents(result) === amountToCents(gross)) return { net, gross: result, exact: true };
  }
  return { ...best, exact: false };
}

export type PaymentSplit = { cash: number; card: number; cashReceived?: number | null };

/**
 * Valida el cobro: efectivo + tarjeta = total; lo entregado en efectivo cubre su parte. Devuelve el
 * cambio o el motivo del error.
 */
export function validatePayment(total: number, split: PaymentSplit): { ok: true; change: number } | { ok: false; message: string } {
  const totalCents = amountToCents(total);
  const cash = amountToCents(split.cash);
  const card = amountToCents(split.card);
  if (cash < 0 || card < 0) return { ok: false, message: "Los importes no pueden ser negativos." };
  if (cash + card !== totalCents) return { ok: false, message: `El cobro (${centsToNumber(cash + card).toFixed(2)}) no coincide con el total (${total.toFixed(2)}).` };
  const received = split.cashReceived === null || split.cashReceived === undefined ? cash : amountToCents(split.cashReceived);
  if (received < cash) return { ok: false, message: "Lo entregado en efectivo no llega." };
  return { ok: true, change: centsToNumber(received - cash) };
}

/** Billetes y monedas de euro para contar el cajón al cerrar. */
export const EURO_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;

export function countDenominations(counts: Partial<Record<string, number>>) {
  const cents = EURO_DENOMINATIONS.reduce((sum, denomination) => sum + Math.round(denomination * 100) * Math.max(0, Math.trunc(counts[String(denomination)] ?? 0)), 0);
  return centsToNumber(cents);
}

export type SessionMovements = {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
};

/** Efectivo que debería haber en el cajón. */
export function expectedCash(movements: SessionMovements) {
  return centsToNumber(
    amountToCents(movements.openingCash) + amountToCents(movements.cashSales) - amountToCents(movements.cashRefunds) + amountToCents(movements.cashIn) - amountToCents(movements.cashOut),
  );
}

/** El ticket supera el límite de la factura simplificada (hay que identificar al cliente). */
export function exceedsSimplifiedLimit(total: number, limit: number) {
  return amountToCents(total) > amountToCents(limit);
}
