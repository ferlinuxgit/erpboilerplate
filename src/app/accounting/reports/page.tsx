import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { HelpTerm } from "@/components/help/help-term";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InlineAlert,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { formatBalance, formatMoney } from "@/lib/format";
import { getAnnualAccountsModel } from "@/server/accounting/annual-accounts/service";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { buildOfficialStatements, officialStatementModelInfo, type OfficialStatementLine } from "@/server/accounting/official-statements-model";
import { getFinancialStatements, loadStatementAccountRows } from "@/server/accounting/statements";
import {
  periodDateKeys,
  resolveStatementPeriod,
  statementPeriodOptions,
  type StatementLine,
} from "@/server/accounting/statements-model";

export const metadata: Metadata = { title: "Estados financieros" };

type SearchParams = Promise<{ year?: string | string[]; period?: string | string[] }>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AccountingReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  const query = await searchParams;
  const years = await listFiscalYears(ctx.company.id);
  const year = years.find((candidate) => candidate.id === first(query.year)) ?? years.find((candidate) => candidate.id === ctx.fiscalYear.id) ?? years[years.length - 1];
  const currency = ctx.company.baseCurrencyCode;

  if (!year) {
    return (
      <PageShell>
        <PageHeader title="Estados financieros" backHref="/accounting" backLabel="Volver al resumen" />
        <InlineAlert tone="warning">No hay ejercicios contables. Abre un ejercicio en Contabilidad para ver los estados financieros.</InlineAlert>
      </PageShell>
    );
  }

  const period = resolveStatementPeriod(year, first(query.period));
  const statements = await getFinancialStatements(ctx.company.id, ctx.company.countryCode, {
    yearStart: year.startsAt,
    from: period.from,
    toExclusive: period.toExclusive,
  });
  const { balanceSheet, incomeStatement, trialBalance, trialBalanceGroups, totals } = statements;
  // Cuentas anuales en el modelo de la empresa (abreviado por defecto; solo empresas españolas),
  // con el mismo periodo del ejercicio anterior como columna comparativa.
  const usesSpanishModels = getCountryFiscalProfile(ctx.company.countryCode).features.taxReports === "es-aeat";
  const previousYear = [...years].reverse().find((candidate) => candidate.startsAt < year.startsAt) ?? null;
  const previousPeriod = previousYear ? resolveStatementPeriod(previousYear, period.key) : null;
  const previousRows = usesSpanishModels && previousYear && previousPeriod && previousPeriod.key === period.key
    ? await loadStatementAccountRows(ctx.company.id, { yearStart: previousYear.startsAt, from: previousPeriod.from, toExclusive: previousPeriod.toExclusive })
    : null;
  const officialModel = usesSpanishModels ? await getAnnualAccountsModel(ctx.company.id) : "abbreviated";
  const officialModelInfo = officialStatementModelInfo(officialModel);
  const official = usesSpanishModels ? buildOfficialStatements(statements.rows, previousRows, officialModel) : null;
  const dates = periodDateKeys(period);
  const ledgerHref = (accountId: string) => `/accounting/ledger/${accountId}?from=${dates.from}&to=${dates.to}`;
  const money = (value: number) => formatMoney(value, currency);
  const isProfit = incomeStatement.result >= 0;
  const trialDifference = Math.round((totals.debit - totals.credit) * 100) / 100;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Estados financieros"
        description={`${period.label}. Balance de situación y cuenta de resultados sin los asientos de cierre, para no mezclar ejercicios.`}
        backHref="/accounting"
        backLabel="Volver al resumen"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/accounting/gestor">Paquete para el gestor</Link>}
      />

      <form action="/accounting/reports" className="flex flex-wrap items-end gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
        <div className="space-y-1">
          <Label htmlFor="statements-year">Ejercicio</Label>
          <Select className="w-40" defaultValue={year.id} id="statements-year" name="year">
            {years.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code}{candidate.isClosed ? " (cerrado)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="statements-period">Periodo</Label>
          <Select className="w-48" defaultValue={period.key} id="statements-period" name="period">
            {statementPeriodOptions(year).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">Ver periodo</Button>
      </form>

      <section aria-label="Resumen del periodo" className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Activo" value={money(balanceSheet.assetsTotal)} helper={`Lo que tiene la empresa al ${formatDateKey(dates.to)}`} />
        <MetricCard label="Patrimonio neto y pasivo" value={money(balanceSheet.equityTotal + balanceSheet.liabilitiesTotal)} helper="Fondos propios, resultado y deudas" />
        <MetricCard
          label={isProfit ? "Beneficio del periodo" : "Pérdida del periodo"}
          value={money(Math.abs(incomeStatement.result))}
          helper={`${money(incomeStatement.revenueTotal)} de ingresos − ${money(incomeStatement.expenseTotal)} de gastos (sin IVA)`}
          tone={isProfit ? "success" : "warning"}
        />
      </section>

      {Math.abs(balanceSheet.difference) >= 0.01 ? (
        <InlineAlert title="Descuadre" tone="danger">
          El activo no coincide con el patrimonio neto más el pasivo (diferencia {money(balanceSheet.difference)}). Revisa los asientos manuales del periodo.
        </InlineAlert>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <PageSection title="Balance de situación" description={`Saldos acumulados al ${formatDateKey(dates.to)}. Pulsa una cuenta para ver su libro mayor.`}>
          <StatementTable
            groups={[
              { title: "Activo", lines: balanceSheet.assets, total: balanceSheet.assetsTotal },
              {
                title: "Patrimonio neto",
                lines: [
                  ...balanceSheet.equity,
                  ...(balanceSheet.pendingPriorResult !== 0 ? [{ accountId: "", code: "", name: "Resultados de ejercicios anteriores sin regularizar", amount: balanceSheet.pendingPriorResult }] : []),
                  { accountId: "", code: "", name: balanceSheet.yearResult >= 0 ? "Beneficio del ejercicio" : "Pérdida del ejercicio", amount: balanceSheet.yearResult },
                ],
                total: balanceSheet.equityTotal,
              },
              { title: "Pasivo", lines: balanceSheet.liabilities, total: balanceSheet.liabilitiesTotal },
            ]}
            ledgerHref={ledgerHref}
            money={money}
          />
        </PageSection>
        <PageSection title="Cuenta de resultados" description="Ingresos y gastos del periodo, sin IVA.">
          <StatementTable
            groups={[
              { title: "Ingresos", lines: incomeStatement.revenue, total: incomeStatement.revenueTotal },
              { title: "Gastos", lines: incomeStatement.expenses, total: incomeStatement.expenseTotal },
            ]}
            ledgerHref={ledgerHref}
            money={money}
            footer={{ label: isProfit ? "Beneficio del ejercicio" : "Pérdida del ejercicio", amount: incomeStatement.result }}
          />
        </PageSection>
      </div>

      {official ? (
        <PageSection
          title={`Cuentas anuales · ${officialModelInfo.name.toLowerCase()}`}
          description={`Balance al ${formatDateKey(dates.to)} y cuenta de pérdidas y ganancias del periodo con los epígrafes oficiales (${officialModelInfo.source})${previousYear && previousRows ? `, comparados con ${previousYear.code}` : ""}. Antes de depositarlas, revísalas con tu asesor.`}
          actions={<Link className={buttonVariants({ variant: "outline" })} href={`/accounting/reports/annual-accounts?year=${year.id}`}>Cuentas anuales completas y memoria</Link>}
        >
          {official.unmapped.length > 0 ? (
            <InlineAlert title="Cuentas fuera del modelo oficial" tone="warning">
              {official.unmapped.slice(0, 8).map((account) => account.code).join(", ")}{official.unmapped.length > 8 ? "…" : ""} no tienen epígrafe en este modelo. Se han sumado en el epígrafe más próximo: reclasifícalas si no corresponde.
            </InlineAlert>
          ) : null}
          <div className="grid gap-3 xl:grid-cols-2">
            <OfficialTable caption="Activo" currentLabel={year.code} lines={official.assets} money={money} previousLabel={previousRows ? previousYear?.code : undefined} />
            <OfficialTable caption="Patrimonio neto y pasivo" currentLabel={year.code} lines={official.equityAndLiabilities} money={money} previousLabel={previousRows ? previousYear?.code : undefined} />
          </div>
          <OfficialTable caption="Cuenta de pérdidas y ganancias" currentLabel={year.code} lines={official.incomeStatement} money={money} previousLabel={previousRows ? previousYear?.code : undefined} />
        </PageSection>
      ) : null}

      <PageSection
        title="Balance de sumas y saldos"
        description="Saldo inicial, movimientos del periodo y saldo final de cada subcuenta, con el subtotal de su cuenta de 3 dígitos."
        actions={<HelpTerm term="sumas-y-saldos">¿Qué es?</HelpTerm>}
      >
        {trialBalance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay movimientos contables hasta el {formatDateKey(dates.to)}.</p>
        ) : (
          <TableContainer label="Balance de sumas y saldos">
            {/* En móvil la tabla se desplaza con la columna de la cuenta fija a la izquierda. */}
            <Table className="[&_td:not(:first-child)]:whitespace-nowrap [&_th:not(:first-child)]:whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead sticky>Cuenta</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trialBalanceGroups.flatMap((group) => [
                  <TableRow className="bg-window-panel font-bold" key={`group-${group.code}`}>
                    <TableCell className="bg-window-panel" sticky><AccountName>{group.code} {group.name}</AccountName></TableCell>
                    <TableCell className="text-right">{formatBalance(group.opening, currency)}</TableCell>
                    <TableCell className="text-right">{money(group.debit)}</TableCell>
                    <TableCell className="text-right">{money(group.credit)}</TableCell>
                    <TableCell className="text-right">{formatBalance(group.closing, currency)}</TableCell>
                  </TableRow>,
                  ...group.accounts.map((row) => (
                    <TableRow key={row.accountId}>
                      <TableCell className="pl-6" sticky>
                        <AccountName><Link className="font-bold text-link underline-offset-2 hover:underline" href={ledgerHref(row.accountId)}>{row.code}</Link> {row.name}</AccountName>
                      </TableCell>
                      <TableCell className="text-right">{formatBalance(row.opening, currency)}</TableCell>
                      <TableCell className="text-right">{money(row.debit)}</TableCell>
                      <TableCell className="text-right">{money(row.credit)}</TableCell>
                      <TableCell className="text-right">{formatBalance(row.closing, currency)}</TableCell>
                    </TableRow>
                  )),
                ])}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell sticky>Total del periodo</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{money(totals.debit)}</TableCell>
                  <TableCell className="text-right">{money(totals.credit)}</TableCell>
                  <TableCell className="text-right">{Math.abs(trialDifference) < 0.01 ? "Cuadrado" : `Descuadre ${money(trialDifference)}`}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}

function formatDateKey(key: string) {
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

/** Nombre de cuenta con ancho acotado en móvil para que la columna fija no tape las cifras. */
function AccountName({ children }: { children: ReactNode }) {
  return <span className="block min-w-36 max-sm:w-40">{children}</span>;
}

/** Estado en el modelo oficial: epígrafes con sangría, totales en negrita y columna del ejercicio anterior. */
function OfficialTable({
  caption,
  currentLabel,
  lines,
  money,
  previousLabel,
}: {
  caption: string;
  currentLabel: string;
  lines: OfficialStatementLine[];
  money: (value: number) => string;
  previousLabel?: string;
}) {
  const indent = ["", "pl-5", "pl-8", "pl-11"];
  return (
    <TableContainer label={caption}>
      <Table className="[&_td:not(:first-child)]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>{caption}</TableHead>
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
                <TableCell className="text-right">{line.amount === 0 && !strong ? "—" : money(line.amount)}</TableCell>
                {previousLabel ? <TableCell className="text-right">{!line.previous && !strong ? "—" : money(line.previous ?? 0)}</TableCell> : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function StatementTable({
  footer,
  groups,
  ledgerHref,
  money,
}: {
  groups: Array<{ title: string; lines: StatementLine[]; total: number }>;
  ledgerHref: (accountId: string) => string;
  money: (value: number) => string;
  footer?: { label: string; amount: number };
}) {
  return (
    <TableContainer>
      <Table className="[&_td:last-child]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            <TableHead className="text-right">Importe</TableHead>
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.title}>
            <TableRow className="bg-window-panel">
              <TableCell className="font-bold">{group.title}</TableCell>
              <TableCell className="text-right font-bold">{money(group.total)}</TableCell>
            </TableRow>
            {group.lines.length === 0 ? (
              <TableRow>
                <TableCell className="pl-5 text-muted-foreground" colSpan={2}>Sin saldos en el periodo.</TableCell>
              </TableRow>
            ) : (
              group.lines.map((line, index) => (
                <TableRow key={`${group.title}-${line.accountId || index}`}>
                  <TableCell className="pl-5">
                    {line.accountId ? (
                      <Link className="font-bold text-link underline-offset-2 hover:underline" href={ledgerHref(line.accountId)}>
                        {line.code} · {line.name}
                      </Link>
                    ) : (
                      line.name
                    )}
                  </TableCell>
                  <TableCell className="text-right">{money(line.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        ))}
        {footer ? (
          <TableFooter>
            <TableRow>
              <TableCell>{footer.label}</TableCell>
              <TableCell className="text-right">{money(Math.abs(footer.amount))}</TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </TableContainer>
  );
}
