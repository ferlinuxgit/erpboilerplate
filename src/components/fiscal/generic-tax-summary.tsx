import Link from "next/link";

import { InlineAlert, MetricCard } from "@/components/ui/page";
import { MobileRecord, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CountryFiscalProfile } from "@/lib/country-packs/profile";
import { salesVatTreatmentLabels, type SalesVatTreatment } from "@/lib/fiscal-spain";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaxSummary, TaxSummaryPeriod } from "@/server/fiscal/tax-summary";

type Row = { key: string; concept: string; base: number | null; tax: number; strong?: boolean };

function formatRate(rate: number) {
  return `${rate.toLocaleString("es-ES", { maximumFractionDigits: 3 })} %`;
}

/**
 * Resumen de impuestos del periodo para países sin modelos oficiales: lo cobrado en las facturas
 * menos lo deducible de los gastos, listo para trasladarlo a la declaración del país.
 */
export function GenericTaxSummary({
  country,
  currencyCode,
  periods,
  summary,
}: {
  country: CountryFiscalProfile;
  currencyCode: string;
  periods: TaxSummaryPeriod[];
  summary: TaxSummary;
}) {
  const tax = country.taxLabel;
  const rows: Row[] = [
    ...summary.output.map((bucket) => ({ key: `out-${bucket.rate}`, concept: `${tax} repercutido al ${formatRate(bucket.rate)}`, base: bucket.base, tax: bucket.tax })),
    ...summary.surcharge.map((bucket) => ({ key: `sur-${bucket.rate}`, concept: `Recargo al ${formatRate(bucket.rate)}`, base: bucket.base, tax: bucket.tax })),
    ...(summary.selfAssessed !== 0 ? [{ key: "self", concept: `${tax} autorepercutido (compras UE / inversión del sujeto pasivo)`, base: null, tax: summary.selfAssessed }] : []),
    { key: "accrued", concept: `Total ${tax} devengado`, base: null, tax: summary.accrued, strong: true },
    { key: "deductible", concept: `${tax} deducible de gastos y compras`, base: null, tax: -summary.deductible },
    { key: "result", concept: summary.result >= 0 ? "Resultado a ingresar" : "Resultado a compensar o devolver", base: null, tax: summary.result, strong: true },
  ];

  return (
    <div className="space-y-3">
      <nav aria-label="Periodo" className="flex flex-wrap gap-1">
        {periods.map((period) => (
          <Link
            aria-current={period.key === summary.period.key ? "page" : undefined}
            className={cn(
              "border px-2 py-1 font-mono text-xs",
              period.key === summary.period.key ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-card hover:bg-window-highlight",
            )}
            href={`/fiscal?period=${period.key}`}
            key={period.key}
          >
            {period.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-2 sm:grid-cols-3">
        <MetricCard label={`${tax} devengado`} value={formatMoney(summary.accrued, currencyCode)} helper={`${summary.issuedCount} facturas emitidas`} />
        <MetricCard label={`${tax} deducible`} value={formatMoney(summary.deductible, currencyCode)} helper={`${summary.receivedCount} facturas recibidas (soportado: ${formatMoney(summary.inputCharged, currencyCode)})`} />
        <MetricCard
          label={summary.result >= 0 ? "A ingresar" : "A compensar"}
          tone={summary.result > 0 ? "warning" : "success"}
          value={formatMoney(Math.abs(summary.result), currencyCode)}
          helper={summary.period.label}
        />
      </div>

      {summary.draftInvoiceCount > 0 ? (
        <InlineAlert tone="warning">
          Hay {summary.draftInvoiceCount} {summary.draftInvoiceCount === 1 ? "factura en borrador" : "facturas en borrador"} en el periodo: no cuentan hasta que las emitas.
        </InlineAlert>
      ) : null}

      <TableContainer className="hidden md:block">
        <Table>
          <caption className="sr-only">Resumen de {tax} de {summary.period.label}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">Cuota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className={row.strong ? "font-bold" : undefined}>{row.concept}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{row.base === null ? "" : formatMoney(row.base, currencyCode)}</TableCell>
                <TableCell className={cn("whitespace-nowrap text-right", row.strong && "font-bold")}>{formatMoney(row.tax, currencyCode)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <MobileRecordList aria-label={`Resumen de ${tax} de ${summary.period.label}`}>
        {rows.map((row) => (
          <MobileRecord aside={formatMoney(row.tax, currencyCode)} key={row.key} title={row.concept}>
            {row.base === null ? null : <p className="text-xs text-muted-foreground">Base {formatMoney(row.base, currencyCode)}</p>}
          </MobileRecord>
        ))}
      </MobileRecordList>

      {summary.untaxedSales.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <p className="font-bold">Ventas sin {tax} del periodo (base):</p>
          <ul className="mt-1 list-inside list-disc">
            {summary.untaxedSales.map((entry) => (
              <li key={entry.treatment}>
                {salesVatTreatmentLabels[entry.treatment as SalesVatTreatment] ?? entry.treatment}: {formatMoney(entry.base, currencyCode)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
