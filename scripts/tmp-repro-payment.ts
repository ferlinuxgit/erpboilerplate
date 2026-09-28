/**
 * TEMPORARY diagnostic (not committed): reproduces "registrar cobro" against the configured
 * database inside a transaction that is ALWAYS rolled back, to surface the real server error.
 */
import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";

import { company, fiscalYear, invoice, membership, paymentMethod } from "@/db/schema";
import { db } from "@/lib/db";
import { registerInvoicePayment } from "@/server/invoices/payments";

class Rollback extends Error {}

async function main() {
  const candidates = await db
    .select({ id: invoice.id, number: invoice.number, companyId: invoice.companyId, total: invoice.totalAmount, paymentStatus: invoice.paymentStatus })
    .from(invoice)
    .where(and(inArray(invoice.paymentStatus, ["PENDING", "PARTIAL", "OVERDUE"]), eq(invoice.invoiceType, "INVOICE"), sql`${invoice.issuedAt} is not null`))
    .limit(5);
  console.log("candidates:", candidates.map((row) => `${row.number} ${row.paymentStatus} ${row.total}`).join(" | "));
  for (const target of candidates.slice(0, 2)) {
    const [co] = await db.select({ id: company.id, tenantId: company.tenantId, name: company.name }).from(company).where(eq(company.id, target.companyId)).limit(1);
    const [owner] = await db.select({ userId: membership.userId }).from(membership).where(eq(membership.tenantId, co.tenantId)).limit(1);
    const [method] = await db.select({ id: paymentMethod.id, name: paymentMethod.name }).from(paymentMethod).where(eq(paymentMethod.companyId, co.id)).limit(1);
    const now = new Date();
    const [year] = await db
      .select({ id: fiscalYear.id, code: fiscalYear.code })
      .from(fiscalYear)
      .where(and(eq(fiscalYear.companyId, co.id), sql`${fiscalYear.startsAt} <= ${now} and ${fiscalYear.endsAt} >= ${now}`))
      .limit(1);
    console.log(`\n== ${co.name} · factura ${target.number} · forma de pago ${method?.name} · ejercicio ${year?.code}`);
    try {
      await db.transaction(async (tx) => {
        const result = await registerInvoicePayment(
          { tenantId: co.tenantId, companyId: co.id, actorUserId: owner.userId, activeFiscalYearId: year.id },
          { invoiceId: target.id, amountApplied: 0.01, postedAt: now, paymentMethodId: method.id },
          tx,
        );
        console.log("OK (se deshace):", result.payment.number);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) {
        console.log("rolled back");
        continue;
      }
      const err = error as Error & { cause?: unknown; code?: string; detail?: string; constraint?: string };
      console.log("ERROR:", err.name, err.message);
      const cause = err.cause as (Error & { code?: string; detail?: string; constraint?: string }) | undefined;
      if (cause) console.log("CAUSE:", cause.message, cause.code ?? "", cause.detail ?? "", cause.constraint ?? "");
      console.log(err.stack?.split("\n").slice(0, 8).join("\n"));
    }
  }
  process.exit(0);
}

void main();
