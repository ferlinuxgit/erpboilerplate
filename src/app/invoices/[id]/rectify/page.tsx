import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreditNoteForm } from "@/components/invoices/credit-note-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { invoice } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { formatDate, formatMoney } from "@/lib/format";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { getInvoiceBalance, loadStoredLines } from "@/server/invoices/service";

export const metadata: Metadata = { title: "Factura rectificativa" };

export default async function RectifyInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.create");
  const { id } = await params;
  const [original] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!original) notFound();

  const currencyCode = ctx.company.baseCurrencyCode;
  const lifecycle = invoiceLifecycle(original);
  const canRectify = lifecycle === "ISSUED" && original.invoiceType === "INVOICE";
  const [lines, balance] = await Promise.all([
    loadStoredLines(db, original.id),
    getInvoiceBalance(db, ctx.company.id, original.id, original.totalAmount),
  ]);
  const pendingToRectify = Math.max(balance.totalCents + balance.creditedCents, 0) / 100;

  return (
    <PageShell>
      <PageHeader
        title="Crear factura rectificativa"
        description={`Corrige o anula la factura ${original.number} del ${formatDate(original.issueDate)} (${formatMoney(original.totalAmount, currencyCode)}).`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: original.number, href: `/invoices/${original.id}` },
          { label: "Rectificativa" },
        ]}
      />
      {!canRectify ? (
        <PageSection title="No se puede rectificar">
          <InlineAlert title={lifecycle === "DRAFT" ? "Es un borrador" : "Documento no rectificable"} tone="warning">
            {lifecycle === "DRAFT"
              ? "Los borradores no necesitan rectificativa: edítalo directamente."
              : original.invoiceType === "CREDIT_NOTE"
                ? "Esto ya es una rectificativa. Para corregirla, rectifica la factura original."
                : "La factura está anulada."}
            <p className="mt-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/invoices/${original.id}`}>Volver a la factura</Link>
            </p>
          </InlineAlert>
        </PageSection>
      ) : pendingToRectify <= 0 ? (
        <PageSection title="Factura ya rectificada">
          <InlineAlert tone="info">La factura {original.number} ya está rectificada por su importe total.</InlineAlert>
        </PageSection>
      ) : (
        <PageSection
          title="Datos de la rectificativa"
          description={`Queda por rectificar ${formatMoney(pendingToRectify, currencyCode)}. La rectificativa se numera en su propia serie, se contabiliza como asiento inverso y reduce el saldo pendiente de ${original.number}.`}
        >
          <CreditNoteForm
            currencyCode={currencyCode}
            defaultIssueDate={dateInputValue(new Date(), ctx.company.timezone)}
            invoiceId={original.id}
            invoiceNumber={original.number}
            lines={lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPct: line.discountPct ?? 0,
              taxRate: line.taxRate ?? 0,
              retentionRate: line.retentionRate ?? 0,
              taxes: (line.taxes ?? []).map((selectedTax) => ({ ...selectedTax, id: selectedTax.id ?? null })),
            }))}
            pendingToRectify={pendingToRectify}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
