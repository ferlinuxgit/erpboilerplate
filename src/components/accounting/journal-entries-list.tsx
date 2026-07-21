"use client";

import Link from "next/link";

import { JournalEntryRowActions } from "@/components/accounting/journal-entry-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { formatDate, formatMoney } from "@/lib/format";

type JournalEntryRow = {
  id: string;
  number: string;
  postedAt: Date | string;
  reference: string | null;
  debit: string;
  credit: string;
};

export function JournalEntriesList({
  canManage,
  currencyCode,
  rows,
}: {
  canManage: boolean;
  currencyCode: string;
  rows: JournalEntryRow[];
}) {
  const columns: ResourceListColumn<JournalEntryRow>[] = [
    {
      header: "Asiento",
      cell: (row) => (
        <div>
          <Link className="font-mono font-semibold text-primary hover:underline" href={`/accounting/entries/${row.id}`}>
            {row.number}
          </Link>
          <p className="text-xs text-muted-foreground">{row.reference || "Sin referencia"}</p>
        </div>
      ),
      exportValue: (row) => row.number,
      sortValue: (row) => row.number,
    },
    {
      header: "Fecha",
      cell: (row) => formatDate(row.postedAt),
      exportValue: (row) => formatDate(row.postedAt),
      sortValue: (row) => new Date(row.postedAt),
    },
    {
      header: "Debe",
      className: "text-right",
      cell: (row) => formatMoney(row.debit, currencyCode),
      exportValue: (row) => row.debit,
      sortValue: (row) => Number(row.debit),
    },
    {
      header: "Haber",
      className: "text-right",
      cell: (row) => formatMoney(row.credit, currencyCode),
      exportValue: (row) => row.credit,
      sortValue: (row) => Number(row.credit),
    },
    ...(canManage
      ? [
          {
            header: "Acciones",
            className: "text-right",
            cell: (row: JournalEntryRow) => (
              <JournalEntryRowActions id={row.id} />
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
      pageSize={20}
      pageSizeOptions={[20, 50, 100]}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <Link
            className="font-medium text-primary"
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
          {canManage ? <JournalEntryRowActions id={row.id} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar por número, referencia, fecha o importe"
      testId="journal-entries-list"
      title="Libro diario"
    />
  );
}
