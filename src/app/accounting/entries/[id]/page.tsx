import Link from "next/link";
import { notFound } from "next/navigation";

import { JournalLineDocument } from "@/components/accounting/journal-line-document";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileRecord, MobileRecordField, MobileRecordFields, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getJournalEntry } from "@/server/accounting/service";

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
  const entry = await getJournalEntry(ctx.company.id, id);
  if (!entry) notFound();

  const debit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0);
  const difference = debit - credit;
  const balanced = Math.abs(difference) < 0.005;
  const currency = ctx.company.baseCurrencyCode;
  const originHref = sourceHref(entry.sourceType, entry.sourceId);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Asiento"
        title={entry.number}
        description={`${entry.reference ?? "Sin referencia"} · ${formatDate(entry.postedAt)} · ${entry.lines.length} líneas contables`}
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
            {canWrite && !entry.isAutomatic && !entry.reversedAt && !entry.reversesEntryId ? <Link className={buttonVariants({ variant: "outline" })} href={`/accounting/entries/${entry.id}/edit`}>Editar</Link> : null}
            {canWrite && !entry.isAutomatic && !entry.reversedAt ? <DeleteButton description="Se creará un contraasiento y el original conservará toda su trazabilidad." label="Revertir" successMessage="Asiento revertido mediante contraasiento." title="Revertir asiento" url={`/api/journal-entries/${entry.id}`} redirectTo="/accounting" /> : null}
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

      <PageSection title="Apuntes contables" description="Cuenta, concepto, tercero, documento y vencimiento de cada apunte.">
        <TableContainer className="hidden md:block">
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Tercero</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Debe</TableHead>
                <TableHead className="text-right">Haber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/ledger/${line.accountId}`}>{line.accountCode}</Link>
                  </TableCell>
                  <TableCell className="font-medium">{line.accountName}</TableCell>
                  <TableCell>{line.concept ?? "—"}</TableCell>
                  <TableCell>{line.partnerName ?? "—"}</TableCell>
                  <TableCell>
                    <JournalLineDocument documentId={line.documentId} documentNumber={line.documentNumber} documentType={line.documentType} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{line.dueDate ? formatDate(line.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(line.debit) > 0 ? formatMoney(line.debit, ctx.company.baseCurrencyCode) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(line.credit) > 0 ? formatMoney(line.credit, ctx.company.baseCurrencyCode) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6}>Total</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(debit, currency)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(credit, currency)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
        <MobileRecordList aria-label="Apuntes contables">
          {entry.lines.map((line) => (
            <MobileRecord
              key={line.id}
              title={
                <>
                  <Link className="font-mono text-link hover:underline" href={`/accounting/ledger/${line.accountId}`}>{line.accountCode}</Link>
                  <span className="block font-normal">{line.accountName}</span>
                </>
              }
            >
              <MobileRecordFields>
                {Number(line.debit) > 0 ? <MobileRecordField label="Debe" numeric>{formatMoney(line.debit, currency)}</MobileRecordField> : null}
                {Number(line.credit) > 0 ? <MobileRecordField label="Haber" numeric>{formatMoney(line.credit, currency)}</MobileRecordField> : null}
                {line.concept ? <MobileRecordField label="Concepto">{line.concept}</MobileRecordField> : null}
                {line.partnerName ? <MobileRecordField label="Tercero">{line.partnerName}</MobileRecordField> : null}
                {line.documentNumber || line.documentType ? (
                  <MobileRecordField label="Documento">
                    <JournalLineDocument documentId={line.documentId} documentNumber={line.documentNumber} documentType={line.documentType} />
                  </MobileRecordField>
                ) : null}
                {line.dueDate ? <MobileRecordField label="Vencimiento">{formatDate(line.dueDate)}</MobileRecordField> : null}
              </MobileRecordFields>
            </MobileRecord>
          ))}
          {/* Totales del asiento al pie, como el pie de la tabla de escritorio. */}
          <MobileRecord className="bg-window-panel" title="Total">
            <MobileRecordFields>
              <MobileRecordField label="Debe" numeric>{formatMoney(debit, currency)}</MobileRecordField>
              <MobileRecordField label="Haber" numeric>{formatMoney(credit, currency)}</MobileRecordField>
              {balanced ? null : <MobileRecordField className="text-danger-text" label="Diferencia" numeric>{formatMoney(difference, currency)}</MobileRecordField>}
            </MobileRecordFields>
          </MobileRecord>
        </MobileRecordList>
      </PageSection>
    </PageShell>
  );
}
