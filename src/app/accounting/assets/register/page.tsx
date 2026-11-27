import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatMoney, formatPercent } from "@/lib/format";
import { formatIsoDate } from "@/server/fixed-assets/schedule";
import { getAssetRegister } from "@/server/fixed-assets/service";

export default async function AssetRegisterPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const ctx = await requireContext("accounting.read");
  const params = await searchParams;
  const requested = typeof params.year === "string" ? params.year : null;
  const fiscalYearId = ctx.availableFiscalYears.find((year) => year.id === requested)?.id ?? ctx.fiscalYear.id;
  const register = await getAssetRegister(ctx.company.id, fiscalYearId);
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const rows = register?.rows ?? [];
  const totals = {
    cost: rows.reduce((sum, row) => sum + row.costCents, 0),
    year: rows.reduce((sum, row) => sum + row.yearDepreciationCents, 0),
    accumulated: rows.reduce((sum, row) => sum + row.accumulatedCents, 0),
    net: rows.reduce((sum, row) => sum + row.netBookValueCents, 0),
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Inmovilizado"
        title="Libro registro de bienes de inversión"
        description={register ? `Ejercicio ${register.year.code}: del ${formatIsoDate(register.year.start)} al ${formatIsoDate(register.year.end)}.` : "Ejercicio no encontrado."}
        backHref="/accounting/assets"
        backLabel="Volver a inmovilizado"
        actions={
          rows.length > 0 ? (
            <a className={buttonVariants()} download href={`/api/fixed-assets/register?fiscalYearId=${encodeURIComponent(fiscalYearId)}&format=xlsx`}>
              Exportar a Excel
            </a>
          ) : null
        }
      />

      <PageSection
        title={`Bienes de inversión de ${register?.year.code ?? "—"}`}
        description="Bienes en uso durante el ejercicio, con la amortización contabilizada en él y la acumulada a su cierre."
        actions={
          ctx.availableFiscalYears.length > 1 ? (
            <nav aria-label="Ejercicio" className="flex flex-wrap gap-1">
              {ctx.availableFiscalYears.map((year) => (
                <Link
                  aria-current={year.id === fiscalYearId ? "page" : undefined}
                  className={buttonVariants({ size: "sm", variant: year.id === fiscalYearId ? "secondary" : "ghost" })}
                  href={`/accounting/assets/register?year=${encodeURIComponent(year.id)}`}
                  key={year.id}
                >
                  {year.code}
                </Link>
              ))}
            </nav>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="Sin bienes en este ejercicio" description="No hay bienes de inmovilizado adquiridos hasta el cierre de este ejercicio." />
        ) : (
          <TableContainer>
            <Table className="min-w-[68rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Adquisición</TableHead>
                  <TableHead>Puesta en func.</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">% anual</TableHead>
                  <TableHead className="text-right">Amort. del ejercicio</TableHead>
                  <TableHead className="text-right">Amort. acumulada</TableHead>
                  <TableHead className="text-right">Valor neto</TableHead>
                  <TableHead>Baja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell className="font-mono font-semibold">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.description}</TableCell>
                    <TableCell className="font-mono">{row.assetAccountCode}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatIsoDate(row.acquisitionDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatIsoDate(row.inServiceDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(row.costCents)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{row.annualPct === null ? "—" : formatPercent(row.annualPct)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(row.yearDepreciationCents)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(row.accumulatedCents)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(row.netBookValueCents)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.disposalDate ? `${formatIsoDate(row.disposalDate)}${row.disposalProceedsCents ? ` · ${money(row.disposalProceedsCents)}` : ""}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Total</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.cost)}</TableCell>
                  <TableCell />
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.year)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.accumulated)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.net)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Las amortizaciones son las contabilizadas en el programa. Es un libro básico: no incluye el IVA soportado ni la regularización de bienes de inversión.
        </p>
      </PageSection>
    </PageShell>
  );
}
