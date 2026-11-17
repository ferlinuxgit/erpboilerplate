import { minutesSince } from "./model";

/*
 * Ayudas del servicio en sala y cocina (sin servidor): resumen de producción, «otra ronda» y avisos
 * de mesas que necesitan atención.
 */

type KitchenLineLike = { description: string; quantity: number; status: string; held: boolean };

/** Lo que hay que preparar ahora sumando todas las comandas: «6 croquetas, 4 entrecots». */
export function productionSummary(batches: ReadonlyArray<{ lines: readonly KitchenLineLike[] }>) {
  const totals = new Map<string, number>();
  for (const batch of batches) {
    for (const line of batch.lines) {
      if (line.held || line.status !== "SENT") continue;
      totals.set(line.description, (totals.get(line.description) ?? 0) + line.quantity);
    }
  }
  return [...totals.entries()].map(([description, quantity]) => ({ description, quantity })).sort((a, b) => b.quantity - a.quantity || a.description.localeCompare(b.description, "es"));
}

type RoundLineLike = { id: string; itemId: string | null; station: string; status: string; sentAt: string | null; parentLineId: string | null; unitPrice: number; note: string | null; quantity: number; modifiers?: readonly unknown[] };

/**
 * La última ronda para «Otra ronda»: lo enviado a la vez (mismo envío) que no es de cocina, sin
 * menús ni productos con opciones (esos se eligen otra vez). El mismo producto se suma en una línea.
 */
export function latestRound<T extends RoundLineLike>(lines: readonly T[]): T[] {
  const candidates = lines.filter((line) => line.station !== "KITCHEN" && line.status !== "CANCELLED" && line.status !== "PENDING" && line.sentAt && !line.parentLineId && line.itemId && (line.modifiers ?? []).length === 0 && !lines.some((child) => child.parentLineId === line.id));
  if (candidates.length === 0) return [];
  const last = candidates.reduce((latest, line) => (line.sentAt! > latest ? line.sentAt! : latest), "");
  const merged = new Map<string, T>();
  for (const line of candidates.filter((entry) => entry.sentAt === last)) {
    const key = `${line.itemId}|${line.unitPrice}|${line.note ?? ""}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + line.quantity } : line);
  }
  return [...merged.values()];
}

// Mesa abierta sin pedir nada: alguien tiene que tomar nota.
export const UNATTENDED_MINUTES = 5;
// Todo servido y sin pedir nada en este rato: buen momento para ofrecer postres o cafés.
export const IDLE_MINUTES = 25;

type AttentionOrder = { status: string; unsent: number; ready: number; openedAt: string | Date; lastOrderAt: string | Date | null };

/** Aviso de atención de una mesa abierta (null si va bien). */
export function attentionFor(order: AttentionOrder, now: Date): { kind: "unattended" | "idle"; minutes: number } | null {
  if (order.status === "BILL_REQUESTED" || order.unsent > 0) return null;
  if (!order.lastOrderAt) {
    const minutes = minutesSince(order.openedAt, now);
    return minutes >= UNATTENDED_MINUTES ? { kind: "unattended", minutes } : null;
  }
  const minutes = minutesSince(order.lastOrderAt, now);
  return minutes >= IDLE_MINUTES && order.ready === 0 ? { kind: "idle", minutes } : null;
}
