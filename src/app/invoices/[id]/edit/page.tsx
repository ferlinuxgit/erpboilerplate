import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { invoice, invoiceLine, invoiceLineTax, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.write");
  const { id } = await params;
  const rows = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];
  const lines = await db
    .select({
      id: invoiceLine.id,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, data.id));
  const [lineTaxRows, taxes] = await Promise.all([
    lines.length > 0
      ? db.select({ invoiceLineId: invoiceLineTax.invoiceLineId, taxId: invoiceLineTax.taxId }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.id)))
      : Promise.resolve([]),
    db.select({
      id: tax.id,
      name: tax.name,
      rate: tax.rate,
      kind: tax.kind,
      operation: tax.operation,
      isDefault: tax.isDefault,
      isActive: tax.isActive,
    }).from(tax).where(eq(tax.companyId, ctx.company.id)).orderBy(asc(tax.operation), asc(tax.rate), asc(tax.name)),
  ]);
  const lineTaxIds = new Map<string, string[]>();
  for (const row of lineTaxRows) {
    if (!row.taxId) continue;
    lineTaxIds.set(row.invoiceLineId, [...(lineTaxIds.get(row.invoiceLineId) ?? []), row.taxId]);
  }
  const defaultLines = lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    taxRate: Number(line.taxRate ?? 0),
    retentionRate: 0,
    taxIds: lineTaxIds.get(line.id) ?? [],
  }));

  return (
    <PageShell>
      <PageHeader eyebrow="Facturas" title="Editar factura" description={data.number} backHref="/invoices" backLabel="Volver a facturas" />
      <PageSection title="Datos de factura" description="Actualiza líneas, estado, importe y notas del documento.">
        <EditInvoiceForm
          id={data.id}
          defaultLines={defaultLines}
          defaultIssueDate={dateInputValue(data.issueDate, ctx.company.timezone)}
          defaultStatus={data.status}
          defaultNotes={data.notes}
          defaultTotalAmount={Number(data.totalAmount)}
          taxes={taxes.map((configuredTax) => ({
            ...configuredTax,
            rate: Number(configuredTax.rate),
            operation: configuredTax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD",
          }))}
        />
      </PageSection>
    </PageShell>
  );
}
