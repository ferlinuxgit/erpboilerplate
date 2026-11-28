import type { Metadata } from "next";

import { CorporateTaxPrintButton } from "@/components/fiscal/corporate-tax-extras";
import { CorporateTaxNotAvailable, CorporateTaxYearNav } from "@/components/fiscal/corporate-tax-shared";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import type { OfficialStatementLine } from "@/server/accounting/official-statements-model";
import { CORPORATE_TAX_REGIME_LABELS, type CorporateTaxRegime } from "@/server/corporate-tax/rates";
import { getCorporateTaxStatements, getCorporateTaxYear, isCorporateTaxCompany } from "@/server/corporate-tax/service";
import { formatModel200Box, model200BoxesWarning, MODEL_200_BOXES_SOURCE, PROFIT_AND_LOSS_RESULT_BOX, statementBox, TAX_CORRECTION_BOXES } from "@/server/corporate-tax/model-200-boxes";
import { liquidationRows } from "@/server/corporate-tax/summary";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { formatIsoDate } from "@/server/fixed-assets/schedule";

export const metadata: Metadata = { title: "Resumen del Impuesto sobre Sociedades" };

export default async function CorporateTaxSummaryPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  if (!(await isCorporateTaxCompany(ctx.company.id, ctx.company.countryCode))) return <CorporateTaxNotAvailable />;

  const params = await searchParams;
  const requested = typeof params.year === "string" ? params.year : null;
  const fiscalYearId = ctx.availableFiscalYears.find((year) => year.id === requested)?.id ?? ctx.fiscalYear.id;
  const [view, official] = await Promise.all([getCorporateTaxYear(ctx.company.id, fiscalYearId), getCorporateTaxStatements(ctx.company.id, fiscalYearId)]);
  const currency = ctx.company.baseCurrencyCode;
  const money = (value: number) => formatMoney(value, currency);
  const rows = liquidationRows(view);
  const previousLabel = official.previousYearCode ?? undefined;
  const boxesWarning = model200BoxesWarning(view.year.startYear);

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} download href={`/api/corporate-tax/returns/${encodeURIComponent(fiscalYearId)}/export`}>Exportar a Excel</a>
            <CorporateTaxPrintButton />
          </>
        }
        backHref={`/fiscal/sociedades?year=${encodeURIComponent(fiscalYearId)}`}
        backLabel="Volver a la liquidación"
        description={`${ctx.company.name} · ejercicio ${view.year.code}: del ${formatIsoDate(view.year.start)} al ${formatIsoDate(view.year.end)}.`}
        eyebrow="Fiscalidad · Impuesto sobre Sociedades"
        title="Resumen para Sociedades WEB"
      />
      <CorporateTaxYearNav basePath="/fiscal/sociedades/resumen" current={fiscalYearId} years={ctx.availableFiscalYears} />

      <InlineAlert title="Estos importes se copian a mano en Sociedades WEB" tone="info">
        El modelo 200 se presenta en la sede electrónica de la AEAT con el formulario Sociedades WEB. El programa prepara los importes; no presenta la declaración ni genera su fichero.
        {" "}Cada importe lleva su casilla y la página del modelo según el <a className="underline" href={MODEL_200_BOXES_SOURCE.url} rel="noreferrer" target="_blank">{MODEL_200_BOXES_SOURCE.label}</a>; las líneas sin casilla no tienen una equivalente única: búscalas por su nombre.
        {" "}En la página 12, la casilla {PROFIT_AND_LOSS_RESULT_BOX.box} es el resultado después de impuestos y las casillas {TAX_CORRECTION_BOXES.increase.box}/{TAX_CORRECTION_BOXES.decrease.box} corrigen el gasto o ingreso por el propio impuesto; su suma es el resultado antes de impuestos de la casilla 00501.
      </InlineAlert>
      {boxesWarning ? <InlineAlert tone="warning">{boxesWarning}</InlineAlert> : null}
      {view.warnings.length > 0 ? (
        <InlineAlert title="Revisa antes de presentar" tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {view.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
          </ul>
        </InlineAlert>
      ) : null}

      <PageSection
        description={`${CORPORATE_TAX_REGIME_LABELS[view.inputs.regime as CorporateTaxRegime] ?? "Tipo general"} · ${view.result.schedule.source}${view.status === "filed" ? " · marcada como presentada" : " · borrador"}`}
        title="Liquidación"
      >
        <TableContainer label="Liquidación del Impuesto sobre Sociedades">
          <Table className="[&_td:last-child]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead className="whitespace-nowrap">Casilla</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow className={row.kind === "total" ? "bg-window-panel font-bold" : undefined} key={row.key}>
                  <TableCell className={row.kind === "detail" ? "pl-8 text-muted-foreground" : undefined}>{row.label}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{formatModel200Box(row.box) || "—"}</TableCell>
                  <TableCell className={`text-right font-mono ${row.kind === "detail" ? "text-muted-foreground" : ""}`}>{money(row.cents / 100)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <PageSection description="Modelo abreviado del Plan General de Contabilidad, con el ejercicio anterior." title="Balance">
        {official.statements.difference !== 0 ? (
          <InlineAlert className="mb-2" tone="danger">El balance no cuadra: activo y patrimonio neto más pasivo difieren en {money(official.statements.difference)}. Revisa el libro antes de presentar.</InlineAlert>
        ) : null}
        <div className="grid gap-3 xl:grid-cols-2 print:grid-cols-1">
          <OfficialTable caption="Activo" currentLabel={view.year.code} lines={official.statements.assets} money={money} previousLabel={previousLabel} />
          <OfficialTable caption="Patrimonio neto y pasivo" currentLabel={view.year.code} lines={official.statements.equityAndLiabilities} money={money} previousLabel={previousLabel} />
        </div>
      </PageSection>

      <PageSection description="Modelo abreviado. El epígrafe 17 recoge el impuesto ya contabilizado." title="Cuenta de pérdidas y ganancias">
        <OfficialTable caption="Cuenta de pérdidas y ganancias" currentLabel={view.year.code} lines={official.statements.incomeStatement} money={money} previousLabel={previousLabel} />
        {!view.entry.posted && view.entry.lines.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">El impuesto de este ejercicio todavía no está contabilizado: el resultado del ejercicio que ves es antes de impuestos. Contabilízalo desde la liquidación para que la cuenta de pérdidas y ganancias quede completa.</p>
        ) : null}
      </PageSection>
    </PageShell>
  );
}

/** Estado en el modelo oficial: epígrafes con sangría, totales en negrita y columna del ejercicio anterior. */
function OfficialTable({ caption, currentLabel, lines, money, previousLabel }: { caption: string; currentLabel: string; lines: OfficialStatementLine[]; money: (value: number) => string; previousLabel?: string }) {
  const indent = ["", "pl-5", "pl-8", "pl-11"];
  return (
    <TableContainer label={caption}>
      <Table className="[&_td:not(:first-child)]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>{caption}</TableHead>
            <TableHead className="whitespace-nowrap">Casilla</TableHead>
            <TableHead className="text-right">{currentLabel}</TableHead>
            {previousLabel ? <TableHead className="text-right">{previousLabel}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const strong = line.kind === "total" || line.depth === 0;
            return (
              <TableRow className={strong ? "bg-window-panel font-bold" : undefined} key={line.id}>
                <TableCell className={indent[Math.min(line.depth, indent.length - 1)]}>{line.label}</TableCell>
                <TableCell className="font-mono text-xs">{formatModel200Box(statementBox(line.id)) || "—"}</TableCell>
                <TableCell className="text-right font-mono">{line.amount === 0 && !strong ? "—" : money(line.amount)}</TableCell>
                {previousLabel ? <TableCell className="text-right font-mono">{!line.previous && !strong ? "—" : money(line.previous ?? 0)}</TableCell> : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
