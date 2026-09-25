import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HelpTerm } from "@/components/help/help-term";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountChart } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { balanceSide, formatBalance, formatDate, formatMoney } from "@/lib/format";
import { getLedgerBalanceBefore, getLedgerByAccount } from "@/server/accounting/service";

type LedgerParams = { params: Promise<{ accountId: string }> };
type LedgerSearchParams = Promise<{ from?: string | string[]; to?: string | string[] }>;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dateParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !DATE_KEY.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : { key: raw, date };
}

async function loadAccount(companyId: string, accountId: string) {
  const [account] = await db
    .select({ id: accountChart.id, code: accountChart.code, name: accountChart.name })
    .from(accountChart)
    .where(and(eq(accountChart.id, accountId), eq(accountChart.companyId, companyId)))
    .limit(1);
  return account ?? null;
}

export async function generateMetadata({ params }: LedgerParams): Promise<Metadata> {
  try {
    const ctx = await requireContext("accounting.read");
    const account = await loadAccount(ctx.company.id, (await params).accountId);
    return { title: account ? `Mayor ${account.code} ${account.name}` : "Libro mayor" };
  } catch {
    return { title: "Libro mayor" };
  }
}

export default async function LedgerPage({ params, searchParams }: LedgerParams & { searchParams: LedgerSearchParams }) {
  const ctx = await requireContext("accounting.read");
  const { accountId } = await params;
  const account = await loadAccount(ctx.company.id, accountId);
  if (!account) notFound();

  const query = await searchParams;
  const from = dateParam(query.from);
  const to = dateParam(query.to);
  const toExclusive = to ? new Date(to.date.getTime() + 86_400_000) : undefined;
  const [rows, openingBalance] = await Promise.all([
    getLedgerByAccount(ctx.company.id, accountId, { from: from?.date, toExclusive }),
    from ? getLedgerBalanceBefore(ctx.company.id, accountId, from.date) : Promise.resolve(0),
  ]);
  const currency = ctx.company.baseCurrencyCode;
  const openingCents = Math.round(openingBalance * 100);
  const rangeLabel = from || to ? `${from ? `del ${formatDate(from.date)}` : "desde el inicio"} ${to ? `al ${formatDate(to.date)}` : "hasta hoy"}` : null;

  // Saldo acumulado (debe − haber) en orden cronológico, mostrado del más reciente al más antiguo.
  const chronological = [...rows].reverse();
  const netCents = chronological.map((row) => Math.round(Number(row.debit) * 100) - Math.round(Number(row.credit) * 100));
  const withBalance = chronological
    .map((row, index) => ({ ...row, balance: (openingCents + netCents.slice(0, index + 1).reduce((sum, cents) => sum + cents, 0)) / 100 }))
    .reverse();
  const balanceCents = openingCents + netCents.reduce((sum, cents) => sum + cents, 0);
  const totalDebit = rows.reduce((total, row) => total + Math.round(Number(row.debit) * 100), 0) / 100;
  const totalCredit = rows.reduce((total, row) => total + Math.round(Number(row.credit) * 100), 0) / 100;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Contabilidad", href: "/accounting" },
          { label: "Plan contable", href: "/accounting/accounts" },
          { label: `Mayor ${account.code}` },
        ]}
        title={`${account.code} · ${account.name}`}
        description={rangeLabel ? `Libro mayor ${rangeLabel}, con el saldo anterior y el saldo acumulado.` : "Libro mayor: todos los movimientos de la cuenta con su saldo acumulado."}
        actions={rangeLabel ? <Link className={buttonVariants({ variant: "outline" })} href={`/accounting/ledger/${account.id}`}>Ver todo el histórico</Link> : undefined}
      />

      <section className="grid gap-2 sm:grid-cols-3">
        <MetricCard label="Total debe" value={formatMoney(totalDebit, currency)} />
        <MetricCard label="Total haber" value={formatMoney(totalCredit, currency)} />
        <MetricCard
          helper={balanceSide(balanceCents / 100) === "Saldado" ? "Cuenta saldada" : `Saldo ${balanceSide(balanceCents / 100).toLowerCase()}${rangeLabel ? " al final del periodo" : ""}`}
          label="Saldo"
          value={formatMoney(Math.abs(balanceCents / 100), currency)}
        />
      </section>

      <PageSection
        title="Movimientos"
        description="Del más reciente al más antiguo. Pulsa la referencia para abrir el asiento."
        actions={<HelpTerm term="mayor">¿Qué es el libro mayor?</HelpTerm>}
      >
        {withBalance.length === 0 ? (
          <EmptyState title="Sin movimientos" description={rangeLabel ? `No hay apuntes en este periodo. Saldo anterior: ${formatBalance(openingBalance, currency)}.` : "Esta cuenta todavía no tiene apuntes contables."} />
        ) : (
          <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Asiento</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withBalance.map((row) => {
                  const label = row.reference?.trim() || row.number;
                  return (
                    <TableRow key={row.lineId}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.postedAt)}</TableCell>
                      <TableCell className="font-mono">{row.number}</TableCell>
                      <TableCell>
                        <Link
                          aria-label={`Ver asiento ${label}`}
                          className="font-bold text-link hover:underline"
                          href={`/accounting/entries/${row.entryId}`}
                        >
                          {label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Number(row.debit) ? formatMoney(row.debit, currency) : "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Number(row.credit) ? formatMoney(row.credit, currency) : "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatBalance(row.balance, currency)}</TableCell>
                    </TableRow>
                  );
                })}
                {from ? (
                  <TableRow>
                    <TableCell className="whitespace-nowrap">{formatDate(from.date)}</TableCell>
                    <TableCell colSpan={4}>Saldo anterior</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatBalance(openingBalance, currency)}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(totalDebit, currency)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(totalCredit, currency)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatBalance(balanceCents / 100, currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
