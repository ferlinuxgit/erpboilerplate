/**
 * Modelo de hostelería (sin servidor): importes de una cuenta de mesa, lo que queda por cobrar y cómo
 * se reparte al dividirla (por productos o a partes iguales), con los mismos cálculos que el ticket.
 */

import { cartTotals, grossPrice, netFromGross, type CartLine } from "@/modules/pos/model";
import { amountToCents, centsToNumber } from "@/server/taxation/engine";

export const STATIONS = ["KITCHEN", "BAR", "NONE"] as const;
export type Station = (typeof STATIONS)[number];
export const stationLabels: Record<Station, string> = { KITCHEN: "Cocina", BAR: "Barra", NONE: "Sin comanda" };

export const LINE_STATUSES = ["PENDING", "SENT", "READY", "SERVED", "CANCELLED"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const lineStatusLabels: Record<LineStatus, string> = { PENDING: "Sin enviar", SENT: "En preparación", READY: "Listo", SERVED: "Servido", CANCELLED: "Anulado" };

export type OrderStatus = "OPEN" | "BILL_REQUESTED" | "PAID" | "CANCELLED";

export type OrderLine = {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  /** Precio sin IVA (2 decimales). */
  unitPrice: number;
  taxRate: number;
  taxId: string | null;
  note: string | null;
  station: Station;
  status: LineStatus;
  paidQuantity: number;
};

export type EqualSplit = { parts: number; paid: number; paidByRate: Record<string, number> };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Unidades de cada línea que faltan por cobrar (las anuladas no cuentan). */
export function unpaidLines(lines: readonly OrderLine[]) {
  return lines
    .filter((line) => line.status !== "CANCELLED")
    .map((line) => ({ ...line, unpaid: round3(line.quantity - line.paidQuantity) }))
    .filter((line) => line.unpaid > 0);
}

const toCart = (line: Pick<OrderLine, "id" | "itemId" | "description" | "unitPrice" | "taxRate" | "taxId">, quantity: number, key = line.id): CartLine => ({
  key,
  itemId: line.itemId,
  description: line.description,
  quantity,
  unitPrice: line.unitPrice,
  taxRate: line.taxRate,
  taxId: line.taxId,
});

/** Importe con IVA por tipo (en céntimos) de unas líneas, sumando los PVP como en el ticket. */
function grossByRate(lines: ReadonlyArray<{ unitPrice: number; taxRate: number; quantity: number }>) {
  const byRate = new Map<number, number>();
  for (const line of lines) byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + amountToCents(grossPrice(line.unitPrice, line.taxRate) * line.quantity));
  return byRate;
}

/** Total de la cuenta, cobrado y pendiente (con IVA). */
export function orderAmounts(lines: readonly OrderLine[], equalSplit?: EqualSplit | null) {
  const active = lines.filter((line) => line.status !== "CANCELLED");
  const total = cartTotals(active.map((line) => toCart(line, line.quantity))).total;
  const unpaid = unpaidLines(lines);
  const pendingGross = [...grossByRate(unpaid.map((line) => ({ ...line, quantity: line.unpaid }))).values()].reduce((sum, cents) => sum + cents, 0);
  const equalPaid = equalSplit ? Object.values(equalSplit.paidByRate).reduce((sum, cents) => sum + cents, 0) : 0;
  const pending = centsToNumber(Math.max(0, pendingGross - equalPaid));
  return { total, pending, paid: centsToNumber(Math.max(0, amountToCents(total) - amountToCents(pending))) };
}

export type BillPart =
  | { mode: "all" }
  | { mode: "lines"; lines: ReadonlyArray<{ lineId: string; quantity: number }> }
  | { mode: "equal"; parts: number };

/**
 * Líneas del ticket de una parte de la cuenta:
 * - all: todo lo pendiente;
 * - lines: las unidades elegidas (no más de las pendientes);
 * - equal: una de `parts` partes iguales de lo pendiente, una línea por tipo de IVA; la última parte
 *   se lleva el resto de céntimos.
 * Devuelve también cómo queda la cuenta después (unidades cobradas y progreso de la división).
 */
export function billPartLines(
  lines: readonly OrderLine[],
  part: BillPart,
  equalSplit: EqualSplit | null,
  label: string,
): { cart: CartLine[]; paidQuantities: Map<string, number>; equalSplit: EqualSplit | null; closes: boolean } | { error: string } {
  const unpaid = unpaidLines(lines);
  if (unpaid.length === 0) return { error: "No queda nada por cobrar en esta cuenta." };

  if (part.mode === "lines") {
    if (equalSplit) return { error: "Esta cuenta se está pagando a partes iguales: termina las partes o cóbrala entera." };
    const paidQuantities = new Map<string, number>();
    const cart: CartLine[] = [];
    for (const entry of part.lines) {
      if (!(entry.quantity > 0)) continue;
      const line = unpaid.find((candidate) => candidate.id === entry.lineId);
      if (!line) return { error: "Esa línea no está pendiente de cobro." };
      if (entry.quantity > line.unpaid + 0.0005) return { error: `De «${line.description}» solo quedan ${line.unpaid.toLocaleString("es-ES")} por cobrar.` };
      cart.push(toCart(line, entry.quantity));
      paidQuantities.set(line.id, round3(line.paidQuantity + entry.quantity));
    }
    if (cart.length === 0) return { error: "Elige qué se cobra." };
    const closes = unpaid.every((line) => Math.abs((paidQuantities.get(line.id) ?? line.paidQuantity) - line.quantity) < 0.0005);
    return { cart, paidQuantities, equalSplit: null, closes };
  }

  const allPaid = new Map(unpaid.map((line) => [line.id, line.quantity]));
  if (part.mode === "all" && !equalSplit) {
    return { cart: unpaid.map((line) => toCart(line, line.unpaid)), paidQuantities: allPaid, equalSplit: null, closes: true };
  }

  // A partes iguales (o el resto de una división en curso): una línea por tipo de IVA.
  const parts = part.mode === "equal" ? (equalSplit?.parts ?? part.parts) : (equalSplit?.parts ?? 1);
  if (!Number.isInteger(parts) || parts < 2 || parts > 50) {
    if (part.mode === "equal") return { error: "Divide entre 2 y 50 partes." };
  }
  const split: EqualSplit = equalSplit ?? { parts, paid: 0, paidByRate: {} };
  const remainingParts = part.mode === "all" ? 1 : split.parts - split.paid;
  const byRate = grossByRate(unpaid.map((line) => ({ ...line, quantity: line.unpaid })));
  const cart: CartLine[] = [];
  const paidByRate = { ...split.paidByRate };
  const partNumber = split.paid + 1;
  for (const [rate, grossCents] of byRate) {
    const left = grossCents - (split.paidByRate[String(rate)] ?? 0);
    const partCents = remainingParts <= 1 ? left : Math.floor(left / remainingParts);
    if (partCents <= 0) continue;
    paidByRate[String(rate)] = (paidByRate[String(rate)] ?? 0) + partCents;
    const gross = centsToNumber(partCents);
    cart.push({
      key: `part-${partNumber}-${rate}`,
      itemId: null,
      description: part.mode === "all" && !equalSplit ? label : `${label} · parte ${remainingParts <= 1 ? split.parts : partNumber} de ${split.parts}${byRate.size > 1 ? ` (IVA ${rate} %)` : ""}`,
      quantity: 1,
      unitPrice: netFromGross(gross, rate).net,
      taxRate: rate,
      taxId: null,
    });
  }
  if (cart.length === 0) return { error: "No queda nada por cobrar en esta cuenta." };
  // Lo cobrado de verdad por tipo (si el IVA no cuadra al céntimo, el ticket cobra algo menos): la
  // última parte se lleva el resto real.
  const charged = cartTotals(cart).taxBreakdown;
  for (const [rate] of byRate) {
    const bucket = charged.find((entry) => entry.rate === rate);
    if (bucket) paidByRate[String(rate)] = (split.paidByRate[String(rate)] ?? 0) + amountToCents(bucket.base + bucket.tax);
  }
  const closes = remainingParts <= 1;
  return {
    cart,
    paidQuantities: closes ? allPaid : new Map(),
    equalSplit: closes ? null : { parts: split.parts, paid: split.paid + 1, paidByRate },
    closes,
  };
}

/** Minutos que lleva abierta una mesa o esperando una comanda (para el plano y la cocina). */
export function minutesSince(date: Date | string, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / 60_000));
}

export function formatElapsed(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Estado de una mesa para el plano. */
export type TableState = "FREE" | "OPEN" | "BILL_REQUESTED";
