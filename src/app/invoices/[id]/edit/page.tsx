import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { invoice, invoiceLine } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const { id } = await params;
  const rows = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];
  const lines = await db
    .select({
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, data.id));
  const defaultLines = lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    taxRate: Number(line.taxRate ?? 0),
  }));

  return (
    <PageShell>
      <PageHeader eyebrow="Facturas" title="Editar factura" description={data.number} backHref="/invoices" backLabel="Volver a facturas" />
      <PageSection title="Datos de factura" description="Actualiza líneas, estado, importe y notas del documento.">
        <EditInvoiceForm
          id={data.id}
          defaultLines={defaultLines}
          defaultNumber={data.number}
          defaultStatus={data.status}
          defaultNotes={data.notes}
          defaultTotalAmount={Number(data.totalAmount)}
        />
      </PageSection>
    </PageShell>
  );
}
