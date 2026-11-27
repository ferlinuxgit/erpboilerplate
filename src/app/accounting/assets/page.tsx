import Link from "next/link";

import { PostDepreciationPanel } from "@/components/accounting/assets/post-depreciation-panel";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileRecord, MobileRecordField, MobileRecordFields, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatMoney, formatPercent } from "@/lib/format";
import { can } from "@/lib/rbac";
import { ASSET_STATUS_LABELS, type AssetStatus } from "@/server/fixed-assets/model";
import { addDays, formatIsoDate } from "@/server/fixed-assets/schedule";
import { getDepreciationFrequency, listFixedAssets, loadFiscalRanges, previewDepreciation } from "@/server/fixed-assets/service";

const statusTone: Record<AssetStatus, "success" | "info" | "neutral"> = { active: "success", fully_depreciated: "info", disposed: "neutral" };

export default async function FixedAssetsPage() {
  const ctx = await requireContext("accounting.read");
  const today = dateInputValue(new Date(), ctx.company.timezone);
  const [assets, frequency, fiscalYears] = await Promise.all([
    listFixedAssets(ctx.company.id, today),
    getDepreciationFrequency(ctx.company.id),
    loadFiscalRanges(ctx.company.id),
  ]);
  const canWrite = can(ctx.membership.role, "accounting.write");
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);

  const activeYear = fiscalYears.find((year) => year.code === ctx.fiscalYear.code) ?? null;
  const lastMonthEnd = addDays(`${today.slice(0, 8)}01`, -1);
  const shortcuts = [
    { label: "Fin del mes pasado", date: lastMonthEnd },
    { label: "Hoy", date: today },
    ...(activeYear ? [{ label: `Cierre de ${activeYear.code}`, date: activeYear.end }] : []),
  ];
  // Mensual: lo vencido hasta el mes pasado. Anual: el cierre del ejercicio activo (si ya ha pasado o es el vigente).
  const defaultUntil = frequency === "annual" && activeYear ? activeYear.end : lastMonthEnd;
  const preview = await previewDepreciation(ctx.company.id, { until: defaultUntil });

  const inUse = assets.filter((asset) => asset.status !== "disposed");
  const totals = {
    cost: inUse.reduce((sum, asset) => sum + asset.costCents, 0),
    accumulated: inUse.reduce((sum, asset) => sum + asset.accumulatedCents, 0),
    remaining: inUse.reduce((sum, asset) => sum + asset.remainingCents, 0),
    unposted: inUse.reduce((sum, asset) => sum + asset.unpostedCents, 0),
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Inmovilizado"
        description="Bienes de inversión, su cuadro de amortización y los asientos de dotación automáticos."
        backHref="/accounting"
        backLabel="Volver al resumen"
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/accounting/assets/register">Libro de bienes de inversión</Link>
            {canWrite ? <Link className={buttonVariants()} href="/accounting/assets/new">Nuevo bien</Link> : null}
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Valor de adquisición" value={money(totals.cost)} helper={`${inUse.length} ${inUse.length === 1 ? "bien en balance" : "bienes en balance"}`} />
        <MetricCard label="Amortizado" value={money(totals.accumulated)} helper="Amortización acumulada" />
        <MetricCard label="Pendiente de amortizar" value={money(totals.remaining)} helper="Valor amortizable que queda" />
        <MetricCard
          label="Sin contabilizar"
          value={money(totals.unposted)}
          helper={totals.unposted > 0 ? `Dotaciones vencidas hasta hoy (${frequency === "monthly" ? "mensuales" : "anuales"})` : "Dotaciones al día"}
          tone={totals.unposted > 0 ? "warning" : "success"}
        />
      </section>

      {assets.length > 0 ? (
        <PageSection title="Contabilizar amortizaciones" description="Genera los asientos de dotación pendientes de todos los bienes hasta la fecha que elijas.">
          <PostDepreciationPanel canWrite={canWrite} currencyCode={currency} initialPreview={preview} shortcuts={shortcuts} />
        </PageSection>
      ) : null}

      <PageSection title="Bienes" description="Valor de adquisición, amortización acumulada y lo que queda por amortizar de cada bien.">
        {assets.length === 0 ? (
          <EmptyState
            title="Todavía no hay bienes registrados"
            description="Da de alta ordenadores, vehículos, maquinaria, mobiliario, reformas o programas informáticos. El programa calcula su cuadro de amortización y contabiliza las dotaciones."
            action={canWrite ? <Link className={buttonVariants()} href="/accounting/assets/new">Nuevo bien</Link> : undefined}
          />
        ) : (
          <>
            <TableContainer className="hidden md:block">
              <Table className="min-w-[60rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Puesta en func.</TableHead>
                    <TableHead className="text-right">% anual</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Amortizado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Sin contabilizar</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/assets/${asset.id}`}>{asset.code}</Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link className="hover:underline" href={`/accounting/assets/${asset.id}`}>{asset.description}</Link>
                      </TableCell>
                      <TableCell className="font-mono">{asset.assetAccountCode}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatIsoDate(asset.inServiceDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{asset.annualPct === null ? "—" : formatPercent(asset.annualPct)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(asset.costCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(asset.accumulatedCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{asset.status === "disposed" ? "—" : money(asset.remainingCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{asset.unpostedCents > 0 ? <span className="text-warning-text">{money(asset.unpostedCents)}</span> : "—"}</TableCell>
                      <TableCell>
                        <StatusBadge tone={statusTone[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</StatusBadge>
                        {asset.disposalDate ? <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">{formatIsoDate(asset.disposalDate)}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5}>Total en balance (sin las bajas)</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.cost)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.accumulated)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.remaining)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(totals.unposted)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
            <MobileRecordList aria-label="Bienes de inmovilizado">
              {assets.map((asset) => (
                <MobileRecord
                  aside={<StatusBadge tone={statusTone[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</StatusBadge>}
                  key={asset.id}
                  title={
                    <Link className="text-link hover:underline" href={`/accounting/assets/${asset.id}`}>
                      <span className="font-mono">{asset.code}</span> · {asset.description}
                    </Link>
                  }
                >
                  <MobileRecordFields>
                    <MobileRecordField label="Valor" numeric>{money(asset.costCents)}</MobileRecordField>
                    <MobileRecordField label="Amortizado" numeric>{money(asset.accumulatedCents)}</MobileRecordField>
                    {asset.status === "disposed" ? null : <MobileRecordField label="Pendiente" numeric>{money(asset.remainingCents)}</MobileRecordField>}
                    {asset.unpostedCents > 0 ? <MobileRecordField className="text-warning-text" label="Sin contabilizar" numeric>{money(asset.unpostedCents)}</MobileRecordField> : null}
                    <MobileRecordField label="Cuenta">{asset.assetAccountCode}</MobileRecordField>
                    <MobileRecordField label="Puesta en func.">{formatIsoDate(asset.inServiceDate)}</MobileRecordField>
                  </MobileRecordFields>
                </MobileRecord>
              ))}
            </MobileRecordList>
          </>
        )}
      </PageSection>
    </PageShell>
  );
}
