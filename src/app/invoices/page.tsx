import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";

import { customer, invoice } from "@/db/schema";
import { CreateInvoiceForm } from "@/components/create-invoice-form";
import { InvoicesList } from "@/components/invoices/invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { canManageCustomers, canManageInvoices } from "@/lib/rbac";

export default async function InvoicesPage() {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");

  const customers = await db
    .select({
      id: customer.id,
      name: customer.name,
    })
    .from(customer)
    .where(and(eq(customer.companyId, tenantContext.company.id), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name));

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
  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Facturas"
        description={`Emisión y seguimiento de facturas de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {tenantContext.membership.role}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
      />

      <PageSection title="Nueva factura" description="Crea documentos de venta con cliente, fecha, vencimiento y estado de cobro.">
        {!canCreateInvoice ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear ni editar facturas." />
        ) : customers.length === 0 && !canCreateCustomer ? (
          <EmptyState
            title="Falta un cliente activo"
            description="Necesitas al menos un cliente activo antes de crear una factura, y tu rol no permite crearlo."
            action={
              <Link className={buttonVariants({ variant: "secondary" })} href="/customers">
                Ver clientes
              </Link>
            }
          />
        ) : (
          <CreateInvoiceForm canCreateCustomer={canCreateCustomer} customers={customers} />
        )}
      </PageSection>

      <PageSection
        title="Listado"
        description="Todas las facturas de la empresa activa."
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
