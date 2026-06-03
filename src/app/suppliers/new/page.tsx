import { CreateSupplierForm } from "@/components/suppliers/create-supplier-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { accountChart, paymentMethod } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageSuppliers } from "@/lib/rbac";
import { eq } from "drizzle-orm";

export default async function NewSupplierPage() {
  await requireUserSession();
  const tenantContext = await requireContext("supplier.create");
  const canCreateSupplier = canManageSuppliers(tenantContext.membership.role);
  const [paymentMethods, supplierAccounts] = await Promise.all([
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, tenantContext.company.id)),
    db
      .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
      .from(accountChart)
      .where(eq(accountChart.companyId, tenantContext.company.id)),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Proveedores"
        title="Nuevo proveedor"
        description={`Crea un proveedor activo para ${tenantContext.company.name}.`}
        backHref="/suppliers"
        backLabel="Volver a proveedores"
      />

      <PageSection title="Datos del proveedor" description="Informa identidad fiscal, domicilio y datos de contacto.">
        {canCreateSupplier ? (
          <CreateSupplierForm
            defaultAccounts={supplierAccounts.filter((account) => account.code.startsWith("410"))}
            paymentMethods={paymentMethods}
            redirectHref="/suppliers"
          />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear proveedores." />
        )}
      </PageSection>
    </PageShell>
  );
}
