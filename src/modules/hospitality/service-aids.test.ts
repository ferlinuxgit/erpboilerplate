import { describe, expect, it } from "vitest";

import { attentionFor, latestRound, productionSummary } from "./service-aids";

const line = (overrides: Partial<Parameters<typeof latestRound>[0][number]> = {}) => ({ id: crypto.randomUUID(), itemId: "cana", station: "BAR", status: "SERVED", sentAt: "2026-10-19T20:00:00.000Z", parentLineId: null, unitPrice: 2, note: null, quantity: 1, modifiers: [], ...overrides });

describe("resumen de producción de cocina", () => {
  it("suma el mismo plato de todas las comandas y deja fuera lo listo y lo que espera su tiempo", () => {
    const summary = productionSummary([
      { lines: [{ description: "Croquetas", quantity: 2, status: "SENT", held: false }, { description: "Entrecot", quantity: 1, status: "SENT", held: false }] },
      { lines: [{ description: "Croquetas", quantity: 4, status: "SENT", held: false }, { description: "Entrecot", quantity: 2, status: "SENT", held: true }, { description: "Ensalada", quantity: 1, status: "READY", held: false }] },
    ]);
    expect(summary).toEqual([{ description: "Croquetas", quantity: 6 }, { description: "Entrecot", quantity: 1 }]);
  });
});

describe("otra ronda", () => {
  it("repite lo último enviado que no es de cocina, sumando el mismo producto", () => {
    const round = latestRound([
      line({ itemId: "cana", sentAt: "2026-10-19T19:00:00.000Z", quantity: 4 }),
      line({ itemId: "cana", quantity: 2 }),
      line({ itemId: "cana", quantity: 1 }),
      line({ itemId: "vino", quantity: 1 }),
      line({ itemId: "croquetas", station: "KITCHEN", quantity: 1 }),
    ]);
    expect(round.map((entry) => [entry.itemId, entry.quantity])).toEqual([["cana", 3], ["vino", 1]]);
  });

  it("no repite lo anulado, lo pendiente, los menús ni lo que lleva opciones", () => {
    const menu = line({ itemId: "menu" });
    expect(latestRound([
      line({ status: "CANCELLED" }),
      line({ status: "PENDING", sentAt: null }),
      menu,
      line({ itemId: "plato", parentLineId: menu.id }),
      line({ itemId: "gin", modifiers: [{ group: "Tónica", name: "Premium", price: 1 }] }),
    ])).toEqual([]);
  });
});

describe("mesas que necesitan atención", () => {
  const now = new Date("2026-10-19T21:00:00.000Z");
  const order = { status: "OPEN", unsent: 0, ready: 0, openedAt: "2026-10-19T20:50:00.000Z", lastOrderAt: null as string | null };

  it("abierta sin pedir nada desde hace 5 minutos: hay que tomar nota", () => {
    expect(attentionFor(order, now)).toEqual({ kind: "unattended", minutes: 10 });
    expect(attentionFor({ ...order, openedAt: "2026-10-19T20:57:00.000Z" }, now)).toBeNull();
  });

  it("todo servido y sin pedir en 25 minutos: ofrecer postre o café; no si pide la cuenta o hay algo listo", () => {
    const idle = { ...order, lastOrderAt: "2026-10-19T20:30:00.000Z" };
    expect(attentionFor(idle, now)).toEqual({ kind: "idle", minutes: 30 });
    expect(attentionFor({ ...idle, status: "BILL_REQUESTED" }, now)).toBeNull();
    expect(attentionFor({ ...idle, ready: 2 }, now)).toBeNull();
    expect(attentionFor({ ...idle, unsent: 1 }, now)).toBeNull();
  });
});
