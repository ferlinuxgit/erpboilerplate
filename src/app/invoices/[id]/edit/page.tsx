import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";

import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, invoice, invoiceLine, invoiceLineTax, invoicePaymentMethod, partner, paymentMethod, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { canManageCustomers } from "@/lib/rbac";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.write");
  const { id } = await params;
  const rows = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id))).limit(1);
  if (!rows[0]) notFound();
  const data = rows[0];
  const lines = await db
    .select({
      id: invoiceLine.id,
      itemId: invoiceLine.itemId,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, data.id));
  const [lineTaxRows, taxes, paymentMethods, customers, selectedPaymentMethods] = await Promise.all([
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
    db.select({
      id: paymentMethod.id,
      name: paymentMethod.name,
      type: paymentMethod.type,
      bankAccountNumber: paymentMethod.bankAccountNumber,
      isDefault: paymentMethod.isDefault,
    }).from(paymentMethod).where(eq(paymentMethod.companyId, ctx.company.id)).orderBy(desc(paymentMethod.isDefault), asc(paymentMethod.name)),
    db.select({
      id: customer.id,
      number: partner.number,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      taxId: partner.taxId,
      city: partner.city,
      province: partner.province,
    }).from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.companyId, ctx.company.id), eq(customer.status, "ACTIVE")))
      .orderBy(asc(customer.name)),
    db.select({ paymentMethodId: invoicePaymentMethod.paymentMethodId })
      .from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, data.id))
      .orderBy(asc(invoicePaymentMethod.position)),
  ]);
  const lineTaxIds = new Map<string, string[]>();
  for (const row of lineTaxRows) {
    if (!row.taxId) continue;
    lineTaxIds.set(row.invoiceLineId, [...(lineTaxIds.get(row.invoiceLineId) ?? []), row.taxId]);
  }
  const defaultLines = lines.map((line) => ({
    itemId: line.itemId,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    discountPct: Number(line.discountPct ?? 0),
    taxRate: Number(line.taxRate ?? 0),
    retentionRate: Number(line.retentionRate ?? 0),
    taxIds: lineTaxIds.get(line.id) ?? [],
  }));
  const defaultPaymentMethodIds = selectedPaymentMethods
    .map((method) => method.paymentMethodId)
    .filter((methodId): methodId is string => Boolean(methodId));
  if (defaultPaymentMethodIds.length === 0 && data.paymentMethodId) defaultPaymentMethodIds.push(data.paymentMethodId);

  return (
    <PageShell>
      <PageHeader eyebrow="Facturas" title="Editar factura" description={data.number} backHref="/invoices" backLabel="Volver a facturas" />
      <PageSection title="Datos de factura" description="Actualiza cliente, fechas, forma de pago, líneas, impuestos, estado y notas del documento.">
        <EditInvoiceForm
          id={data.id}
          canCreateCustomer={canManageCustomers(ctx.membership.role)}
          customers={customers}
          defaultCustomerId={data.customerId}
          invoiceNumber={data.number}
          defaultLines={defaultLines}
          defaultIssueDate={dateInputValue(data.issueDate, ctx.company.timezone)}
          defaultDueDate={data.dueDate ? dateInputValue(data.dueDate, ctx.company.timezone) : ""}
          defaultStatus={data.status}
          defaultNotes={data.notes}
          defaultPaymentMethodIds={defaultPaymentMethodIds}
          defaultTotalAmount={Number(data.totalAmount)}
          taxes={taxes.map((configuredTax) => ({
            ...configuredTax,
            rate: Number(configuredTax.rate),
            operation: configuredTax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD",
          }))}
          paymentMethods={paymentMethods}
        />
      </PageSection>
    </PageShell>
  );
}
