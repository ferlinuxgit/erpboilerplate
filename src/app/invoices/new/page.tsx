import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";

import { CreateInvoiceForm } from "@/components/create-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, partner } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageCustomers, canManageInvoices } from "@/lib/rbac";

export default async function NewInvoicePage() {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.create");
  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);
  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  const customers = await db
    .select({
      id: customer.id,
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
          <CreateInvoiceForm canCreateCustomer={canCreateCustomer} customers={customers} />
        )}
      </PageSection>
    </PageShell>
  );
}
