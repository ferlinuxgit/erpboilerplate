import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: drizzle.mock() }));

import { customerFormSchema, isValidIban } from "@/server/customers/schemas";
import { assertCustomerDeletable, billingValues, CUSTOMER_HAS_DOCUMENTS_MESSAGE, customerBalanceQuery } from "@/server/customers/service";

function countClient(counts: number[]) {
  const queue = [...counts];
  return {
    select: () => ({
      from: () => ({
        where: async () => [{ value: queue.shift() ?? 0 }],
      }),
    }),
  } as never;
}

describe("saldo del cliente", () => {
  it("Facturado excluye borradores y anuladas; Pendiente es neto de cobros y rectificativas", () => {
    const query = customerBalanceQuery("company-1", "customer-1").toSQL();
    const text = query.sql.replace(/\s+/g, " ");
    // Facturado: solo facturas con validez fiscal (emitidas, no anuladas, no borradores).
    expect(text).toContain(`sum(case when ("invoice"."status" <> $`);
    expect(text).toContain(`not ("invoice"."issuedAt" is null and "invoice"."number" like $`);
    // Pendiente: total + rectificativas emitidas − cobros, nunca negativo, 0 en borradores.
    expect(text).toContain(`greatest("invoice"."totalAmount" + coalesce("creditedAmount", 0) - coalesce("paidAmount", 0), 0)`);
    expect(text).toContain(`from "invoice" "customer_credited_note"`);
    expect(text).toContain(`from "invoice_payment"`);
    expect(query.params).toEqual(expect.arrayContaining(["company-1", "customer-1", "BORRADOR-%", "CREDIT_NOTE"]));
  });
});

describe("eliminar cliente", () => {
  it("con documentos responde 409 y ofrece marcarlo como inactivo", async () => {
    await expect(assertCustomerDeletable(countClient([2, 0, 0, 0]), "company-1", "customer-1")).rejects.toMatchObject({ status: 409, message: CUSTOMER_HAS_DOCUMENTS_MESSAGE });
    await expect(assertCustomerDeletable(countClient([0, 1, 0, 0]), "company-1", "customer-1")).rejects.toMatchObject({ status: 409 });
    await expect(assertCustomerDeletable(countClient([0, 0, 0, 0]), "company-1", "customer-1")).resolves.toBeUndefined();
  });
});

describe("condiciones de facturación del cliente", () => {
  const base = { name: "Acme SARL", taxId: "FR12345678901", address: "1 rue X", postalCode: "75001", city: "París", province: "París", countryCode: "FR" };

  it("valida país ISO, IBAN y días de pago", () => {
    expect(customerFormSchema.safeParse({ ...base, paymentTermsDays: 45, defaultRetentionRate: 15, iban: "ES91 2100 0418 4502 0005 1332" }).success).toBe(true);
    expect(customerFormSchema.safeParse({ ...base, countryCode: "XX" }).success).toBe(false);
    expect(customerFormSchema.safeParse({ ...base, iban: "ES00 1234" }).success).toBe(false);
    expect(customerFormSchema.safeParse({ ...base, paymentTermsDays: -1 }).success).toBe(false);
    expect(customerFormSchema.safeParse({ ...base, defaultVatTreatment: "INTRA_EU_SERVICES" }).success).toBe(true);
    expect(isValidIban("ES9121000418450200051332")).toBe(true);
  });

  it("solo actualiza los campos presentes y normaliza vacíos a null", () => {
    expect(billingValues({})).toEqual({});
    expect(billingValues({ defaultRetentionRate: 15, iban: "es91 2100 0418 4502 0005 1332", invoiceEmail: "", defaultVatTreatment: "" })).toEqual({
      defaultRetentionRate: "15.000",
      iban: "ES9121000418450200051332",
      invoiceEmail: null,
      defaultVatTreatment: null,
    });
    expect(billingValues({ defaultRetentionRate: 0 })).toEqual({ defaultRetentionRate: null });
  });
});
