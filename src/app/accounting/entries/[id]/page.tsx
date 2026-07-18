import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getJournalEntry, listAccounts } from "@/server/accounting/service";

function sourceHref(sourceType: string | null, sourceId: string | null) {
  if (!sourceId) return null;
  if (sourceType === "invoice") return `/invoices/${sourceId}`;
  if (sourceType === "supplierInvoice") return `/expenses/${sourceId}`;
  if (sourceType === "bankTransaction") return `/treasury/bank-transactions/${sourceId}`;
  return null;
}

export default async function JournalEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("accounting.read");
  const { id } = await params;
  const [entry, accounts] = await Promise.all([getJournalEntry(ctx.company.id, id), listAccounts(ctx.company.id)]);
  if (!entry) notFound();

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const debit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0);
  const difference = debit - credit;
  const originHref = sourceHref(entry.sourceType, entry.sourceId);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Asiento"
        title={entry.reference ?? `Asiento ${entry.id.slice(0, 8)}`}
        description={`${formatDate(entry.postedAt)} · ${entry.lines.length} líneas contables`}
        backHref="/accounting"
        backLabel="Volver a contabilidad"
        meta={
          <>
            <StatusBadge tone={Math.abs(difference) < 0.005 ? "success" : "danger"}>
              {Math.abs(difference) < 0.005 ? "Cuadrado" : "Descuadrado"}
            </StatusBadge>
            {entry.isAutomatic ? <StatusBadge tone="info">Automático</StatusBadge> : <StatusBadge>Manual</StatusBadge>}
            {entry.reversedAt ? <StatusBadge tone="warning">Revertido</StatusBadge> : null}
          </>
        }
        actions={
          <>
            {originHref ? <Link className={buttonVariants({ variant: "outline" })} href={originHref}>Ver documento origen</Link> : null}
            {canWrite && !entry.isAutomatic ? <Link className={buttonVariants({ variant: "outline" })} href={`/accounting/entries/${entry.id}/edit`}>Editar</Link> : null}
            {canWrite && !entry.isAutomatic ? <DeleteButton url={`/api/journal-entries/${entry.id}`} redirectTo="/accounting" /> : null}
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Debe" value={formatMoney(debit, ctx.company.baseCurrencyCode)} helper="Total de cargos" />
        <MetricCard label="Haber" value={formatMoney(credit, ctx.company.baseCurrencyCode)} helper="Total de abonos" />
        <MetricCard
          label="Diferencia"
          value={formatMoney(difference, ctx.company.baseCurrencyCode)}
          helper={Math.abs(difference) < 0.005 ? "El asiento está equilibrado" : "Revisa las líneas"}
          tone={Math.abs(difference) < 0.005 ? "success" : "danger"}
        />
      </section>

      <PageSection title="Apuntes contables" description="Detalle del debe y el haber por cuenta.">
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Debe</TableHead>
                <TableHead className="text-right">Haber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => {
                const account = accountById.get(line.accountId);
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      {account ? <Link className="font-mono font-semibold text-primary hover:underline" href={`/accounting/ledger/${account.id}`}>{account.code}</Link> : "—"}
                    </TableCell>
                    <TableCell className="font-medium">{account?.name ?? "Cuenta no disponible"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(line.debit) > 0 ? formatMoney(line.debit, ctx.company.baseCurrencyCode) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(line.credit) > 0 ? formatMoney(line.credit, ctx.company.baseCurrencyCode) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </PageSection>
    </PageShell>
  );
}
