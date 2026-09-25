"use client";

import Link from "next/link";

import { JournalEntryRowActions } from "@/components/accounting/journal-entry-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { readApiError } from "@/components/ui/form";
import { formatDate, formatMoney } from "@/lib/format";
import { journalEntryOriginLabel } from "@/lib/status-labels";

type JournalEntryRow = {
  id: string;
  number: string;
  postedAt: Date | string;
  reference: string | null;
  debit: string;
  credit: string;
  isAutomatic?: boolean;
  reversedAt?: Date | string | null;
  reversesEntryId?: string | null;
  sourceType?: string | null;
};

function entryOrigin(row: JournalEntryRow) {
  if (row.reversesEntryId) return { label: "Reversión", tone: "neutral" as const };
  if (row.reversedAt) return { label: "Revertido", tone: "warning" as const };
  return { label: journalEntryOriginLabel(row), tone: row.isAutomatic ? ("info" as const) : ("success" as const) };
}

/** Exportación completa: todos los asientos filtrados, no solo la página visible. */
async function fetchAllEntries(query: URLSearchParams): Promise<JournalEntryRow[]> {
  query.set("export", "all");
  const response = await fetch(`/api/journal-entries?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudieron exportar los asientos."));
  return (await response.json()) as JournalEntryRow[];
}

function sumAmounts(rows: JournalEntryRow[], pick: (row: JournalEntryRow) => string) {
  // Sum in cents to avoid floating point drift.
  return rows.reduce((total, row) => total + Math.round(Number(pick(row)) * 100), 0) / 100;
}

export function JournalEntriesList({
  canManage,
  currencyCode,
  rows,
  server,
  totals,
}: {
  canManage: boolean;
  currencyCode: string;
  rows: JournalEntryRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Footer debit/credit totals over every filtered entry (server mode). */
  totals?: { debit: number; credit: number };
}) {
  const columns: ResourceListColumn<JournalEntryRow>[] = [
    {
      header: "Asiento",
      cell: (row) => (
        <div>
          <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/entries/${row.id}`}>
            {row.number}
          </Link>
          <p className="text-xs text-muted-foreground">{row.reference || "Sin referencia"}</p>
        </div>
      ),
      exportValue: (row) => (row.reference ? `${row.number} · ${row.reference}` : row.number),
      sortValue: (row) => row.number,
      sortKey: "number",
    },
    {
      header: "Fecha",
      cell: (row) => formatDate(row.postedAt),
      exportValue: (row) => formatDate(row.postedAt),
      sortValue: (row) => new Date(row.postedAt),
      sortKey: "postedAt",
    },
    {
      header: "Origen",
      cell: (row) => {
        const origin = entryOrigin(row);
        return <StatusBadge tone={origin.tone}>{origin.label}</StatusBadge>;
      },
      exportValue: (row) => entryOrigin(row).label,
      sortValue: (row) => entryOrigin(row).label,
    },
    {
      header: "Debe",
      className: "text-right",
      cell: (row) => formatMoney(row.debit, currencyCode),
      exportValue: (row) => row.debit,
      sortValue: (row) => Number(row.debit),
      sortKey: "debit",
      summary: (filtered) =>
        formatMoney(totals ? totals.debit : sumAmounts(filtered, (row) => row.debit), currencyCode),
    },
    {
      header: "Haber",
      className: "text-right",
      cell: (row) => formatMoney(row.credit, currencyCode),
      exportValue: (row) => row.credit,
      sortValue: (row) => Number(row.credit),
      sortKey: "credit",
      summary: (filtered) =>
        formatMoney(totals ? totals.credit : sumAmounts(filtered, (row) => row.credit), currencyCode),
    },
    ...(canManage
      ? [
          {
            header: "Acciones",
            className: "text-right",
            cell: (row: JournalEntryRow) => (
              <JournalEntryRowActions entry={row} id={row.id} />
            ),
          },
        ]
      : []),
  ];

  return (
    <ResourceList
      columns={columns}
      emptyDescription="Registra el primer asiento para alimentar los libros y estados financieros."
      emptyTitle="Sin asientos"
      exportFileName="asientos.csv"
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.number} ${row.reference || "sin referencia"} ${formatDate(row.postedAt)} ${row.debit} ${row.credit}`
      }
      items={rows}
      server={server}
      exportAll={server ? fetchAllEntries : undefined}
      dateRange={{ label: "Fecha", getValue: (row) => row.postedAt }}
      summaryLabel="Total filtrado"
      pageSize={20}
      pageSizeOptions={[20, 50, 100]}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <Link
            className="font-medium text-link"
            href={`/accounting/entries/${row.id}`}
          >
            {row.number}
          </Link>
          <p className="text-sm text-muted-foreground">{row.reference || "Sin referencia"}</p>
          <p className="text-sm text-muted-foreground">
            {formatDate(row.postedAt)}
          </p>
          <p className="text-sm">
            Debe {formatMoney(row.debit, currencyCode)} · Haber{" "}
            {formatMoney(row.credit, currencyCode)}
          </p>
          {canManage ? <JournalEntryRowActions entry={row} id={row.id} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar por número, referencia, fecha o importe"
      testId="journal-entries-list"
      title="Libro diario"
    />
  );
}
