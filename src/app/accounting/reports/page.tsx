import type { Metadata } from "next";
import Link from "next/link";

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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatBalance, formatMoney } from "@/lib/format";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { getFinancialStatements } from "@/server/accounting/statements";
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
  const { balanceSheet, incomeStatement, trialBalance, totals } = statements;
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

      <form action="/accounting/reports" className="flex flex-wrap items-end gap-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
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

      <PageSection
        title="Balance de sumas y saldos"
        description="Saldo inicial, movimientos del periodo y saldo final de cada cuenta."
        actions={<HelpTerm term="sumas-y-saldos">¿Qué es?</HelpTerm>}
      >
        {trialBalance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay movimientos contables hasta el {formatDateKey(dates.to)}.</p>
        ) : (
          <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuenta</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trialBalance.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell>
                      <Link className="link" href={ledgerHref(row.accountId)}>{row.code}</Link> {row.name}
                    </TableCell>
                    <TableCell className="text-right">{formatBalance(row.opening, currency)}</TableCell>
                    <TableCell className="text-right">{money(row.debit)}</TableCell>
                    <TableCell className="text-right">{money(row.credit)}</TableCell>
                    <TableCell className="text-right">{formatBalance(row.closing, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total del periodo</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{money(totals.debit)}</TableCell>
                  <TableCell className="text-right">{money(totals.credit)}</TableCell>
                  <TableCell className="text-right">{Math.abs(trialDifference) < 0.01 ? "Cuadrado" : `Descuadre ${money(trialDifference)}`}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}

function formatDateKey(key: string) {
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
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
    <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
      <Table>
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
                      <Link className="link" href={ledgerHref(line.accountId)}>
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
    </div>
  );
}
