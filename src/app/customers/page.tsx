import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { CustomersTable } from "@/components/customers/customers-table";
import { customer, partner } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageCustomers } from "@/lib/rbac";

export default async function CustomersPage() {
  await requireUserSession();
  const tenantContext = await requireContext("customer.read");

  const customers = await db
    .select({
      id: customer.id,
      name: customer.name,
      status: customer.status,
      email: customer.email,
      phone: customer.phone,
      taxId: partner.taxId,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
    })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(eq(customer.companyId, tenantContext.company.id))
    .orderBy(desc(customer.createdAt));

  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Clientes"
        description={`Cartera comercial de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {tenantContext.membership.role}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          canCreateCustomer ? (
            <Link className={buttonVariants()} href="/customers/new">
              Nuevo cliente
            </Link>
          ) : null
        }
      />

      <PageSection
        title="Clientes registrados"
        description="Abre un cliente para editar su identidad, contacto y domicilio fiscal."
      >
        <CustomersTable rows={customers} />
      </PageSection>
    </PageShell>
  );
}
