import Link from "next/link";

import { SuppliersTable } from "@/components/suppliers/suppliers-table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canManageSuppliers } from "@/lib/rbac";
import { listSuppliers } from "@/server/suppliers/service";

export default async function SuppliersPage() {
  await requireUserSession();
  const tenantContext = await requireContext("supplier.read");
  const suppliers = await listSuppliers(db, tenantContext.company.id);
  const canCreateSupplier = canManageSuppliers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Proveedores"
        description={`Terceros proveedores de ${tenantContext.company.name} para compras, gastos y facturas recibidas.`}
        meta={<StatusBadge tone="neutral">Rol: {tenantContext.membership.role}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          canCreateSupplier ? (
            <Link className={buttonVariants()} href="/suppliers/new">
              Nuevo proveedor
            </Link>
          ) : null
        }
      />

      <PageSection
        title="Proveedores registrados"
        description="Abre un proveedor para editar su identidad fiscal, contacto y domicilio."
      >
        <SuppliersTable rows={suppliers} />
      </PageSection>
    </PageShell>
  );
}
