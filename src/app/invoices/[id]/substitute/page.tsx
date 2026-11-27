import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SubstituteSimplifiedForm } from "@/components/invoices/substitute-simplified-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, invoice, partner } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { effectiveDocumentClass } from "@/server/invoices/document-class";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { findSubstitutiveOf, getInvoiceBalance } from "@/server/invoices/service";

export const metadata: Metadata = { title: "Convertir en factura completa" };

/** Canje de una factura simplificada por una factura completa (art. 7.2 del Reglamento de facturación). */
export default async function SubstituteInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.create");
  const { id } = await params;
  const [original] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  if (!original) notFound();

  const currencyCode = ctx.company.baseCurrencyCode;
  const isSimplified = original.invoiceType === "INVOICE"
    && invoiceLifecycle(original) === "ISSUED"
    && !original.isSubstitutive
    && effectiveDocumentClass({ documentClass: original.documentClass, customerTaxId: original.customerSnapshot?.taxId }) === "SIMPLIFIED";
  const [already, balance] = await Promise.all([
    findSubstitutiveOf(db, ctx.company.id, [original.id]),
    getInvoiceBalance(db, ctx.company.id, original.id, original.totalAmount),
  ]);
  const blocker = !isSimplified
    ? "Solo se convierten en factura completa las facturas simplificadas ya emitidas (las que no llevan el NIF del cliente)."
    : already
      ? `Esta simplificada ya se convirtió en la factura ${already.number}.`
      : balance.creditedCents !== 0
        ? "Esta simplificada tiene rectificativas: no se puede convertir automáticamente. Emite una factura nueva por el importe que quedó."
        : null;

  const [customers, sameCustomer, substitutives] = blocker
    ? [[], [], []]
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
        // Otras simplificadas del mismo cliente de origen (p. ej. «Clientes varios» del TPV): las 50 más recientes.
        db
          .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate, totalAmount: invoice.totalAmount, status: invoice.status, issuedAt: invoice.issuedAt, documentClass: invoice.documentClass, customerSnapshot: invoice.customerSnapshot, vatTreatment: invoice.vatTreatment })
          .from(invoice)
          .where(and(
            eq(invoice.companyId, ctx.company.id),
            eq(invoice.customerId, original.customerId),
            eq(invoice.invoiceType, "INVOICE"),
            eq(invoice.isSubstitutive, false),
            isNotNull(invoice.issuedAt),
            ne(invoice.status, "VOID"),
            ne(invoice.id, original.id),
          ))
          .orderBy(desc(invoice.issueDate))
          .limit(50),
        db
          .select({ substitutesInvoiceIds: invoice.substitutesInvoiceIds })
          .from(invoice)
          .where(and(eq(invoice.companyId, ctx.company.id), eq(invoice.isSubstitutive, true), ne(invoice.status, "VOID"))),
      ]);
  const substitutedIds = new Set(substitutives.flatMap((row) => row.substitutesInvoiceIds ?? []));
  const others = sameCustomer
    .filter((row) => !substitutedIds.has(row.id))
    .filter((row) => (row.vatTreatment ?? "DOMESTIC") === (original.vatTreatment ?? "DOMESTIC"))
    .filter((row) => effectiveDocumentClass({ documentClass: row.documentClass, customerTaxId: row.customerSnapshot?.taxId }) === "SIMPLIFIED")
    .slice(0, 20);

  return (
    <PageShell>
      <PageHeader
        title="Convertir en factura completa"
        description={`Factura simplificada ${original.number} del ${formatDate(original.issueDate)} (${formatMoney(original.totalAmount, currencyCode)}).`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: original.number, href: `/invoices/${original.id}` },
          { label: "Factura completa" },
        ]}
      />
      {blocker ? (
        <PageSection title="No se puede convertir">
          <InlineAlert tone="warning">
            {blocker}
            <p className="mt-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/invoices/${already?.id ?? original.id}`}>
                {already ? `Ver la factura ${already.number}` : "Volver a la factura"}
              </Link>
            </p>
          </InlineAlert>
        </PageSection>
      ) : (
        <PageSection
          title="Factura que sustituye a la simplificada"
          description="El cliente pide una factura con sus datos por una compra que ya tiene ticket. Elige a quién se expide."
        >
          <SubstituteSimplifiedForm
            customers={customers}
            defaultIssueDate={dateInputValue(new Date(), ctx.company.timezone)}
            invoice={{ id: original.id, number: original.number, issueDateLabel: formatDate(original.issueDate), totalLabel: formatMoney(original.totalAmount, currencyCode) }}
            others={others.map((row) => ({ id: row.id, number: row.number, issueDateLabel: formatDate(row.issueDate), totalLabel: formatMoney(row.totalAmount, currencyCode) }))}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
