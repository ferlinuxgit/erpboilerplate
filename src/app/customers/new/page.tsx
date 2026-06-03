import { CreateCustomerForm } from "@/components/create-customer-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { canManageCustomers } from "@/lib/rbac";

export default async function NewCustomerPage() {
  await requireUserSession();
  const tenantContext = await requireContext("customer.create");
  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Clientes"
        title="Nuevo cliente"
        description={`Crea un cliente activo para ${tenantContext.company.name}.`}
        backHref="/customers"
        backLabel="Volver a clientes"
      />

      <PageSection title="Datos del cliente" description="Informa identidad fiscal, domicilio y datos de contacto.">
        {canCreateCustomer ? (
          <CreateCustomerForm redirectHref="/customers" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear clientes." />
        )}
      </PageSection>
    </PageShell>
  );
}
