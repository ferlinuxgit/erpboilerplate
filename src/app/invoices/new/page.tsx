import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { CreateInvoiceForm } from "@/components/create-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { companySettings, customer, partner, paymentMethod, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { canManageCustomers, canManageInvoices } from "@/lib/rbac";
import { listSelectableSeries } from "@/server/documents/series";

export const metadata: Metadata = { title: "Nueva factura" };

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
      countryCode: partner.countryCode,
      paymentTermsDays: partner.paymentTermsDays,
      defaultRetentionRate: customer.defaultRetentionRate,
      defaultVatTreatment: customer.defaultVatTreatment,
      equivalenceSurcharge: customer.equivalenceSurcharge,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.companyId, tenantContext.company.id), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name));
  const [invoiceSeries, taxes, paymentMethods, [settings]] = await Promise.all([
    // Series activas de facturas del ejercicio (la de por defecto primero) para el selector y la vista previa.
    listSelectableSeries(db, tenantContext.company.id, tenantContext.fiscalYear.id, "SALES_INVOICE"), db.select({
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
      isDefault: paymentMethod.isDefault,
    }).from(paymentMethod).where(eq(paymentMethod.companyId, tenantContext.company.id)).orderBy(desc(paymentMethod.isDefault), asc(paymentMethod.name)),
    db.select({ paymentTermsDays: companySettings.paymentTermsDays }).from(companySettings).where(eq(companySettings.companyId, tenantContext.company.id)).limit(1)]);

  return (
    <PageShell>
      <PageHeader
        title="Nueva factura"
        description={`Crea una factura para ${tenantContext.company.name}.`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: "Nueva factura" },
        ]}
      />

      <PageSection title="Datos de factura" description="Elige el cliente y añade las líneas. El vencimiento, el IVA y la retención se proponen según la ficha del cliente.">
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
            companyPaymentTermsDays={settings?.paymentTermsDays ?? null}
            customers={customers.map((row) => ({ ...row, defaultRetentionRate: row.defaultRetentionRate === null ? null : Number(row.defaultRetentionRate) }))}
            defaultIssueDate={defaultIssueDate}
            initialCustomerId={initialCustomerId}
            invoiceSeries={invoiceSeries}
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
