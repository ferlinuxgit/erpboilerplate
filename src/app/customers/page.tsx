import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { CustomersTable } from "@/components/customers/customers-table";
import { customer, partner } from "@/db/schema";
import { CreateCustomerForm } from "@/components/create-customer-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
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
      />

      <PageSection title="Alta rápida" description="Crea clientes activos para facturación, ventas y reporting.">
        {canCreateCustomer ? (
          <CreateCustomerForm />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear ni editar clientes." />
        )}
      </PageSection>

      <PageSection
        title="Listado"
        description="Todos los clientes de la empresa activa."
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al panel
          </Link>
        }
      >
        {customers.length === 0 ? (
          <EmptyState title="Todavía no hay clientes" description="Crea el primer cliente para alimentar facturas, ventas y reporting." />
        ) : (
          <CustomersTable rows={customers} />
        )}
      </PageSection>
    </PageShell>
  );
}
