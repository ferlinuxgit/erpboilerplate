import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customer, invoice, invoiceLine, partner } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
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

  const lines = await db
    .select({
      id: invoiceLine.id,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
      lineTotal: invoiceLine.lineTotal,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, data.id));

  const numericLines = lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    taxRate: Number(line.taxRate),
  }));
  const totals = calculateInvoiceTotals(numericLines);
  const canEditInvoice = canManageInvoices(tenantContext.membership.role);
  const customerAddress = [
    data.customerAddress,
    data.customerAddressLine2,
    [data.customerPostalCode, data.customerCity].filter(Boolean).join(" "),
    data.customerProvince,
    data.customerCountryCode,
  ].filter(Boolean);

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
            <Link className={buttonVariants({ variant: "outline" })} href={`/treasury?invoiceId=${data.id}`}>
              Registrar cobro
            </Link>
            <Link className={buttonVariants()} href={`/api/invoices/${data.id}/pdf`} target="_blank">
              PDF
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
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

      <PageSection title="Líneas" description="Detalle de conceptos, cantidades, IVA e importes.">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.description}</TableCell>
                  <TableCell className="text-right">{Number(line.quantity).toLocaleString("es-ES")}</TableCell>
                  <TableCell className="text-right">{formatMoney(line.unitPrice.toString(), tenantContext.company.baseCurrencyCode)}</TableCell>
                  <TableCell className="text-right">{Number(line.taxRate).toLocaleString("es-ES")}%</TableCell>
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
          <div className="flex justify-between gap-3">
            <dt>IVA</dt>
            <dd>{formatMoney(totals.taxAmount, tenantContext.company.baseCurrencyCode)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(data.totalAmount.toString(), tenantContext.company.baseCurrencyCode)}</dd>
          </div>
        </dl>
      </PageSection>
    </PageShell>
  );
}
