import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { assertQuoteStatusChange, quoteConversionBlocker } from "@/server/sales/service";

const none = { orders: 0, invoices: 0 };

describe("estados del presupuesto", () => {
  it("permite Enviado → Aceptado / Rechazado y anular", () => {
    expect(() => assertQuoteStatusChange("DRAFT", "SENT", none)).not.toThrow();
    expect(() => assertQuoteStatusChange("SENT", "CONFIRMED", none)).not.toThrow();
    expect(() => assertQuoteStatusChange("SENT", "REJECTED", none)).not.toThrow();
    expect(() => assertQuoteStatusChange("REJECTED", "VOID", none)).not.toThrow();
  });

  it("bloquea cambios sin sentido o en presupuestos ya convertidos", () => {
    expect(() => assertQuoteStatusChange("SENT", "SENT", none)).toThrow(/ya está en ese estado/);
    expect(() => assertQuoteStatusChange("VOID", "CONFIRMED", none)).toThrow();
    expect(() => assertQuoteStatusChange("CONFIRMED", "REJECTED", { orders: 1, invoices: 0 })).toThrow(/ya se convirtió/);
  });

  it("un presupuesto aceptado se puede convertir en pedido o factura una sola vez", () => {
    expect(quoteConversionBlocker("CONFIRMED", none)).toBeNull();
    expect(quoteConversionBlocker("DRAFT", none)).toBeNull();
    expect(quoteConversionBlocker("CONFIRMED", { orders: 0, invoices: 1 })).toMatch(/ya se convirtió/);
    expect(quoteConversionBlocker("REJECTED", none)).toMatch(/rechazó/);
    expect(quoteConversionBlocker("VOID", none)).toMatch(/anulado/);
  });
});
