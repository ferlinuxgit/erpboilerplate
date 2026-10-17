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
  /** Diferencia (≤ 0) entre el total y la suma de los PVP cuando el IVA no permite cuadrarlos al céntimo. */
  rounding: number;
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
    const candidates = [estimate, estimate - 1, estimate + 1, estimate - 2, estimate + 2].filter((base) => base >= 0);
    // Exacto si existe; si no (2 × 2,00 € al 21 % no tiene base exacta), el más cercano sin cobrar de más.
    const targetBase = candidates.find((base) => base + taxOnBaseCents(base, rate) === grossCents)
      ?? candidates.filter((base) => base + taxOnBaseCents(base, rate) <= grossCents).sort((a, b) => b - a)[0]
      ?? estimate;
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
    rounding: centsToNumber(document.totalCents - lines.reduce((sum, line) => sum + lineGross(line), 0)),
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
  const target = amountToCents(gross);
  const options = [base - 2, base - 1, base, base + 1, base + 2].filter((cents) => cents >= 0).map((cents) => ({ net: cents / 100, gross: grossPrice(cents / 100, taxRate) }));
  const exact = options.find((option) => amountToCents(option.gross) === target);
  if (exact) return { ...exact, exact: true };
  // Sin base exacta: la más cercana que no supere el PVP (nunca se cobra de más).
  const below = options.filter((option) => amountToCents(option.gross) < target).sort((a, b) => b.gross - a.gross)[0];
  return { ...(below ?? options[0]), exact: false };
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

export type RefundMethod = "cash" | "card";

/**
 * Reparte el importe de una devolución entre lo cobrado en efectivo y con tarjeta: primero por la vía
 * elegida (hasta lo que se cobró por ella) y el resto por la otra.
 */
export function splitRefund(amount: number, paid: { cash: number; card: number }, preferred: RefundMethod): { cash: number; card: number } | null {
  const total = amountToCents(amount);
  const available = { cash: amountToCents(paid.cash), card: amountToCents(paid.card) };
  if (total <= 0 || total > available.cash + available.card) return null;
  const other: RefundMethod = preferred === "cash" ? "card" : "cash";
  const first = Math.min(total, available[preferred]);
  const second = total - first;
  const result = { cash: 0, card: 0 };
  result[preferred] = first;
  result[other] = second;
  return { cash: centsToNumber(result.cash), card: centsToNumber(result.card) };
}

/** Unidades que quedan por devolver de cada línea del ticket. */
export function remainingQuantities(lines: ReadonlyArray<{ id: string; quantity: number }>, returned: ReadonlyArray<{ lineId: string; quantity: number }>) {
  const used = new Map<string, number>();
  for (const entry of returned) used.set(entry.lineId, (used.get(entry.lineId) ?? 0) + entry.quantity);
  return new Map(lines.map((line) => [line.id, Math.max(0, Math.round((line.quantity - (used.get(line.id) ?? 0)) * 1000) / 1000)]));
}

export type SalesDay = { key: string; label: string; longLabel: string };

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Ventas netas del TPV por día (ventas − devoluciones) de los últimos `days` días, en la zona horaria
 * de la empresa, con el número de tickets de venta.
 */
export function dailySales(tickets: ReadonlyArray<{ kind: string; total: number; createdAt: Date | string }>, now = new Date(), days = 30, timeZone = "Europe/Madrid") {
  const short = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone });
  const long = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone });
  const categories: SalesDay[] = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - (days - 1 - index) * 86_400_000);
    return { key: dayKey(date, timeZone), label: short.format(date).replace(".", ""), longLabel: long.format(date) };
  });
  const position = new Map(categories.map((day, index) => [day.key, index]));
  const net = categories.map(() => 0);
  const count = categories.map(() => 0);
  for (const ticket of tickets) {
    const index = position.get(dayKey(new Date(ticket.createdAt), timeZone));
    if (index === undefined) continue;
    const cents = amountToCents(ticket.total);
    net[index] += ticket.kind === "REFUND" ? -cents : cents;
    if (ticket.kind === "SALE") count[index] += 1;
  }
  return { categories, net: net.map(centsToNumber), count };
}
