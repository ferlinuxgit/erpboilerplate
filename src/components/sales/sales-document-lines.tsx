import { InvoiceTotalsSummary } from "@/components/invoices/invoice-form-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDecimalInput, formatMoney, formatPercent } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";

type CommercialLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice?: string;
  discountPct?: string;
  taxRate?: string;
  retentionRate?: string;
  lineTotal?: string;
};

const quantityLabel = (value: string) => formatDecimalInput(Number(value), { maximumFractionDigits: 3 });

/** Read-only lines of a quote / order / delivery note, with the same totals box as the editors. */
export function SalesDocumentLines({ currencyCode, lines, showTotals = false }: { currencyCode: string; lines: CommercialLine[]; showTotals?: boolean }) {
  const priced = lines.some((line) => line.unitPrice !== undefined);
  const hasDiscount = lines.some((line) => Number(line.discountPct ?? 0) > 0);
  const totals = priced
    ? calculateInvoiceTotals(
        lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice ?? 0),
          discountPct: Number(line.discountPct ?? 0),
          taxRate: Number(line.taxRate ?? 0),
          retentionRate: Number(line.retentionRate ?? 0),
        })),
      )
    : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:hidden">
        {lines.map((line) => (
          <article className="rounded-[2px] border border-window-dark-shadow bg-card p-2.5" key={line.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-xs font-bold">{line.description}</p>
              <p className="font-mono text-xs font-bold tabular-nums">
                {line.lineTotal ? formatMoney(line.lineTotal, currencyCode) : `${quantityLabel(line.quantity)} uds.`}
              </p>
            </div>
            <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground tabular-nums">
              {quantityLabel(line.quantity)} × {line.unitPrice ? formatMoney(line.unitPrice, currencyCode) : "—"}
              {Number(line.discountPct ?? 0) > 0 ? ` · Dto. ${formatPercent(line.discountPct ?? 0)}` : ""}
              {line.taxRate ? ` · IVA ${formatPercent(line.taxRate)}` : ""}
            </p>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-[2px] border border-window-dark-shadow md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              {priced ? (
                <>
                  <TableHead className="text-right">Precio</TableHead>
                  {hasDiscount ? <TableHead className="text-right">Descuento</TableHead> : null}
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-bold">{line.description}</TableCell>
                <TableCell className="text-right">{quantityLabel(line.quantity)}</TableCell>
                {line.unitPrice !== undefined ? (
                  <>
                    <TableCell className="text-right">{formatMoney(line.unitPrice, currencyCode)}</TableCell>
                    {hasDiscount ? <TableCell className="text-right">{formatPercent(line.discountPct ?? 0)}</TableCell> : null}
                    <TableCell className="text-right">{formatPercent(line.taxRate ?? 0)}</TableCell>
                    <TableCell className="text-right font-bold">{formatMoney(line.lineTotal ?? 0, currencyCode)}</TableCell>
                  </>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {showTotals && totals ? (
        <div className="flex justify-end">
          <div className="w-full max-w-sm">
            <InvoiceTotalsSummary currencyCode={currencyCode} testIdPrefix="sales-document" title="Totales" totals={totals} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
