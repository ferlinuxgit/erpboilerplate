import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/delete-button";
import { InvoiceVerifactuCard } from "@/components/fiscal/invoice-verifactu-card";
import { DuplicateInvoiceButton, IssueInvoiceButton } from "@/components/invoices/invoice-lifecycle-actions";
import { RegisterInvoicePaymentDialog } from "@/components/invoices/register-invoice-payment-dialog";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customer, invoice, invoicePayment, invoicePaymentMethod, partner, payment, paymentMethod, type InvoicePartySnapshot } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";
import { canManageInvoices } from "@/lib/rbac";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, statusLabel } from "@/lib/status-labels";
import {
  defaultSalesVatTreatment,
  invoiceLifecycle,
  invoiceLifecycleLabels,
  isSalesVatTreatment,
  rectificationReasonLabels,
  rectificationTypeLabels,
  salesVatTreatmentOptions,
  vatTreatmentLegalNotes,
  type RectificationReason,
  type RectificationType,
} from "@/server/invoices/lifecycle";
import { getInvoiceBalance, loadStoredLines } from "@/server/invoices/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const tenantContext = await requireContext("invoice.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: invoice.number, invoiceType: invoice.invoiceType })
      .from(invoice)
      .where(and(eq(invoice.id, id), eq(invoice.companyId, tenantContext.company.id)))
      .limit(1);
    return { title: row ? `${row.invoiceType === "CREDIT_NOTE" ? "Rectificativa" : "Factura"} ${row.number}` : "Factura" };
  } catch {
    return { title: "Factura" };
  }
}

function formatParty(party: Pick<InvoicePartySnapshot, "address" | "addressLine2" | "postalCode" | "city" | "province" | "countryCode">) {
  return [party.address, party.addressLine2, [party.postalCode, party.city].filter(Boolean).join(" "), party.province, party.countryCode].filter(Boolean) as string[];
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");
  const { id } = await params;
  const currencyCode = tenantContext.company.baseCurrencyCode;

  const rows = await db
    .select({
      invoice,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerTaxId: partner.taxId,
      customerAddress: partner.address,
      customerAddressLine2: partner.addressLine2,
      customerPostalCode: partner.postalCode,
      customerCity: partner.city,
      customerProvince: partner.province,
      customerCountryCode: partner.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(invoice.customerId, customer.id))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, id), eq(invoice.companyId, tenantContext.company.id)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();
  const data = row.invoice;
  const lifecycle = invoiceLifecycle(data);
  const isCreditNote = data.invoiceType === "CREDIT_NOTE";
  const isDraft = lifecycle === "DRAFT";
  const isIssuedInvoice = lifecycle === "ISSUED" && !isCreditNote;

  const [lines, paymentMethods, payments, selectedPaymentMethods, creditNotes, originalRows, balance] = await Promise.all([
    loadStoredLines(db, data.id),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, tenantContext.company.id))
      .orderBy(paymentMethod.name),
    db
      .select({ id: payment.id, number: payment.number, amountApplied: invoicePayment.amountApplied, postedAt: payment.postedAt })
      .from(invoicePayment)
      .innerJoin(payment, eq(payment.id, invoicePayment.paymentId))
      .where(and(eq(invoicePayment.companyId, tenantContext.company.id), eq(invoicePayment.invoiceId, data.id)))
      .orderBy(payment.postedAt),
    db.select({
      name: invoicePaymentMethod.name,
      type: invoicePaymentMethod.type,
      bankAccountNumber: invoicePaymentMethod.bankAccountNumber,
      position: invoicePaymentMethod.position,
    }).from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, data.id))
      .orderBy(invoicePaymentMethod.position),
    isCreditNote
      ? Promise.resolve([])
      : db
          .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate, totalAmount: invoice.totalAmount, status: invoice.status, issuedAt: invoice.issuedAt, rectificationReason: invoice.rectificationReason })
          .from(invoice)
          .where(and(eq(invoice.companyId, tenantContext.company.id), eq(invoice.rectifiedInvoiceId, data.id)))
          .orderBy(asc(invoice.createdAt)),
    data.rectifiedInvoiceId
      ? db
          .select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate })
          .from(invoice)
          .where(and(eq(invoice.id, data.rectifiedInvoiceId), eq(invoice.companyId, tenantContext.company.id)))
          .limit(1)
      : Promise.resolve([]),
    getInvoiceBalance(db, tenantContext.company.id, data.id, data.totalAmount),
  ]);
  const original = originalRows[0] ?? null;

  const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });
  const canEditInvoice = canManageInvoices(tenantContext.membership.role);
  const outstanding = isIssuedInvoice ? balance.outstandingCents / 100 : 0;

  // Emitidas: datos fiscales congelados al emitir. Borradores / antiguas: datos actuales.
  const party: InvoicePartySnapshot = data.customerSnapshot ?? {
    name: row.customerName,
    taxId: row.customerTaxId,
    address: row.customerAddress,
    addressLine2: row.customerAddressLine2,
    postalCode: row.customerPostalCode,
    city: row.customerCity,
    province: row.customerProvince,
    countryCode: row.customerCountryCode,
    email: row.customerEmail,
    phone: row.customerPhone,
  };
  const vatTreatment = isSalesVatTreatment(data.vatTreatment) ? data.vatTreatment : defaultSalesVatTreatment(party.countryCode);
  const vatTreatmentLabel = salesVatTreatmentOptions.find((option) => option.value === vatTreatment)?.label ?? vatTreatment;
  const legalNote = vatTreatmentLegalNotes[vatTreatment];
  const displayedPaymentMethods = selectedPaymentMethods.length > 0
    ? selectedPaymentMethods
    : data.paymentMethodName
      ? [{ name: data.paymentMethodName, type: data.paymentMethodType, bankAccountNumber: data.paymentBankAccountNumber, position: 0 }]
      : [];
  const documentNoun = isCreditNote ? "Rectificativa" : "Factura";

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Facturas", href: "/invoices" },
          { label: data.number },
        ]}
        title={data.number}
        description={
          isDraft
            ? `Borrador de ${isCreditNote ? "rectificativa" : "factura"} para ${party.name}. Aún no tiene número definitivo ni validez fiscal.`
            : isCreditNote
              ? `Factura rectificativa emitida a ${party.name}${original ? ` · rectifica ${original.number}` : ""}.`
              : `Factura emitida a ${party.name}.`
        }
        meta={
          <>
            <StatusBadge tone={lifecycle === "ISSUED" ? "info" : lifecycle === "VOID" ? "danger" : "neutral"}>
              {invoiceLifecycleLabels[lifecycle]}
            </StatusBadge>
            {isCreditNote ? <StatusBadge tone="warning">Rectificativa</StatusBadge> : null}
            {isIssuedInvoice ? (
              <StatusBadge tone={invoicePaymentStatusTone(data.paymentStatus)}>Cobro: {statusLabel(invoicePaymentStatusLabels, data.paymentStatus)}</StatusBadge>
            ) : null}
          </>
        }
        actions={
          <>
            {canEditInvoice && isDraft ? (
              <>
                {!isCreditNote ? (
                  <Link className={buttonVariants({ variant: "outline" })} data-testid="invoice-edit-link" href={`/invoices/${data.id}/edit`}>
                    Editar
                  </Link>
                ) : null}
                <IssueInvoiceButton invoiceId={data.id} isCreditNote={isCreditNote} />
              </>
            ) : null}
            {canEditInvoice && isIssuedInvoice ? (
              <>
                <RegisterInvoicePaymentDialog
                  invoice={{
                    id: data.id,
                    number: data.number,
                    paymentStatus: data.paymentStatus,
                    totalAmount: Number(data.totalAmount),
                    totalAmountLabel: formatMoney(data.totalAmount.toString(), currencyCode),
                    outstandingAmount: outstanding,
                  }}
                  paymentMethods={paymentMethods}
                />
                {balance.totalCents + balance.creditedCents > 0 ? (
                  <Link className={buttonVariants({ variant: "outline" })} data-testid="invoice-create-credit-note" href={`/invoices/${data.id}/rectify`}>
                    Crear rectificativa
                  </Link>
                ) : null}
              </>
            ) : null}
            {canEditInvoice && !isCreditNote ? <DuplicateInvoiceButton invoiceId={data.id} /> : null}
            <Link className={buttonVariants()} href={`/api/invoices/${data.id}/pdf`} prefetch={false} target="_blank">
              PDF
            </Link>
          </>
        }
      />

      {isDraft ? (
        <InlineAlert data-testid="invoice-draft-notice" title="Borrador" tone="info">
          Puedes editarlo libremente. Al pulsar «Emitir {isCreditNote ? "rectificativa" : "factura"}» se le asigna el número definitivo de la serie, se contabiliza y queda bloqueado.
          {canEditInvoice ? (
            <span className="mt-2 block">
              <DeleteButton
                description={`Se anulará el borrador ${data.number}. No consume número de factura ni tiene efectos contables.`}
                label="Anular borrador"
                successMessage="Borrador anulado."
                testId={`invoice-void-${data.id}`}
                title={`Anular borrador ${data.number}`}
                url={`/api/invoices/${data.id}`}
              />
            </span>
          ) : null}
        </InlineAlert>
      ) : null}
      {lifecycle === "ISSUED" && canEditInvoice ? (
        <p className="text-xs text-muted-foreground" data-testid="invoice-locked-hint">
          {documentNoun} emitida: cliente, fechas, líneas e importes no se pueden cambiar.{" "}
          {isIssuedInvoice ? "Para corregirla crea una rectificativa. " : ""}
          <Link className="underline" href={`/invoices/${data.id}/edit`}>Editar notas o formas de pago</Link>
        </p>
      ) : null}

      {isCreditNote ? (
        <PageSection title="Factura rectificada" description="Referencia obligatoria de la factura original y causa de la rectificación.">
          <dl className="grid gap-4 text-sm sm:grid-cols-2" data-testid="credit-note-reference">
            <div>
              <dt className="text-muted-foreground">Factura original</dt>
              <dd className="font-medium">
                {original ? <Link className="font-mono text-primary underline" href={`/invoices/${original.id}`}>{original.number}</Link> : "—"}
                {original ? ` · ${formatDate(original.issueDate)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Causa y tipo</dt>
              <dd className="font-medium">
                {data.rectificationReason && data.rectificationReason in rectificationReasonLabels ? rectificationReasonLabels[data.rectificationReason as RectificationReason] : "—"}
                {data.rectificationType && data.rectificationType in rectificationTypeLabels ? ` · ${rectificationTypeLabels[data.rectificationType as RectificationType]}` : ""}
              </dd>
            </div>
            {data.rectificationDescription ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Motivo</dt>
                <dd className="font-medium">{data.rectificationDescription}</dd>
              </div>
            ) : null}
          </dl>
        </PageSection>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <PageSection className="lg:col-span-2" title="Datos generales">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Fecha de emisión</dt>
              <dd className="font-medium">{formatDate(data.issueDate)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Fecha de vencimiento</dt>
              <dd className="font-medium">{data.dueDate ? formatDate(data.dueDate) : "Sin vencimiento"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-medium">{formatMoney(data.totalAmount.toString(), currencyCode)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tratamiento de IVA</dt>
              <dd className="font-medium">{vatTreatmentLabel}</dd>
              {legalNote ? <dd className="text-xs text-muted-foreground">{legalNote}</dd> : null}
            </div>
            {isIssuedInvoice ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Saldo</dt>
                <dd className="font-mono text-sm" data-testid="invoice-balance">
                  Total {formatMoney(balance.totalCents / 100, currencyCode)}
                  {balance.creditedCents !== 0 ? ` · Rectificado ${formatMoney(balance.creditedCents / 100, currencyCode)}` : ""}
                  {` · Cobrado ${formatMoney(balance.paidCents / 100, currencyCode)}`}
                  {` · Pendiente ${formatMoney(outstanding, currencyCode)}`}
                </dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="font-medium">{data.notes || "Sin notas"}</dd>
            </div>
          </dl>
        </PageSection>

        <PageSection title="Cliente" description={data.customerSnapshot ? "Datos fiscales en el momento de la emisión." : undefined}>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">{party.name}</p>
              <p className="text-muted-foreground">{party.taxId || "Sin CIF/NIF/VAT"}</p>
            </div>
            {formatParty(party).length > 0 ? (
              <address className="not-italic text-muted-foreground">
                {formatParty(party).map((line) => <p key={line}>{line}</p>)}
              </address>
            ) : null}
            <div className="text-muted-foreground">
              {party.email ? <p>{party.email}</p> : null}
              {party.phone ? <p>{party.phone}</p> : null}
            </div>
          </div>
        </PageSection>
      </div>

      {displayedPaymentMethods.length > 0 && !isCreditNote ? (
        <PageSection title="Formas de pago" description="Alternativas indicadas para el pago de esta factura.">
          <div className="grid gap-3 md:grid-cols-2">
            {displayedPaymentMethods.map((method, index) => {
              const typeLabel = method.type && method.type in paymentMethodTypeLabels
                ? paymentMethodTypeLabels[method.type as PaymentMethodType]
                : null;
              return (
                <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm" key={`${method.name}-${method.position}-${index}`}>
                  <p className="font-medium">{method.name}</p>
                  {typeLabel ? <p className="text-muted-foreground">{typeLabel}</p> : null}
                  {method.bankAccountNumber ? <p className="mt-2 font-mono">Cuenta: {method.bankAccountNumber}</p> : null}
                </div>
              );
            })}
          </div>
        </PageSection>
      ) : null}

      <PageSection title="Líneas" description="Detalle de conceptos, cantidades, impuestos e importes.">
        <div className="overflow-x-auto rounded-[2px] border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Impuestos</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={`${line.description}-${index}`}>
                  <TableCell className="font-medium">{line.description}</TableCell>
                  <TableCell className="text-right">{Number(line.quantity).toLocaleString("es-ES")}</TableCell>
                  <TableCell className="text-right">{formatMoney(line.unitPrice, currencyCode)}</TableCell>
                  <TableCell className="text-right">
                    {(line.taxes ?? []).map((selectedTax) => (
                      <span className="block" key={`${selectedTax.name}-${selectedTax.rate}-${selectedTax.operation}`}>
                        {selectedTax.operation === "SUBTRACT" ? "−" : "+"}{selectedTax.name} {Number(selectedTax.rate).toLocaleString("es-ES")}%
                      </span>
                    ))}
                    {!line.taxes ? `${Number(line.taxRate ?? 0).toLocaleString("es-ES")}%` : null}
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(totals.lines[index]?.lineTotal ?? 0, currencyCode)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <dl className="ml-auto mt-4 w-full max-w-sm space-y-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 font-mono text-sm">
          <div className="flex justify-between gap-3">
            <dt>Base imponible</dt>
            <dd>{formatMoney(totals.subtotal, currencyCode)}</dd>
          </div>
          {totals.taxBuckets.map((bucket) => (
            <div className="flex justify-between gap-3" key={`${bucket.name}-${bucket.rate}-${bucket.operation}`}>
              <dt>{bucket.operation === "SUBTRACT" ? "−" : "+"} {bucket.name} ({bucket.rate.toLocaleString("es-ES")}% s/ {formatMoney(bucket.baseAmount, currencyCode)})</dt>
              <dd>{bucket.operation === "SUBTRACT" ? "−" : ""}{formatMoney(bucket.amount, currencyCode)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(data.totalAmount.toString(), currencyCode)}</dd>
          </div>
        </dl>
      </PageSection>

      {!isCreditNote && creditNotes.length > 0 ? (
        <PageSection title="Rectificativas" description="Facturas rectificativas que corrigen esta factura.">
          <div className="divide-y border-y" data-testid="invoice-credit-notes">
            {creditNotes.map((note) => (
              <div className="flex items-center justify-between gap-3 py-3 text-sm" key={note.id}>
                <span>
                  <Link className="block font-mono font-semibold text-primary hover:underline" href={`/invoices/${note.id}`}>{note.number}</Link>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(note.issueDate)} · {invoiceLifecycleLabels[invoiceLifecycle(note)]}{note.rectificationReason ? ` · ${note.rectificationReason}` : ""}
                  </span>
                </span>
                <span className="font-mono font-semibold">{formatMoney(note.totalAmount, currencyCode)}</span>
              </div>
            ))}
          </div>
        </PageSection>
      ) : null}

      {lifecycle === "ISSUED" ? <InvoiceVerifactuCard companyId={tenantContext.company.id} invoiceId={id} /> : null}

      {isIssuedInvoice ? (
        <PageSection title="Cobros" description="Cobros registrados y aplicados a esta factura.">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay cobros registrados.</p>
          ) : (
            <div className="divide-y border-y">
              {payments.map((entry) => (
                <div className="flex items-center justify-between gap-3 py-3 text-sm" key={entry.id}>
                  <span><span className="block font-mono font-semibold">{entry.number}</span><span className="text-xs text-muted-foreground">{formatDate(entry.postedAt)}</span></span>
                  <span className="font-mono font-semibold">{formatMoney(entry.amountApplied, currencyCode)}</span>
                </div>
              ))}
            </div>
          )}
        </PageSection>
      ) : null}
    </PageShell>
  );
}
