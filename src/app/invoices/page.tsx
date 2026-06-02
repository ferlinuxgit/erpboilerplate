import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { customer, invoice } from "@/db/schema";
import { InvoicesList } from "@/components/invoices/invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { canManageInvoices } from "@/lib/rbac";

export default async function InvoicesPage() {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");

  const invoices = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      totalAmount: invoice.totalAmount,
      issueDate: invoice.issueDate,
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(invoice.customerId, customer.id))
    .where(eq(invoice.companyId, tenantContext.company.id))
    .orderBy(desc(invoice.createdAt));

  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Facturas"
        description={`Emisión y seguimiento de facturas de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {tenantContext.membership.role}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          canCreateInvoice ? (
            <Link className={buttonVariants()} href="/invoices/new">
              Nueva factura
            </Link>
          ) : null
        }
      />

      <PageSection
        title="Facturas emitidas"
        description="Abre una factura para revisar sus datos, líneas, PDF o cobros."
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al panel
          </Link>
        }
      >
        <InvoicesList
          rows={invoices.map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            status: invoice.paymentStatus,
            totalAmount: invoice.totalAmount,
            totalAmountLabel: formatMoney(invoice.totalAmount.toString(), tenantContext.company.baseCurrencyCode),
            issueDate: invoice.issueDate,
            issueDateLabel: formatDate(invoice.issueDate),
            customerName: invoice.customerName,
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
