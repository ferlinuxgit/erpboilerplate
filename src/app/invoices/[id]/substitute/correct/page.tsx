import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CorrectSubstitutiveForm } from "@/components/invoices/correct-substitutive-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, invoice, partner } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { findSubstitutiveCancellationOf } from "@/server/invoices/service";

export const metadata: Metadata = { title: "Corregir factura de canje" };

/** Corrección de una factura de canje (F3) errónea: F3 de signo contrario + F3 nueva (FAQ de VERI*FACTU). */
export default async function CorrectSubstitutivePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.create");
  const { id } = await params;
  const [wrong] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!wrong) notFound();

  const currencyCode = ctx.company.baseCurrencyCode;
  const isSubstitutive = wrong.invoiceType === "INVOICE" && wrong.isSubstitutive && invoiceLifecycle(wrong) === "ISSUED";
  const cancellation = isSubstitutive ? await findSubstitutiveCancellationOf(db, ctx.company.id, wrong.id) : null;
  const blocker = !isSubstitutive
    ? "Solo se corrigen así las facturas emitidas en sustitución de simplificadas (canje)."
    : cancellation
      ? `Esta factura ya se anuló con la ${cancellation.number}.`
      : null;

  const [customers, simplified] = blocker
    ? [[], []]
    : await Promise.all([
        db
          .select({
            id: customer.id,
            number: partner.number,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            taxId: partner.taxId,
            city: partner.city,
            province: partner.province,
            countryCode: partner.countryCode,
          })
          .from(customer)
          .innerJoin(partner, eq(partner.id, customer.partnerId))
          .where(and(eq(customer.companyId, ctx.company.id), eq(customer.status, "ACTIVE"), isNotNull(partner.taxId), ne(partner.taxId, "")))
          .orderBy(asc(customer.name)),
        db
          .select({ number: invoice.number })
          .from(invoice)
          .where(and(eq(invoice.companyId, ctx.company.id), inArray(invoice.id, wrong.substitutesInvoiceIds ?? [])))
          .orderBy(asc(invoice.issueDate)),
      ]);

  return (
    <PageShell>
      <PageHeader
        title="Corregir factura de canje"
        description={`Factura ${wrong.number} del ${formatDate(wrong.issueDate)} (${formatMoney(wrong.totalAmount, currencyCode)}), a nombre de ${wrong.customerSnapshot?.name ?? "—"}.`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: wrong.number, href: `/invoices/${wrong.id}` },
          { label: "Corregir canje" },
        ]}
      />
      {blocker ? (
        <PageSection title="No se puede corregir">
          <InlineAlert tone="warning">
            {blocker}
            <p className="mt-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/invoices/${cancellation?.id ?? wrong.id}`}>
                {cancellation ? `Ver la factura ${cancellation.number}` : "Volver a la factura"}
              </Link>
            </p>
          </InlineAlert>
        </PageSection>
      ) : (
        <PageSection
          title="Factura correcta"
          description="Para un cliente equivocado o datos de la operación erróneos en la factura completa. Si el error está en el ticket (simplificada), rectifica el ticket."
        >
          <CorrectSubstitutiveForm
            customers={customers}
            defaultCustomerId={wrong.customerId}
            defaultIssueDate={dateInputValue(new Date(), ctx.company.timezone)}
            invoice={{ id: wrong.id, number: wrong.number, simplifiedNumbers: simplified.map((row) => row.number) }}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
