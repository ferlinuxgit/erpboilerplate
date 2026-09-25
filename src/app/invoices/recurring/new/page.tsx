import type { Metadata } from "next";
import Link from "next/link";

import { defaultScheduleDraft } from "@/components/recurring/schedule-draft";
import { RecurringInvoiceForm, type RecurringInvoiceFormValues } from "@/components/recurring/recurring-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, InlineAlert, PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listSelectableSeries } from "@/server/documents/series";
import { todayDateInput } from "@/server/invoices/due-dates";
import { occurrenceDate } from "@/server/recurring/schedule";
import { listRecurringCustomerOptions, recurringPrefillFromInvoice } from "@/server/recurring/service";

export const metadata: Metadata = { title: "Nueva factura recurrente" };

export default async function NewRecurringInvoicePage({ searchParams }: { searchParams: Promise<{ invoiceId?: string | string[] }> }) {
  await requireUserSession();
  const ctx = await requireContext("invoice.create");
  const query = await searchParams;
  const invoiceId = Array.isArray(query.invoiceId) ? query.invoiceId[0] : query.invoiceId;
  const today = todayDateInput(ctx.company.timezone || undefined);
  const [customers, prefill, invoiceSeries] = await Promise.all([
    listRecurringCustomerOptions(ctx.company.id),
    invoiceId ? recurringPrefillFromInvoice(ctx.company.id, invoiceId) : Promise.resolve(null),
    listSelectableSeries(db, ctx.company.id, ctx.fiscalYear.id, "SALES_INVOICE"),
  ]);
  // Desde una factura, la primera emisión propuesta es el mismo día del mes siguiente (la actual ya existe).
  const startDate = prefill ? occurrenceDate({ startDate: today, dayOfMonth: Number(today.slice(8, 10)), intervalMonths: 1 }, 1) : today;
  const initial: RecurringInvoiceFormValues = {
    name: prefill?.name ?? "",
    customerId: prefill?.customerId ?? "",
    lines: prefill?.lines ?? [],
    notes: prefill?.notes ?? "",
    issueMode: "DRAFT",
    schedule: defaultScheduleDraft(startDate),
    sourceInvoiceId: prefill?.sourceInvoiceId ?? null,
    seriesId: prefill?.seriesId ?? null,
    vatTreatment: prefill?.vatTreatment ?? null,
  };

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Facturas", href: "/invoices" }, { label: "Recurrentes", href: "/invoices/recurring" }, { label: "Nueva" }]}
        title="Nueva factura recurrente"
        description="Defínela una vez y se generará sola en cada fecha."
      />
      {invoiceId && !prefill ? <InlineAlert tone="warning">No se encontró la factura de origen (o es una rectificativa). Rellena los datos a mano.</InlineAlert> : null}
      {prefill ? <InlineAlert tone="info">Datos copiados de la factura {prefill.sourceNumber}. Revisa el concepto: puedes usar {"{mes}"} o {"{trimestre}"} para que cambie en cada factura.</InlineAlert> : null}
      {customers.length === 0 ? (
        <EmptyState
          action={<Link className={buttonVariants()} href="/customers/new">Crear cliente</Link>}
          description="Necesitas al menos un cliente activo."
          title="Todavía no hay clientes"
        />
      ) : (
        <RecurringInvoiceForm customers={customers} initial={initial} invoiceSeries={invoiceSeries} />
      )}
    </PageShell>
  );
}
