import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { IssuedInvoiceEditForm } from "@/components/invoices/issued-invoice-edit-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, invoice, invoiceLine, invoiceLineTax, invoicePaymentMethod, partner, paymentMethod, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { canManageCustomers } from "@/lib/rbac";
import { invoiceLifecycle, isSalesVatTreatment } from "@/server/invoices/lifecycle";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("invoice.write");
    const { id } = await params;
    const [row] = await db
      .select({ number: invoice.number })
      .from(invoice)
      .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Editar factura ${row.number}` : "Editar factura" };
  } catch {
    return { title: "Editar factura" };
  }
}

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
      countryCode: partner.countryCode,
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

  const lifecycle = invoiceLifecycle(data);
  const isCreditNote = data.invoiceType === "CREDIT_NOTE";

  return (
    <PageShell>
      <PageHeader
        title={lifecycle === "DRAFT" ? "Editar borrador" : "Editar factura"}
        description={data.number}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: data.number, href: `/invoices/${data.id}` },
          { label: "Editar" },
        ]}
      />
      {lifecycle === "VOID" ? (
        <PageSection title="Factura anulada">
          <InlineAlert data-testid="invoice-edit-locked" title="Este borrador está anulado" tone="danger">
            Un borrador anulado no se puede editar. Si lo necesitas de nuevo, duplícalo desde la ficha de la factura.
          </InlineAlert>
        </PageSection>
      ) : lifecycle === "ISSUED" ? (
        <>
          <PageSection title="Datos fiscales bloqueados">
            <InlineAlert data-testid="invoice-edit-locked" title={data.paymentStatus !== "PENDING" ? "Esta factura tiene cobros registrados y ya está emitida" : "Esta factura ya está emitida"} tone="warning">
              <p>
                Una factura emitida no se puede modificar ni borrar: la ley exige conservarla tal cual se entregó al cliente
                (número, fecha, cliente, líneas e importes). Si hay un error o una devolución, crea una factura rectificativa:
                se numera en su propia serie, referencia a {data.number} y ajusta el saldo y la contabilidad automáticamente.
              </p>
              {!isCreditNote ? (
                <p className="mt-2">
                  <Link className={buttonVariants({ size: "sm" })} data-testid="invoice-edit-create-credit-note" href={`/invoices/${data.id}/rectify`}>
                    Crear factura rectificativa
                  </Link>
                </p>
              ) : null}
            </InlineAlert>
          </PageSection>
          <PageSection title="Notas y formas de pago" description="Es lo único que puedes cambiar en una factura emitida.">
            <IssuedInvoiceEditForm
              defaultNotes={data.notes}
              defaultPaymentMethodIds={defaultPaymentMethodIds}
              id={data.id}
              paymentMethods={paymentMethods}
            />
          </PageSection>
        </>
      ) : isCreditNote ? (
        <PageSection title="Borrador de rectificativa">
          <InlineAlert data-testid="invoice-edit-locked" title="Las rectificativas en borrador no se editan línea a línea" tone="info">
            Emítela desde su ficha o anúlala y crea otra rectificativa desde la factura original con los importes correctos.
            <p className="mt-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/invoices/${data.id}`}>Volver a la rectificativa</Link>
            </p>
          </InlineAlert>
        </PageSection>
      ) : (
        <PageSection title="Datos del borrador" description="Actualiza cliente, fechas, formas de pago, líneas, impuestos, tratamiento de IVA y notas. Cuando esté listo, emítelo desde la ficha.">
          <EditInvoiceForm
            id={data.id}
            canCreateCustomer={canManageCustomers(ctx.membership.role)}
            customers={customers}
            defaultCustomerId={data.customerId}
            invoiceNumber={data.number}
            defaultLines={defaultLines}
            defaultIssueDate={dateInputValue(data.issueDate, ctx.company.timezone)}
            defaultDueDate={data.dueDate ? dateInputValue(data.dueDate, ctx.company.timezone) : ""}
            defaultNotes={data.notes}
            defaultPaymentMethodIds={defaultPaymentMethodIds}
            defaultTotalAmount={Number(data.totalAmount)}
            defaultVatTreatment={isSalesVatTreatment(data.vatTreatment) ? data.vatTreatment : null}
            taxes={taxes.map((configuredTax) => ({
              ...configuredTax,
              rate: Number(configuredTax.rate),
              operation: configuredTax.operation === "SUBTRACT" ? "SUBTRACT" : "ADD",
            }))}
            paymentMethods={paymentMethods}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
