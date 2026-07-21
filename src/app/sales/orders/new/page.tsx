import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { CreateSalesOrderForm } from "@/components/sales/create-sales-order-form";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { customer, partner, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function NewSalesOrderPage() {
  const ctx = await requireContext("invoice.create");
  const [customers, [defaultTax]] = await Promise.all([db
    .select({ id: customer.id, number: partner.number, name: customer.name })
    .from(customer)
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(eq(customer.companyId, ctx.company.id))
    .orderBy(asc(customer.name)), db.select({ rate: tax.rate }).from(tax).where(eq(tax.companyId, ctx.company.id)).orderBy(tax.rate).limit(1)]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedidos"
        title="Nuevo pedido"
        description="Registra directamente un compromiso de venta confirmado."
        backHref="/sales/orders"
        backLabel="Volver a pedidos"
      />
      <PageSection
        title="Datos del pedido"
        description="Selecciona cliente, fecha y líneas. Los totales se calculan en el servidor."
      >
        {customers.length ? (
          <CreateSalesOrderForm customers={customers} defaultTaxRate={Number(defaultTax?.rate ?? 0)} />
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
