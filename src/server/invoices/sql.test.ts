import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: drizzle.mock() }));

import { invoice } from "@/db/schema";
import { db } from "@/lib/db";
import {
  creditedByInvoiceSubquery,
  invoiceIsIssuedSql,
  invoiceLifecycleSql,
  netOutstandingSql,
  paidByInvoiceSubquery,
} from "@/server/invoices/sql";

function listQuery(companyId: string) {
  const paid = paidByInvoiceSubquery(companyId);
  const credited = creditedByInvoiceSubquery(companyId);
  return db
    .select({ id: invoice.id, lifecycle: invoiceLifecycleSql, outstanding: netOutstandingSql(paid, credited) })
    .from(invoice)
    .leftJoin(paid, eq(paid.invoiceId, invoice.id))
    .leftJoin(credited, eq(credited.invoiceId, invoice.id))
    .where(invoiceIsIssuedSql)
    .toSQL();
}

describe("invoice SQL helpers", () => {
  it("nets issued, non-void credit notes and payments into the outstanding in one query", () => {
    const query = listQuery("company-1");
    const text = query.sql.replace(/\s+/g, " ");
    // Credit notes are read from an alias of the invoice table, grouped by the rectified invoice.
    expect(text).toContain(`from "invoice" "credited_by_invoice_note"`);
    expect(text).toContain(`group by "credited_by_invoice_note"."rectifiedInvoiceId"`);
    expect(text).toContain(`"credited_by_invoice_note"."issuedAt" is not null`);
    expect(text).toContain(`"invoice"."totalAmount" + coalesce("creditedAmount", 0) - coalesce("paidAmount", 0)`);
    expect(text).toContain(`on "creditedInvoiceId" = "invoice"."id"`);
    // Drafts (provisional number, never issued) are excluded and owe nothing.
    expect(text).toContain(`"invoice"."issuedAt" is null and "invoice"."number" like $`);
    expect(query.params).toEqual(expect.arrayContaining(["company-1", "CREDIT_NOTE", "VOID", "BORRADOR-%"]));
  });
});
