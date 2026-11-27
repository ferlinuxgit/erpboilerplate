import Link from "next/link";
import { notFound } from "next/navigation";

import { DisposeAssetDialog } from "@/components/accounting/assets/dispose-asset-dialog";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listPostingAccounts } from "@/server/accounting/service";
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, categoryAccounts, type AssetStatus } from "@/server/fixed-assets/model";
import { formatIsoDate, type ScheduleYear } from "@/server/fixed-assets/schedule";
import { getFixedAsset, listSaleInvoiceOptions } from "@/server/fixed-assets/service";
import { taxCoefficientWarning } from "@/server/fixed-assets/tax-coefficients";

const statusTone: Record<AssetStatus, "success" | "info" | "neutral"> = { active: "success", fully_depreciated: "info", disposed: "neutral" };

type PeriodState = "posted" | "partial" | "pending" | "future";

const periodStateLabel: Record<PeriodState, string> = { posted: "Contabilizado", partial: "En curso", pending: "Pendiente", future: "Previsto" };
const periodStateTone: Record<PeriodState, "success" | "info" | "warning" | "neutral"> = { posted: "success", partial: "info", pending: "warning", future: "neutral" };

function periodState(period: { start: string; end: string }, postedThrough: string | null, today: string): PeriodState {
  if (postedThrough && postedThrough >= period.end) return "posted";
  if (postedThrough && postedThrough >= period.start) return "partial";
  return period.end <= today ? "pending" : "future";
}

function AccountLink({ account }: { account: { id: string; code: string; name: string } | null }) {
  if (!account) return <>—</>;
  return (
    <>
      <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/ledger/${account.id}`}>{account.code}</Link> {account.name}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-xs font-bold uppercase tracking-[0.02em] text-muted-foreground">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default async function FixedAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("accounting.read");
  const { id } = await params;
  const detail = await getFixedAsset(ctx.company.id, id);
  if (!detail) notFound();

  const { asset, figures } = detail;
  const canWrite = can(ctx.membership.role, "accounting.write");
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const today = dateInputValue(new Date(), ctx.company.timezone);
  const disposed = detail.status === "disposed";
  const [postingAccounts, saleInvoices] = canWrite && !disposed
    ? await Promise.all([listPostingAccounts(ctx.company.id), listSaleInvoiceOptions(ctx.company.id)])
    : [[], []];
  const years: ScheduleYear[] = figures.schedule?.years ?? [];
  const warning = asset.isDepreciable ? taxCoefficientWarning(figures.annualPct, asset.taxCoefficientKey) : null;
  const lastPosting = detail.postings.at(-1) ?? null;
  const resultAccounts = detail.category ? categoryAccounts(detail.category) : { loss: "671", gain: "771" };
  const minDisposalDate = figures.postedThrough && figures.postedThrough > asset.acquisitionDate ? figures.postedThrough : asset.acquisitionDate;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Inmovilizado"
        title={`${asset.code} · ${asset.description}`}
        description={`${detail.category ? ASSET_CATEGORY_LABELS[detail.category] : "Inmovilizado"} · adquirido el ${formatIsoDate(asset.acquisitionDate)}`}
        backHref="/accounting/assets"
        backLabel="Volver a inmovilizado"
        meta={
          <>
            <StatusBadge tone={statusTone[detail.status]}>{ASSET_STATUS_LABELS[detail.status]}</StatusBadge>
            {asset.isDepreciable ? null : <StatusBadge>No se amortiza</StatusBadge>}
          </>
        }
        actions={
          canWrite ? (
            <>
              <Link className={buttonVariants({ variant: "outline" })} href={`/accounting/assets/${asset.id}/edit`}>Editar</Link>
              {disposed ? (
                <DeleteButton
                  description="Se creará un contraasiento de la baja y el bien volverá a estar en uso. La amortización contabilizada hasta la fecha de baja se conserva."
                  label="Anular la baja"
                  successMessage="Baja anulada: el bien vuelve a estar en uso."
                  title="Anular la baja del bien"
                  url={`/api/fixed-assets/${asset.id}/disposal`}
                />
              ) : (
                <DisposeAssetDialog
                  accounts={postingAccounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))}
                  assetId={asset.id}
                  assetLabel={asset.code}
                  currencyCode={currency}
                  defaultDate={today > minDisposalDate ? today : minDisposalDate}
                  minDate={minDisposalDate}
                  netBookValueCents={figures.netBookValueCents}
                  resultAccounts={resultAccounts}
                  saleInvoices={saleInvoices.map((row) => ({
                    id: row.id,
                    label: `${row.number} · ${row.customerName} · ${formatIsoDate(row.issueDate)} · ${formatMoney(row.totalAmount, currency)}`,
                  }))}
                />
              )}
              {!detail.economicsLocked ? (
                <DeleteButton
                  description="El bien se elimina del inmovilizado. No tiene asientos, así que la contabilidad no cambia."
                  redirectTo="/accounting/assets"
                  successMessage="Bien eliminado."
                  title="Eliminar el bien"
                  url={`/api/fixed-assets/${asset.id}`}
                />
              ) : null}
            </>
          ) : null
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Valor de adquisición" value={money(figures.costCents)} helper={figures.residualCents > 0 ? `Valor residual ${money(figures.residualCents)}` : "Sin valor residual"} />
        <MetricCard label="Amortizado" value={money(figures.accumulatedCents)} helper={figures.priorCents > 0 ? `Incluye ${money(figures.priorCents)} anteriores al programa` : "Amortización acumulada"} />
        <MetricCard label="Pendiente de amortizar" value={disposed ? "—" : money(figures.remainingCents)} helper={figures.postedThrough ? `Contabilizado hasta el ${formatIsoDate(figures.postedThrough)}` : "Sin dotaciones contabilizadas"} />
        <MetricCard label="Valor neto contable" value={disposed ? money(0) : money(figures.netBookValueCents)} helper={disposed ? `Baja el ${formatIsoDate(asset.disposalDate)}` : "Adquisición menos amortización acumulada"} />
      </section>

      {warning ? <InlineAlert title="Aviso fiscal" tone="warning">{warning}</InlineAlert> : null}

      <PageSection title="Datos del bien" description="Cuentas contables, fechas y método de amortización.">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Cuenta de inmovilizado"><AccountLink account={detail.assetAccount} /></Field>
          <Field label="Amortización acumulada"><AccountLink account={detail.accumulatedAccount} /></Field>
          <Field label="Gasto (dotación)"><AccountLink account={detail.expenseAccount} /></Field>
          <Field label="Fecha de adquisición">{formatIsoDate(asset.acquisitionDate)}</Field>
          <Field label="Puesta en funcionamiento">{formatIsoDate(asset.inServiceDate)}</Field>
          <Field label="Método">
            {!asset.isDepreciable
              ? "No se amortiza"
              : asset.method === "years"
                ? `Lineal en ${Number(asset.usefulLifeYears)} años (${figures.annualPct === null ? "—" : formatPercent(figures.annualPct)} anual)`
                : `Lineal al ${figures.annualPct === null ? "—" : formatPercent(figures.annualPct)} anual`}
          </Field>
          <Field label="Tipo de elemento (tabla fiscal)">
            {detail.taxCoefficient ? `${detail.taxCoefficient.label} · máx. ${formatPercent(detail.taxCoefficient.maxPct)} · ${detail.taxCoefficient.maxYears} años` : "—"}
          </Field>
          <Field label="Dotaciones">{detail.frequency === "monthly" ? "Mensuales" : "Anuales, al cierre del ejercicio"}</Field>
          <Field label="Factura de proveedor de origen">
            {detail.supplierInvoice?.id ? (
              <Link className="font-mono font-semibold text-link hover:underline" href={`/expenses/${detail.supplierInvoice.id}`}>
                {detail.supplierInvoice.supplierDocumentNumber ?? detail.supplierInvoice.number}
              </Link>
            ) : "—"}
          </Field>
          {detail.costCenter?.id ? <Field label="Centro de coste"><span className="font-mono font-semibold">{detail.costCenter.code}</span> {detail.costCenter.name}</Field> : null}
          {asset.depreciationStartDate ? <Field label="El programa amortiza desde">{formatIsoDate(asset.depreciationStartDate)}</Field> : null}
          {figures.priorCents > 0 ? <Field label="Amortización acumulada anterior">{money(figures.priorCents)}</Field> : null}
          {asset.notes ? <div className="sm:col-span-2 lg:col-span-3"><Field label="Notas"><span className="whitespace-pre-wrap">{asset.notes}</span></Field></div> : null}
        </dl>
      </PageSection>

      {disposed ? (
        <PageSection title="Baja" description="Datos de la baja o venta del bien.">
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Operación">{asset.disposalType === "sale" ? "Venta" : "Baja sin cobro"}</Field>
            <Field label="Fecha de baja">{formatIsoDate(asset.disposalDate)}</Field>
            <Field label="Importe de la venta">{asset.disposalProceeds === null ? "—" : formatMoney(asset.disposalProceeds, currency)}</Field>
            {detail.disposalInvoice?.id ? (
              <Field label="Factura de venta">
                <Link className="font-mono font-semibold text-link hover:underline" href={`/invoices/${detail.disposalInvoice.id}`}>{detail.disposalInvoice.number}</Link>
                <span className="block text-xs text-muted-foreground">El cobro y el IVA están en la factura; si hay que anularla, anula antes esta baja.</span>
              </Field>
            ) : (
              <Field label="Cuenta de contrapartida"><AccountLink account={detail.disposalAccount} /></Field>
            )}
            {asset.disposalNotes ? <div className="sm:col-span-2 lg:col-span-4"><Field label="Notas de la baja"><span className="whitespace-pre-wrap">{asset.disposalNotes}</span></Field></div> : null}
          </dl>
        </PageSection>
      ) : null}

      {asset.isDepreciable ? (
        <PageSection
          title="Cuadro de amortización"
          description="Cuota de cada ejercicio, prorrateada por días. El último ejercicio se ajusta para no pasar del valor amortizable."
        >
          {years.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {figures.remainingCents === 0 ? "El bien ya está totalmente amortizado: no quedan cuotas." : "No hay cuotas que calcular con los datos de la ficha."}
            </p>
          ) : (
            <>
              <TableContainer>
                <Table className="min-w-[46rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ejercicio</TableHead>
                      <TableHead>Periodo amortizado</TableHead>
                      <TableHead className="text-right">Días</TableHead>
                      <TableHead className="text-right">Cuota</TableHead>
                      <TableHead className="text-right">Acumulada</TableHead>
                      <TableHead className="text-right">Pendiente</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {figures.priorCents > 0 ? (
                      <TableRow>
                        <TableCell className="font-mono">Anterior</TableCell>
                        <TableCell>Antes del {formatIsoDate(asset.depreciationStartDate ?? asset.inServiceDate)}</TableCell>
                        <TableCell className="text-right font-mono">—</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{money(figures.priorCents)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{money(figures.priorCents)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{money(figures.depreciableCents - figures.priorCents)}</TableCell>
                        <TableCell><StatusBadge>Fuera del programa</StatusBadge></TableCell>
                      </TableRow>
                    ) : null}
                    {years.map((year) => {
                      const state = periodState(year, figures.postedThrough, today);
                      return (
                        <TableRow key={year.fiscalStart}>
                          <TableCell className="font-mono font-semibold">{year.label}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatIsoDate(year.start)} – {formatIsoDate(year.months.at(-1)?.end ?? year.end)}</TableCell>
                          <TableCell className="text-right font-mono">{year.days}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono">{money(year.amountCents)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono">{money(year.accumulatedCents)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono">{money(year.remainingCents)}</TableCell>
                          <TableCell><StatusBadge tone={periodStateTone[state]}>{periodStateLabel[state]}</StatusBadge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Total amortizable</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(figures.schedule?.totalCents ?? 0)}</TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
              <details className="mt-2 rounded-surface border border-window-dark-shadow">
                <summary className="cursor-pointer bg-window-panel px-2.5 py-1.5 font-mono text-sm font-bold">Cuotas por mes</summary>
                <TableContainer>
                  <Table className="min-w-[40rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ejercicio</TableHead>
                        <TableHead>Mes</TableHead>
                        <TableHead className="text-right">Días</TableHead>
                        <TableHead className="text-right">Cuota</TableHead>
                        <TableHead className="text-right">Acumulada</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {years.flatMap((year) =>
                        year.months.map((month) => {
                          const state = periodState(month, figures.postedThrough, today);
                          return (
                            <TableRow key={month.start}>
                              <TableCell className="font-mono">{year.label}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatIsoDate(month.start)} – {formatIsoDate(month.end)}</TableCell>
                              <TableCell className="text-right font-mono">{month.days}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-mono">{money(month.amountCents)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-mono">{money(month.accumulatedCents)}</TableCell>
                              <TableCell><StatusBadge tone={periodStateTone[state]}>{periodStateLabel[state]}</StatusBadge></TableCell>
                            </TableRow>
                          );
                        }),
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </details>
            </>
          )}
        </PageSection>
      ) : null}

      <PageSection title="Asientos del bien" description="Dotaciones contabilizadas y asiento de baja, con enlace a cada asiento.">
        {detail.postings.length === 0 && detail.disposalEntries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Este bien todavía no tiene asientos. Las dotaciones se generan desde <Link className="font-bold text-link hover:underline" href="/accounting/assets">Inmovilizado › Contabilizar amortizaciones</Link>.
          </p>
        ) : (
          <TableContainer>
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Asiento</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.postings.map((posting) => (
                  <TableRow key={posting.id}>
                    <TableCell className="whitespace-nowrap">{formatIsoDate(posting.periodEnd)}</TableCell>
                    <TableCell>Amortización del {formatIsoDate(posting.periodStart)} al {formatIsoDate(posting.periodEnd)}</TableCell>
                    <TableCell>
                      <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/entries/${posting.journalEntryId}`}>{posting.entryNumber}</Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(posting.amountCents)}</TableCell>
                    <TableCell className="text-right">
                      {canWrite && !disposed && posting.id === lastPosting?.id ? (
                        <DeleteButton
                          description="Se creará un contraasiento de esta dotación y el periodo volverá a quedar pendiente de contabilizar."
                          label="Deshacer"
                          successMessage="Amortización deshecha con un contraasiento."
                          title="Deshacer la última amortización"
                          url={`/api/fixed-assets/${asset.id}/depreciation`}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {detail.disposalEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(entry.postedAt)}</TableCell>
                    <TableCell>
                      {entry.reference ?? "Baja del bien"}
                      {entry.reversedAt ? <StatusBadge className="ml-1" tone="warning">Revertido</StatusBadge> : null}
                    </TableCell>
                    <TableCell>
                      <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/entries/${entry.id}`}>{entry.number}</Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">—</TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Dotaciones contabilizadas</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(figures.postedCents)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}
