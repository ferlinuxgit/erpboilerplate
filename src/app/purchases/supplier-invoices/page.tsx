import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { SupplierInvoicesList } from "@/components/purchases/supplier-invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import {
  partner,
  purchaseOrder,
  supplierInvoice,
  supplierInvoicePayment,
} from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function PurchaseSupplierInvoicesPage() {
  const ctx = await requireContext("purchase.read");
  const [invoices, payments] = await Promise.all([
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        supplierName: partner.name,
        orderId: purchaseOrder.id,
        orderNumber: purchaseOrder.number,
        issueDate: supplierInvoice.issueDate,
        dueDate: supplierInvoice.dueDate,
        origin: supplierInvoice.origin,
        paymentStatus: supplierInvoice.paymentStatus,
        totalAmount: supplierInvoice.totalAmount,
      })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .leftJoin(
        purchaseOrder,
        eq(purchaseOrder.id, supplierInvoice.purchaseOrderId),
      )
      .where(eq(supplierInvoice.companyId, ctx.company.id))
      .orderBy(desc(supplierInvoice.issueDate)),
    db
      .select({
        invoiceId: supplierInvoicePayment.supplierInvoiceId,
        amount: supplierInvoicePayment.amountApplied,
      })
      .from(supplierInvoicePayment)
      .where(eq(supplierInvoicePayment.companyId, ctx.company.id)),
  ]);
  const paidByInvoice = new Map<string, number>();
  for (const payment of payments)
    paidByInvoice.set(
      payment.invoiceId,
      (paidByInvoice.get(payment.invoiceId) ?? 0) + Number(payment.amount),
    );
  const canWrite = can(ctx.membership.role, "purchase.write");
  const canCreateDirectInvoice = can(ctx.membership.role, "expense.write");
  const rows = invoices.map((invoice) => ({
    ...invoice,
    outstandingAmount: Math.max(
      Number(invoice.totalAmount) - (paidByInvoice.get(invoice.id) ?? 0),
      0,
    ).toFixed(2),
    currencyCode: ctx.company.baseCurrencyCode,
    canManage:
      invoice.origin === "PURCHASE" ? canWrite : canCreateDirectInvoice,
  }));
  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas de proveedor"
        title="Facturas de proveedor"
        description="Todas las facturas recibidas, procedan de un pedido o de un gasto directo, con vencimientos y saldos pendientes."
        actions={
          canCreateDirectInvoice ? (
            <Link className={buttonVariants()} href="/purchases/supplier-invoices/new">
              Nueva factura de proveedor
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Facturas recibidas"
        description="Registra pagos desde el listado o abre la ficha contable y fiscal del documento."
      >
        <SupplierInvoicesList rows={rows} />
      </PageSection>
    </PageShell>
  );
}
