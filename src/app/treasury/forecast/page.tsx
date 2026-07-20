import { and, eq, ne, sql } from "drizzle-orm";

import {
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  invoice,
  invoicePayment,
  supplierInvoice,
  supplierInvoicePayment,
} from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";

export default async function TreasuryForecastPage() {
  const ctx = await requireContext("treasury.read");
  const [receivables, payables] = await Promise.all([
    db
      .select({
        id: invoice.id,
        number: invoice.number,
        dueDate: invoice.dueDate,
        total: invoice.totalAmount,
        applied: sql<string>`coalesce(sum(${invoicePayment.amountApplied}), '0')`,
      })
      .from(invoice)
      .leftJoin(invoicePayment, eq(invoicePayment.invoiceId, invoice.id))
      .where(
        and(
          eq(invoice.companyId, ctx.company.id),
          ne(invoice.paymentStatus, "PAID"),
        ),
      )
      .groupBy(
        invoice.id,
        invoice.number,
        invoice.dueDate,
        invoice.totalAmount,
      ),
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        dueDate: supplierInvoice.dueDate,
        total: supplierInvoice.totalAmount,
        applied: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), '0')`,
      })
      .from(supplierInvoice)
      .leftJoin(
        supplierInvoicePayment,
        eq(supplierInvoicePayment.supplierInvoiceId, supplierInvoice.id),
      )
      .where(
        and(
          eq(supplierInvoice.companyId, ctx.company.id),
          ne(supplierInvoice.paymentStatus, "PAID"),
          ne(supplierInvoice.status, "VOID"),
        ),
      )
      .groupBy(
        supplierInvoice.id,
        supplierInvoice.number,
        supplierInvoice.dueDate,
        supplierInvoice.totalAmount,
      ),
  ]);
  const incoming = receivables.reduce(
    (sum, row) => sum + Number(row.total) - Number(row.applied),
    0,
  );
  const outgoing = payables.reduce(
    (sum, row) => sum + Number(row.total) - Number(row.applied),
    0,
  );
  const cashFlow = incoming - outgoing;
  const rows = [
    ...receivables.map((row) => ({
      ...row,
      type: "Cobro" as const,
      amount: Number(row.total) - Number(row.applied),
    })),
    ...payables.map((row) => ({
      ...row,
      type: "Pago" as const,
      amount: -(Number(row.total) - Number(row.applied)),
    })),
  ].sort(
    (a, b) =>
      (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );
  const currency = ctx.company.baseCurrencyCode;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Previsión de caja"
        description="Cobros y pagos pendientes ordenados por vencimiento contractual."
        backHref="/treasury"
        backLabel="Volver al resumen"
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Cobros previstos"
          value={formatMoney(incoming, currency)}
          helper={`${receivables.length} facturas pendientes`}
          tone="success"
        />
        <MetricCard
          label="Pagos previstos"
          value={formatMoney(outgoing, currency)}
          helper={`${payables.length} facturas de proveedor`}
          tone="warning"
        />
        <MetricCard
          label="Flujo neto"
          value={formatMoney(cashFlow, currency)}
          helper="Sin incluir saldo bancario actual"
          tone={cashFlow >= 0 ? "success" : "warning"}
        />
      </section>
      <PageSection
        title="Calendario de caja"
        description="Importe pendiente después de cobros y pagos parciales."
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Flujo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((row) => (
                  <TableRow key={`${row.type}-${row.id}`}>
                    <TableCell className="font-medium">{row.number}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>
                      {row.dueDate ? formatDate(row.dueDate) : "Sin fecha"}
                    </TableCell>
                    <TableCell
                      className={
                        row.amount >= 0
                          ? "text-right font-mono text-emerald-700"
                          : "text-right font-mono text-amber-700"
                      }
                    >
                      {formatMoney(row.amount, currency)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    className="py-8 text-center text-muted-foreground"
                    colSpan={4}
                  >
                    No hay cobros ni pagos pendientes.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </PageSection>
    </PageShell>
  );
}
