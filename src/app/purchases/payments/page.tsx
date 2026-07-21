import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { SupplierPaymentsList } from "@/components/purchases/supplier-payments-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { bankAccount, partner, paymentMethod, supplierInvoice, supplierPayment } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function PurchasePaymentsPage() {
  const ctx = await requireContext("purchase.read");
  const payments = await db
    .select({
      id: supplierPayment.id,
      number: supplierPayment.number,
      supplierId: partner.id,
      supplierNumber: partner.number,
      invoiceId: supplierInvoice.id,
      invoiceNumber: supplierInvoice.number,
      supplierName: partner.name,
      amount: supplierPayment.amount,
      postedAt: supplierPayment.postedAt,
      reference: supplierPayment.reference,
      paymentMethodName: paymentMethod.name,
      bankName: bankAccount.bankName,
    })
    .from(supplierPayment)
    .leftJoin(
      supplierInvoice,
      eq(supplierInvoice.id, supplierPayment.supplierInvoiceId),
    )
    .innerJoin(partner, eq(partner.id, supplierPayment.supplierPartnerId))
    .leftJoin(paymentMethod, eq(paymentMethod.id, supplierPayment.paymentMethodId))
    .leftJoin(bankAccount, eq(bankAccount.id, supplierPayment.bankAccountId))
    .where(eq(supplierPayment.companyId, ctx.company.id))
    .orderBy(desc(supplierPayment.postedAt));
  return (
    <PageShell>
      <PageHeader
        eyebrow="Pagos a proveedores"
        title="Pagos a proveedores"
        description="Histórico de pagos aplicados a facturas y pagos a cuenta de proveedores."
        actions={
          <Link
            className={buttonVariants()}
            href="/suppliers"
          >
            Registrar desde un proveedor
          </Link>
        }
      />
      <PageSection
        title="Pagos registrados"
        description="Cada pago conserva proveedor, fecha e importe; la factura es opcional."
      >
        <SupplierPaymentsList
          rows={payments.map((payment) => ({
            ...payment,
            currencyCode: ctx.company.baseCurrencyCode,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
