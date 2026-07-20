import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { deliveryNote, invoice, salesOrder, salesQuote } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { salesDocumentStatusLabels, salesDocumentStatusTone, statusLabel } from "@/lib/status-labels";

type RecentDocument = { id: string; number: string; status: string };

function RecentDocuments({ basePath, emptyCopy, rows }: { basePath: string; emptyCopy: string; rows: RecentDocument[] }) {
  if (rows.length === 0) return <p className="text-sm leading-6 text-muted-foreground">{emptyCopy}</p>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((row) => (
        <Link className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent" href={`${basePath}/${row.id}`} key={row.id}>
          <span className="font-mono text-sm font-semibold">{row.number}</span>
          <StatusBadge tone={salesDocumentStatusTone(row.status)}>{statusLabel(salesDocumentStatusLabels, row.status)}</StatusBadge>
        </Link>
      ))}
    </div>
  );
}

export default async function SalesPage() {
  const ctx = await requireContext("invoice.read");
  const [quotes, orders, deliveryNotes, invoices] = await Promise.all([
    db.select({ id: salesQuote.id, number: salesQuote.number, status: salesQuote.status }).from(salesQuote).where(eq(salesQuote.companyId, ctx.company.id)).orderBy(desc(salesQuote.createdAt)),
    db.select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status }).from(salesOrder).where(eq(salesOrder.companyId, ctx.company.id)).orderBy(desc(salesOrder.createdAt)),
    db.select({ id: deliveryNote.id, number: deliveryNote.number, status: deliveryNote.status }).from(deliveryNote).where(eq(deliveryNote.companyId, ctx.company.id)).orderBy(desc(deliveryNote.createdAt)),
    db.select({ id: invoice.id }).from(invoice).where(eq(invoice.companyId, ctx.company.id)),
  ]);
  const canCreate = can(ctx.membership.role, "invoice.create");
  const pendingQuotes = quotes.filter((row) => row.status === "DRAFT").length;
  const pendingOrders = orders.filter((row) => row.status === "CONFIRMED").length;
  const pendingDeliveryNotes = deliveryNotes.filter((row) => row.status === "DELIVERED").length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Ventas"
        description="Gestiona presupuestos, pedidos y albaranes como documentos independientes. Las conversiones se realizan desde la ficha de cada documento."
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices">Facturas</Link>
            {canCreate ? <Link className={buttonVariants()} href="/sales/new">Nuevo presupuesto</Link> : null}
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard href="/sales/quotes" label="Presupuestos" value={quotes.length} helper={`${pendingQuotes} en borrador`} />
        <MetricCard href="/sales/orders" label="Pedidos" value={orders.length} helper={`${pendingOrders} por entregar`} />
        <MetricCard href="/sales/delivery-notes" label="Albaranes" value={deliveryNotes.length} helper={`${pendingDeliveryNotes} por facturar · ${invoices.length} facturas`} />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[1.05fr_1fr_0.95fr]">
        <PageSection
          title="Presupuestos"
          description="Propuestas comerciales y condiciones ofrecidas al cliente."
          actions={<Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/sales/quotes">Ver listado</Link>}
        >
          <RecentDocuments basePath="/sales/quotes" emptyCopy="Aún no hay presupuestos. Crea el primero desde la acción superior." rows={quotes} />
        </PageSection>
        <PageSection
          title="Pedidos"
          description="Ventas aceptadas y pendientes de preparar o entregar."
          actions={<Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/sales/orders">Ver listado</Link>}
        >
          <RecentDocuments basePath="/sales/orders" emptyCopy="Los pedidos aparecerán al convertir un presupuesto aceptado." rows={orders} />
        </PageSection>
        <PageSection
          title="Albaranes"
          description="Entregas de mercancía y servicios pendientes de facturación."
          actions={<Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/sales/delivery-notes">Ver listado</Link>}
        >
          <RecentDocuments basePath="/sales/delivery-notes" emptyCopy="Los albaranes aparecerán al generar una entrega desde un pedido." rows={deliveryNotes} />
        </PageSection>
      </section>
    </PageShell>
  );
}
