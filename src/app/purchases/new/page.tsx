import { CreatePurchaseOrderForm } from "@/components/purchases/create-purchase-order-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";

export default async function NewPurchaseOrderPage() {
  const tenantContext = await requireContext("purchase.write");
  const canWritePurchases = can(tenantContext.membership.role, "purchase.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Compras"
        title="Nuevo pedido"
        description={`Registra un pedido de compra para ${tenantContext.company.name}.`}
        backHref="/purchases"
        backLabel="Volver a compras"
      />

      <PageSection title="Datos del pedido" description="Informa proveedor, número y primera línea de compra.">
        {canWritePurchases ? (
          <CreatePurchaseOrderForm redirectHref="/purchases" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear pedidos de compra." />
        )}
      </PageSection>
    </PageShell>
  );
}
