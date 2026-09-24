import type { Metadata } from "next";

import { CreateCustomerForm } from "@/components/create-customer-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { canManageCustomers } from "@/lib/rbac";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  await requireUserSession();
  const tenantContext = await requireContext("customer.create");
  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        title="Nuevo cliente"
        description={`Crea un cliente activo para ${tenantContext.company.name}.`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Clientes", href: "/customers" },
          { label: "Nuevo cliente" },
        ]}
      />

      <PageSection title="Datos del cliente" description="Informa identidad fiscal, domicilio y contacto. El número de cliente se asignará automáticamente.">
        {canCreateCustomer ? (
          <CreateCustomerForm redirectHref="/customers" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear clientes." />
        )}
      </PageSection>
    </PageShell>
  );
}
