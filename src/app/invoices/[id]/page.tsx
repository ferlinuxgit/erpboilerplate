import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";

import { RegisterInvoicePaymentDialog } from "@/components/invoices/register-invoice-payment-dialog";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customer, invoice, invoiceLine, invoiceLineTax, invoicePayment, invoicePaymentMethod, partner, payment, paymentMethod } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";
import { canManageInvoices } from "@/lib/rbac";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, invoiceStatusLabels, invoiceStatusTone, statusLabel } from "@/lib/status-labels";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");
  const { id } = await params;

  const rows = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      notes: invoice.notes,
      paymentMethodName: invoice.paymentMethodName,
      paymentMethodType: invoice.paymentMethodType,
      paymentBankAccountNumber: invoice.paymentBankAccountNumber,
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

  const data = rows[0];
  if (!data) notFound();

  const [lines, paymentMethods, payments, selectedPaymentMethods] = await Promise.all([
    db
      .select({
        id: invoiceLine.id,
        description: invoiceLine.description,
        quantity: invoiceLine.quantity,
        unitPrice: invoiceLine.unitPrice,
        discountPct: invoiceLine.discountPct,
        taxRate: invoiceLine.taxRate,
        retentionRate: invoiceLine.retentionRate,
        lineTotal: invoiceLine.lineTotal,
      })
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, data.id)),
    db
      .select({ id: paymentMethod.id, name: paymentMethod.name })
      .from(paymentMethod)
      .where(eq(paymentMethod.companyId, tenantContext.company.id))
      .orderBy(paymentMethod.name),
    db
      .select({
        id: payment.id,
        number: payment.number,
        amountApplied: invoicePayment.amountApplied,
        postedAt: payment.postedAt,
      })
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
  ]);

  const selectedTaxes = lines.length > 0
    ? await db.select({
        invoiceLineId: invoiceLineTax.invoiceLineId,
        name: invoiceLineTax.name,
        rate: invoiceLineTax.rate,
        kind: invoiceLineTax.kind,
        operation: invoiceLineTax.operation,
      }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.id)))
    : [];
  const taxesByLine = new Map<string, typeof selectedTaxes>();
  for (const selectedTax of selectedTaxes) {
    taxesByLine.set(selectedTax.invoiceLineId, [...(taxesByLine.get(selectedTax.invoiceLineId) ?? []), selectedTax]);
  }

  const numericLines = lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    discountPct: Number(line.discountPct),
    taxRate: Number(line.taxRate),
    retentionRate: Number(line.retentionRate),
    taxes: taxesByLine.get(line.id)?.map((selectedTax) => ({
      name: selectedTax.name,
      rate: Number(selectedTax.rate),
      kind: selectedTax.kind,
      operation: selectedTax.operation === "SUBTRACT" ? "SUBTRACT" as const : "ADD" as const,
    })),
  }));
  const totals = calculateInvoiceTotals(numericLines);
  const taxBreakdown = new Map<string, { name: string; rate: number; operation: "ADD" | "SUBTRACT"; amount: number }>();
  for (const lineTotal of totals.lines) {
    for (const selectedTax of lineTotal.taxes) {
      const name = selectedTax.name ?? (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto");
      const key = `${name}-${selectedTax.rate}-${selectedTax.operation}`;
      const row = taxBreakdown.get(key) ?? { name, rate: selectedTax.rate, operation: selectedTax.operation, amount: 0 };
      row.amount = Math.round((row.amount + selectedTax.amount + Number.EPSILON) * 100) / 100;
      taxBreakdown.set(key, row);
    }
  }
  const canEditInvoice = canManageInvoices(tenantContext.membership.role);
  const customerAddress = [
    data.customerAddress,
    data.customerAddressLine2,
    [data.customerPostalCode, data.customerCity].filter(Boolean).join(" "),
    data.customerProvince,
    data.customerCountryCode,
  ].filter(Boolean);
  const displayedPaymentMethods = selectedPaymentMethods.length > 0
    ? selectedPaymentMethods
    : data.paymentMethodName
      ? [{ name: data.paymentMethodName, type: data.paymentMethodType, bankAccountNumber: data.paymentBankAccountNumber, position: 0 }]
      : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas"
        title={data.number}
        description={`Factura emitida a ${data.customerName}.`}
        meta={
          <>
            <StatusBadge tone={invoiceStatusTone(data.status)}>{statusLabel(invoiceStatusLabels, data.status)}</StatusBadge>
            <StatusBadge tone={invoicePaymentStatusTone(data.paymentStatus)}>Cobro: {statusLabel(invoicePaymentStatusLabels, data.paymentStatus)}</StatusBadge>
          </>
        }
        backHref="/invoices"
        backLabel="Volver a facturas"
        actions={
          <>
            {canEditInvoice ? (
              <Link className={buttonVariants({ variant: "outline" })} href={`/invoices/${data.id}/edit`}>
                Editar
              </Link>
            ) : null}
            <RegisterInvoicePaymentDialog
              invoice={{
                id: data.id,
                number: data.number,
                paymentStatus: data.paymentStatus,
                totalAmount: Number(data.totalAmount),
                totalAmountLabel: formatMoney(data.totalAmount.toString(), tenantContext.company.baseCurrencyCode),
              }}
              paymentMethods={paymentMethods}
            />
            <Link className={buttonVariants()} href={`/api/invoices/${data.id}/pdf`} target="_blank">
              PDF
            </Link>
          </>
        }
      />

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
              <dd className="font-medium">{formatMoney(data.totalAmount.toString(), tenantContext.company.baseCurrencyCode)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="font-medium">{data.notes || "Sin notas"}</dd>
            </div>
          </dl>
        </PageSection>

        <PageSection title="Cliente">
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">{data.customerName}</p>
              <p className="text-muted-foreground">{data.customerTaxId || "Sin CIF/NIF/VAT"}</p>
            </div>
            {customerAddress.length > 0 ? (
              <address className="not-italic text-muted-foreground">
                {customerAddress.map((line) => <p key={line}>{line}</p>)}
              </address>
            ) : null}
            <div className="text-muted-foreground">
              {data.customerEmail ? <p>{data.customerEmail}</p> : null}
              {data.customerPhone ? <p>{data.customerPhone}</p> : null}
            </div>
          </div>
        </PageSection>
      </div>

      {displayedPaymentMethods.length > 0 ? (
        <PageSection title="Formas de pago" description="Alternativas indicadas para el pago de esta factura.">
          <div className="grid gap-3 md:grid-cols-2">
            {displayedPaymentMethods.map((method, index) => {
              const typeLabel = method.type && method.type in paymentMethodTypeLabels
                ? paymentMethodTypeLabels[method.type as PaymentMethodType]
                : null;
              return (
                <div className="rounded-md border bg-muted/30 p-3 text-sm" key={`${method.name}-${method.position}-${index}`}>
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
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.description}</TableCell>
                  <TableCell className="text-right">{Number(line.quantity).toLocaleString("es-ES")}</TableCell>
                  <TableCell className="text-right">{formatMoney(line.unitPrice.toString(), tenantContext.company.baseCurrencyCode)}</TableCell>
                  <TableCell className="text-right">
                    {(taxesByLine.get(line.id) ?? []).map((selectedTax) => (
                      <span className="block" key={`${selectedTax.name}-${selectedTax.rate}`}>
                        {selectedTax.operation === "SUBTRACT" ? "−" : "+"}{selectedTax.name} {Number(selectedTax.rate).toLocaleString("es-ES")}%
                      </span>
                    ))}
                    {(taxesByLine.get(line.id) ?? []).length === 0 ? `${Number(line.taxRate).toLocaleString("es-ES")}%` : null}
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(line.lineTotal.toString(), tenantContext.company.baseCurrencyCode)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <dl className="ml-auto mt-4 w-full max-w-sm space-y-2 rounded-md bg-muted p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt>Subtotal</dt>
            <dd>{formatMoney(totals.subtotal, tenantContext.company.baseCurrencyCode)}</dd>
          </div>
          {[...taxBreakdown.values()].map((row) => (
            <div className="flex justify-between gap-3" key={`${row.name}-${row.rate}-${row.operation}`}>
              <dt>{row.operation === "SUBTRACT" ? "−" : "+"} {row.name} ({row.rate.toLocaleString("es-ES") }%)</dt>
              <dd>{row.operation === "SUBTRACT" ? "−" : ""}{formatMoney(row.amount, tenantContext.company.baseCurrencyCode)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(data.totalAmount.toString(), tenantContext.company.baseCurrencyCode)}</dd>
          </div>
        </dl>
      </PageSection>

      <PageSection title="Cobros" description="Cobros registrados y aplicados a esta factura.">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay cobros registrados.</p>
        ) : (
          <div className="divide-y border-y">
            {payments.map((payment) => (
              <div className="flex items-center justify-between gap-3 py-3 text-sm" key={payment.id}>
                <span><span className="block font-mono font-semibold">{payment.number}</span><span className="text-xs text-muted-foreground">{formatDate(payment.postedAt)}</span></span>
                <span className="font-mono font-semibold">{formatMoney(payment.amountApplied, tenantContext.company.baseCurrencyCode)}</span>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
