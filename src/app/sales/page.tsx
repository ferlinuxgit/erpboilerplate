import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { deliveryNote, invoice, salesOrder, salesQuote } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";
import { SalesFlowActions } from "@/components/sales/sales-flow-actions";

export default async function SalesPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const quotes = await db
    .select({ id: salesQuote.id, number: salesQuote.number, status: salesQuote.status })
    .from(salesQuote)
    .where(eq(salesQuote.companyId, ctx.company.id))
    .orderBy(desc(salesQuote.createdAt));

  const orders = await db
    .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status })
    .from(salesOrder)
    .where(eq(salesOrder.companyId, ctx.company.id))
    .orderBy(desc(salesOrder.createdAt));

  const deliveryNotes = await db
    .select({ id: deliveryNote.id, number: deliveryNote.number, status: deliveryNote.status })
    .from(deliveryNote)
    .where(eq(deliveryNote.companyId, ctx.company.id))
    .orderBy(desc(deliveryNote.createdAt));

  const invoices = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(eq(invoice.companyId, ctx.company.id));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Ciclo de ventas"
        description="Flujo presupuesto -> pedido -> albarán -> factura con acciones bloqueadas cuando falta el prerrequisito."
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={<Link className={buttonVariants()} href="/sales/new">Nuevo presupuesto</Link>}
      />
      <PageSection
        title="Pipeline comercial"
        description="Ejecuta la siguiente acción disponible y revisa el estado de presupuestos, pedidos, albaranes y facturas."
        contentClassName="space-y-4"
      >
          <SalesFlowActions
            deliveryNotes={deliveryNotes}
            invoicesCount={invoices.length}
            orders={orders}
            quotes={quotes}
          />
      </PageSection>
    </PageShell>
  );
}
