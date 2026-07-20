import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { bankAccount, bankTransaction, customer, invoice, invoicePayment, partner, payment, supplierInvoice, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { autoReconcileBankTransactions } from "@/server/treasury/reconciliation";

const manualSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("match"), transactionId: z.string().min(1), kind: z.enum(["customer", "supplier"]), matchId: z.string().min(1) }),
  z.object({ action: z.literal("unmatch"), transactionId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const transactionId = new URL(request.url).searchParams.get("transactionId");
  if (!transactionId) return NextResponse.json({ message: "Movimiento obligatorio." }, { status: 400 });
  const [row] = await db.select({ id: bankTransaction.id, amount: bankTransaction.amount, status: bankTransaction.reconciliationStatus })
    .from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankTransaction.id, transactionId), eq(bankAccount.companyId, ctx.company.id))).limit(1);
  if (!row) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
  if (row.status === "RECONCILED") return NextResponse.json({ kind: Number(row.amount) >= 0 ? "customer" : "supplier", candidates: [] });

  const amount = Math.abs(Number(row.amount)).toFixed(2);
  const used = await db.select({ invoicePaymentId: bankTransaction.matchedInvoicePaymentId, supplierPaymentId: bankTransaction.matchedSupplierPaymentId })
    .from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
    .where(and(eq(bankAccount.companyId, ctx.company.id), eq(bankTransaction.reconciliationStatus, "RECONCILED")));
  if (Number(row.amount) >= 0) {
    const usedIds = new Set(used.map((entry) => entry.invoicePaymentId).filter(Boolean));
    const candidates = (await db.select({ id: invoicePayment.id, number: invoice.number, counterparty: customer.name, amount: invoicePayment.amountApplied, postedAt: payment.postedAt })
      .from(invoicePayment).innerJoin(invoice, eq(invoice.id, invoicePayment.invoiceId)).innerJoin(customer, eq(customer.id, invoice.customerId)).innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .where(and(eq(invoicePayment.companyId, ctx.company.id), eq(invoicePayment.amountApplied, amount))))
      .filter((candidate) => !usedIds.has(candidate.id));
    return NextResponse.json({ kind: "customer", candidates });
  }
  const usedIds = new Set(used.map((entry) => entry.supplierPaymentId).filter(Boolean));
  const candidates = (await db.select({ id: supplierInvoicePayment.id, number: supplierInvoice.number, counterparty: partner.name, amount: supplierInvoicePayment.amountApplied, postedAt: supplierPayment.postedAt })
    .from(supplierInvoicePayment).innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoicePayment.supplierInvoiceId)).innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId)).innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
    .where(and(eq(supplierInvoicePayment.companyId, ctx.company.id), eq(supplierInvoicePayment.amountApplied, amount))))
    .filter((candidate) => !usedIds.has(candidate.id));
  return NextResponse.json({ kind: "supplier", candidates });
}

export async function POST() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const result = await autoReconcileBankTransactions(ctx.company.id);
  await recordAudit({
    tenantId: ctx.tenant.id,
    companyId: ctx.company.id,
    actorUserId: session.user.id,
    action: "treasury.reconcile.auto",
    entityName: "bankTransaction",
    entityId: ctx.company.id,
    payload: result,
  });
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = manualSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      const [bankRow] = await tx.select({ id: bankTransaction.id, amount: bankTransaction.amount, status: bankTransaction.reconciliationStatus })
        .from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
        .where(and(eq(bankTransaction.id, parsed.data.transactionId), eq(bankAccount.companyId, ctx.company.id))).for("update").limit(1);
      if (!bankRow) return null;

      if (parsed.data.action === "unmatch") {
        if (bankRow.status !== "RECONCILED") throw new Error("El movimiento ya está pendiente.");
        const [updated] = await tx.update(bankTransaction).set({ reconciliationStatus: "PENDING", matchedInvoicePaymentId: null, matchedSupplierPaymentId: null, reconciledAt: null }).where(eq(bankTransaction.id, bankRow.id)).returning();
        await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "treasury.reconcile.undo", entityName: "bankTransaction", entityId: bankRow.id }, tx);
        return updated;
      }

      if (bankRow.status === "RECONCILED") throw new Error("El movimiento ya está conciliado.");
      const expectedKind = Number(bankRow.amount) >= 0 ? "customer" : "supplier";
      if (parsed.data.kind !== expectedKind) throw new Error("La contrapartida no coincide con el signo del movimiento.");
      const amount = Math.abs(Number(bankRow.amount)).toFixed(2);
      if (parsed.data.kind === "customer") {
        const [candidate] = await tx.select({ id: invoicePayment.id }).from(invoicePayment).where(and(eq(invoicePayment.id, parsed.data.matchId), eq(invoicePayment.companyId, ctx.company.id), eq(invoicePayment.amountApplied, amount))).limit(1);
        if (!candidate) throw new Error("El cobro no existe o no coincide en importe.");
        const [alreadyUsed] = await tx.select({ id: bankTransaction.id }).from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId)).where(and(eq(bankAccount.companyId, ctx.company.id), eq(bankTransaction.matchedInvoicePaymentId, candidate.id))).limit(1);
        if (alreadyUsed) throw new Error("El cobro ya está conciliado con otro movimiento.");
        const [updated] = await tx.update(bankTransaction).set({ reconciliationStatus: "RECONCILED", matchedInvoicePaymentId: candidate.id, matchedSupplierPaymentId: null, reconciledAt: new Date() }).where(eq(bankTransaction.id, bankRow.id)).returning();
        await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "treasury.reconcile.manual", entityName: "bankTransaction", entityId: bankRow.id, payload: { kind: parsed.data.kind, matchId: candidate.id } }, tx);
        return updated;
      }
      const [candidate] = await tx.select({ id: supplierInvoicePayment.id }).from(supplierInvoicePayment).where(and(eq(supplierInvoicePayment.id, parsed.data.matchId), eq(supplierInvoicePayment.companyId, ctx.company.id), eq(supplierInvoicePayment.amountApplied, amount))).limit(1);
      if (!candidate) throw new Error("El pago no existe o no coincide en importe.");
      const [alreadyUsed] = await tx.select({ id: bankTransaction.id }).from(bankTransaction).innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId)).where(and(eq(bankAccount.companyId, ctx.company.id), eq(bankTransaction.matchedSupplierPaymentId, candidate.id))).limit(1);
      if (alreadyUsed) throw new Error("El pago ya está conciliado con otro movimiento.");
      const [updated] = await tx.update(bankTransaction).set({ reconciliationStatus: "RECONCILED", matchedInvoicePaymentId: null, matchedSupplierPaymentId: candidate.id, reconciledAt: new Date() }).where(eq(bankTransaction.id, bankRow.id)).returning();
      await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: session.user.id, action: "treasury.reconcile.manual", entityName: "bankTransaction", entityId: bankRow.id, payload: { kind: parsed.data.kind, matchId: candidate.id } }, tx);
      return updated;
    });
    if (!result) return NextResponse.json({ message: "Movimiento no encontrado." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No se pudo actualizar la conciliación." }, { status: 400 });
  }
}
