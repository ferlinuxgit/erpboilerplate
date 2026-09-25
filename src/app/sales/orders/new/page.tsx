import type { Metadata } from "next";
import Link from "next/link";

import { CreateSalesOrderForm } from "@/components/sales/create-sales-order-form";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { loadSalesFormData } from "@/server/sales/form-data";

export const metadata: Metadata = { title: "Nuevo pedido de venta" };

export default async function NewSalesOrderPage() {
  const ctx = await requireContext("invoice.create");
  const { customers, defaultTaxRate } = await loadSalesFormData(ctx.company.id);
  return (
    <PageShell>
      <PageHeader
        title="Nuevo pedido"
        description="Registra directamente un compromiso de venta confirmado."
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Pedidos", href: "/sales/orders" },
          { label: "Nuevo pedido" },
        ]}
      />
      <PageSection
        title="Datos del pedido"
        description="Selecciona cliente, fecha y líneas. Los totales se calculan en el servidor."
      >
        {customers.length ? (
          <CreateSalesOrderForm customers={customers} defaultTaxRate={defaultTaxRate} />
        ) : (
          <EmptyState
            title="Falta un cliente"
            description="Crea un cliente antes de registrar un pedido."
            action={
              <Link className={buttonVariants()} href="/customers/new">
                Crear cliente
              </Link>
            }
          />
        )}
      </PageSection>
    </PageShell>
  );
}
