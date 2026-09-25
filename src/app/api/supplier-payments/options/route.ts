import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { bankAccount, partner, paymentMethod, supplierInvoice } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { can } from "@/lib/rbac";

/**
 * Opciones para registrar un pago a proveedor (formas de pago, cuentas bancarias y la forma
 * de pago habitual del proveedor). Accesible a quien puede pagar, sin exigir permisos de
 * administración o tesorería.
 */
export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission(null);
    if (!can(ctx.membership.role, "purchase.write") && !can(ctx.membership.role, "expense.write")) {
      return NextResponse.json({ message: "Sin permisos para registrar pagos a proveedores." }, { status: 403 });
    }
    const url = new URL(request.url);
    const supplierId = url.searchParams.get("supplierId")?.trim() || null;
    const invoiceId = url.searchParams.get("invoiceId")?.trim() || null;

    const [methods, accounts, supplierRows] = await Promise.all([
      db
        .select({ id: paymentMethod.id, name: paymentMethod.name, type: paymentMethod.type, bankAccountId: paymentMethod.bankAccountId, isDefault: paymentMethod.isDefault })
        .from(paymentMethod)
        .where(eq(paymentMethod.companyId, ctx.company.id))
        .orderBy(desc(paymentMethod.isDefault), asc(paymentMethod.name)),
      db
        .select({ id: bankAccount.id, bankName: bankAccount.bankName, iban: bankAccount.iban, isActive: bankAccount.isActive })
        .from(bankAccount)
        .where(eq(bankAccount.companyId, ctx.company.id))
        .orderBy(desc(bankAccount.isActive), asc(bankAccount.bankName), asc(bankAccount.id)),
      invoiceId
        ? db
            .select({ paymentMethodId: partner.paymentMethodId })
            .from(supplierInvoice)
            .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
            .where(and(eq(supplierInvoice.companyId, ctx.company.id), eq(supplierInvoice.id, invoiceId)))
            .limit(1)
        : supplierId
          ? db
              .select({ paymentMethodId: partner.paymentMethodId })
              .from(partner)
              .where(and(eq(partner.companyId, ctx.company.id), eq(partner.id, supplierId)))
              .limit(1)
          : Promise.resolve([]),
    ]);
    return NextResponse.json({
      paymentMethods: methods,
      bankAccounts: accounts,
      supplierPaymentMethodId: supplierRows[0]?.paymentMethodId ?? null,
    });
  } catch (error) {
    return handleRouteError(error, "supplier-payments.options", "No se pudieron cargar las formas de pago.");
  }
}
