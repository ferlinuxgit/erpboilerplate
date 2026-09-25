import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { CreditNoteForm } from "@/components/invoices/credit-note-form";
import { EditInvoiceForm } from "@/components/invoices/edit-invoice-form";
import { IssuedInvoiceEditForm } from "@/components/invoices/issued-invoice-edit-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { companySettings, customer, invoice, invoiceLine, invoiceLineTax, invoicePaymentMethod, partner, paymentMethod, tax } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { canManageCustomers } from "@/lib/rbac";
import { invoiceLifecycle, isSalesVatTreatment, type RectificationReason, type RectificationType } from "@/server/invoices/lifecycle";
import { getInvoiceBalance, loadStoredLines } from "@/server/invoices/service";

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
  const [lineTaxRows, taxes, paymentMethods, customers, selectedPaymentMethods, [settings]] = await Promise.all([
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
      paymentTermsDays: partner.paymentTermsDays,
      defaultRetentionRate: customer.defaultRetentionRate,
      defaultVatTreatment: customer.defaultVatTreatment,
      equivalenceSurcharge: customer.equivalenceSurcharge,
    }).from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.companyId, ctx.company.id), eq(customer.status, "ACTIVE")))
      .orderBy(asc(customer.name)),
    db.select({ paymentMethodId: invoicePaymentMethod.paymentMethodId })
      .from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, data.id))
      .orderBy(asc(invoicePaymentMethod.position)),
    db.select({ paymentTermsDays: companySettings.paymentTermsDays }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
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
  const creditNoteDraft = isCreditNote && lifecycle === "DRAFT" && data.rectifiedInvoiceId
    ? await loadCreditNoteDraft(ctx.company.id, data.rectifiedInvoiceId, data)
    : null;

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
        creditNoteDraft ? (
          <PageSection
            title="Borrador de rectificativa"
            description={`Rectifica la factura ${creditNoteDraft.original.number}. Queda por rectificar lo indicado abajo; al emitirla se numera en su propia serie.`}
          >
            <CreditNoteForm
              currencyCode={ctx.company.baseCurrencyCode}
              defaultIssueDate={dateInputValue(data.issueDate, ctx.company.timezone)}
              draft={creditNoteDraft.draft}
              invoiceId={creditNoteDraft.original.id}
              invoiceNumber={creditNoteDraft.original.number}
              lines={creditNoteDraft.originalLines}
              pendingToRectify={creditNoteDraft.pendingToRectify}
            />
          </PageSection>
        ) : (
          <PageSection title="Rectificativa no editable">
            <InlineAlert data-testid="invoice-edit-locked" title="No se encuentra la factura original" tone="warning">
              Anula este borrador y crea la rectificativa de nuevo desde la factura original.
              <p className="mt-2">
                <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/invoices/${data.id}`}>Volver a la rectificativa</Link>
              </p>
            </InlineAlert>
          </PageSection>
        )
      ) : (
        <PageSection title="Datos del borrador" description="Es un borrador: puedes cambiarlo todo. Cuando esté listo pulsa «Guardar y emitir».">
          <EditInvoiceForm
            id={data.id}
            canCreateCustomer={canManageCustomers(ctx.membership.role)}
            companyPaymentTermsDays={settings?.paymentTermsDays ?? null}
            customers={customers.map((row) => ({ ...row, defaultRetentionRate: row.defaultRetentionRate === null ? null : Number(row.defaultRetentionRate) }))}
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

type CreditNoteSource = Awaited<ReturnType<typeof loadStoredLines>>[number];

function toSourceLine(line: CreditNoteSource, sign: 1 | -1) {
  return {
    description: line.description,
    quantity: sign * line.quantity,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct ?? 0,
    taxRate: line.taxRate ?? 0,
    retentionRate: line.retentionRate ?? 0,
    taxes: (line.taxes ?? []).map((selectedTax) => ({ ...selectedTax, id: selectedTax.id ?? null })),
  };
}

/** Reconstruye el formulario de rectificativa a partir de un borrador guardado. */
async function loadCreditNoteDraft(
  companyId: string,
  originalId: string,
  draft: { id: string; totalAmount: string; rectificationReason: string | null; rectificationType: string | null; rectificationDescription: string | null },
) {
  const [original] = await db.select().from(invoice).where(and(eq(invoice.id, originalId), eq(invoice.companyId, companyId))).limit(1);
  if (!original) return null;
  const [originalLines, draftLines, balance] = await Promise.all([
    loadStoredLines(db, original.id),
    loadStoredLines(db, draft.id),
    getInvoiceBalance(db, companyId, original.id, original.totalAmount),
  ]);
  const type: RectificationType = draft.rectificationType === "SUBSTITUTION" ? "SUBSTITUTION" : "DIFFERENCES";
  const isFull = type === "DIFFERENCES" && Math.abs(Number(draft.totalAmount) + Number(original.totalAmount)) < 0.005 && draftLines.length === originalLines.length;
  const editableLines = type === "SUBSTITUTION"
    ? draftLines.filter((line) => line.quantity > 0).map((line) => toSourceLine(line, 1))
    : draftLines.map((line) => toSourceLine(line, -1));
  // Lo que queda por rectificar sin contar este borrador (aún no emitido).
  const pendingToRectify = Math.max(balance.totalCents + balance.creditedCents, 0) / 100;
  return {
    original: { id: original.id, number: original.number },
    originalLines: originalLines.map((line) => toSourceLine(line, 1)),
    pendingToRectify,
    draft: {
      creditNoteId: draft.id,
      reason: (["R1", "R2", "R3", "R4", "R5"].includes(draft.rectificationReason ?? "") ? draft.rectificationReason : "R4") as RectificationReason,
      type,
      scope: (isFull ? "FULL" : "PARTIAL") as "FULL" | "PARTIAL",
      description: draft.rectificationDescription ?? "",
      lines: editableLines,
    },
  };
}
