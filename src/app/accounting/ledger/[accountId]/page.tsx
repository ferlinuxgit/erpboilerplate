import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountChart } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getLedgerByAccount } from "@/server/accounting/service";

type LedgerParams = { params: Promise<{ accountId: string }> };

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

export default async function LedgerPage({ params }: LedgerParams) {
  const ctx = await requireContext("accounting.read");
  const { accountId } = await params;
  const account = await loadAccount(ctx.company.id, accountId);
  if (!account) notFound();

  const rows = await getLedgerByAccount(ctx.company.id, accountId);
  const currency = ctx.company.baseCurrencyCode;

  // Running balance (debe − haber) in chronological order, shown newest first.
  let balanceCents = 0;
  const withBalance = [...rows]
    .reverse()
    .map((row) => {
      balanceCents += Math.round(Number(row.debit) * 100) - Math.round(Number(row.credit) * 100);
      return { ...row, balance: balanceCents / 100 };
    })
    .reverse();
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
        description="Libro mayor: todos los movimientos de la cuenta con su saldo acumulado."
      />

      <section className="grid gap-2 sm:grid-cols-3">
        <MetricCard label="Total debe" value={formatMoney(totalDebit, currency)} />
        <MetricCard label="Total haber" value={formatMoney(totalCredit, currency)} />
        <MetricCard
          helper={balanceCents >= 0 ? "Saldo deudor" : "Saldo acreedor"}
          label="Saldo"
          value={formatMoney(Math.abs(balanceCents / 100), currency)}
        />
      </section>

      <PageSection title="Movimientos" description="Del más reciente al más antiguo. Pulsa la referencia para abrir el asiento.">
        {withBalance.length === 0 ? (
          <EmptyState title="Sin movimientos" description="Esta cuenta todavía no tiene apuntes contables." />
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
                          className="font-bold text-primary hover:underline"
                          href={`/accounting/entries/${row.entryId}`}
                        >
                          {label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Number(row.debit) ? formatMoney(row.debit, currency) : "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Number(row.credit) ? formatMoney(row.credit, currency) : "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.balance, currency)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(totalDebit, currency)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(totalCredit, currency)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(balanceCents / 100, currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
