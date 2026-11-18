import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { stripeInvoiceToDraft } from "@/lib/billing/platform-invoice-draft";

function paid(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "in_123",
    created: 1_796_000_000,
    status_transitions: { paid_at: 1_796_000_000 },
    customer_name: "Bar Pepe SL",
    customer_email: "pepe@example.com",
    customer_tax_ids: [{ type: "es_cif", value: "B12345674" }],
    customer_address: { line1: "Calle Mayor 1", line2: null, postal_code: "28013", city: "Madrid", state: "Madrid", country: "ES" },
    subtotal: 2100,
    subtotal_excluding_tax: 2100,
    total_excluding_tax: 2100,
    total: 2541,
    amount_paid: 2541,
    lines: { data: [{ description: "Plan Contabilidad y facturación", amount: 900, quantity: 1 }, { description: "Módulo TPV", amount: 1200, quantity: 1 }] },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

describe("factura legal de un cobro de Stripe", () => {
  it("cliente español: IVA del 21 % y una línea por concepto", () => {
    const draft = stripeInvoiceToDraft(paid());
    expect(draft).toMatchObject({ vatTreatment: "DOMESTIC", taxRate: 21, customer: { taxId: "B12345674", countryCode: "ES" }, issueDate: "2026-11-30" });
    expect("lines" in draft && draft.lines).toEqual([
      { description: "Plan Contabilidad y facturación", quantity: 1, unitPrice: 9, taxRate: 21 },
      { description: "Módulo TPV", quantity: 1, unitPrice: 12, taxRate: 21 },
    ]);
  });

  it("empresa de la UE sin IVA: servicio intracomunitario; fuera de la UE o Canarias: no sujeta", () => {
    const noTax = { total: 2100, amount_paid: 2100 };
    expect(stripeInvoiceToDraft(paid({ ...noTax, customer_tax_ids: [{ type: "eu_vat", value: "FR40303265045" }], customer_address: { line1: "1 rue", postal_code: "75001", city: "Paris", country: "FR" } }))).toMatchObject({ vatTreatment: "INTRA_EU_SERVICES", taxRate: 0 });
    expect(stripeInvoiceToDraft(paid({ ...noTax, customer_address: { line1: "Calle 1", postal_code: "38001", city: "Santa Cruz", state: "Tenerife", country: "ES" } }))).toMatchObject({ vatTreatment: "NOT_SUBJECT" });
    expect(stripeInvoiceToDraft(paid({ ...noTax, customer_address: { line1: "Main St", postal_code: "10001", city: "New York", country: "US" } }))).toMatchObject({ vatTreatment: "NOT_SUBJECT" });
  });

  it("lo que no encaja se deja para emitir a mano (sin NIF, IVA de otro país, español sin IVA)", () => {
    expect(stripeInvoiceToDraft(paid({ customer_tax_ids: [] }))).toMatchObject({ problem: expect.stringContaining("NIF") });
    expect(stripeInvoiceToDraft(paid({ total: 2520 }))).toMatchObject({ problem: expect.stringContaining("20 %") });
    expect(stripeInvoiceToDraft(paid({ total: 2100 }))).toMatchObject({ problem: expect.stringContaining("Stripe Tax") });
  });
});
