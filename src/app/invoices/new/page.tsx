import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";

import { CreateInvoiceForm } from "@/components/create-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, documentSeries, partner, paymentMethod, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { formatSeriesNumber } from "@/lib/document-series-format";
import { canManageCustomers, canManageInvoices } from "@/lib/rbac";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customerId?: string | string[] }> }) {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.create");
  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);
  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);
  const defaultIssueDate = dateInputValue(new Date(), tenantContext.company.timezone);
  const query = await searchParams;
  const initialCustomerId = Array.isArray(query.customerId) ? query.customerId[0] : query.customerId;

  const customers = await db
    .select({
      id: customer.id,
      number: partner.number,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      taxId: partner.taxId,
      city: partner.city,
      province: partner.province,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.companyId, tenantContext.company.id), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name));
  const [[invoiceSeries], taxes, paymentMethods] = await Promise.all([db
    .select({
      format: documentSeries.format,
      nextNumber: documentSeries.nextNumber,
      prefix: documentSeries.prefix,
    })
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, tenantContext.company.id),
        eq(documentSeries.fiscalYearId, tenantContext.fiscalYear.id),
        eq(documentSeries.type, "SALES_INVOICE"),
      ),
    )
    .limit(1), db.select({
      id: tax.id,
      name: tax.name,
      rate: tax.rate,
      kind: tax.kind,
      operation: tax.operation,
      isDefault: tax.isDefault,
    }).from(tax).where(and(eq(tax.companyId, tenantContext.company.id), eq(tax.isActive, true))).orderBy(asc(tax.operation), asc(tax.rate), asc(tax.name)), db.select({
      id: paymentMethod.id,
      name: paymentMethod.name,
      type: paymentMethod.type,
      bankAccountNumber: paymentMethod.bankAccountNumber,
    }).from(paymentMethod).where(eq(paymentMethod.companyId, tenantContext.company.id)).orderBy(asc(paymentMethod.name))]);
  const nextInvoiceNumberPreview = invoiceSeries
    ? formatSeriesNumber({
        format: invoiceSeries.format,
        nextNumber: invoiceSeries.nextNumber,
        prefix: invoiceSeries.prefix,
        referenceDate: new Date(`${defaultIssueDate}T12:00:00.000Z`),
      })
    : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas"
        title="Nueva factura"
        description={`Crea una factura para ${tenantContext.company.name}.`}
        backHref="/invoices"
        backLabel="Volver a facturas"
      />

      <PageSection title="Datos de factura" description="Selecciona el cliente, informa fechas y añade las líneas del documento.">
        {!canCreateInvoice ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear facturas." />
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
          <CreateInvoiceForm
            canCreateCustomer={canCreateCustomer}
            customers={customers}
            defaultIssueDate={defaultIssueDate}
            initialCustomerId={initialCustomerId}
            nextInvoiceNumberPreview={nextInvoiceNumberPreview}
            paymentMethods={paymentMethods}
            taxes={taxes.map((configuredTax) => ({
              ...configuredTax,
              rate: Number(configuredTax.rate),
              operation: configuredTax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD",
            }))}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
