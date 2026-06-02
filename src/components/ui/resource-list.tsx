"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown, Download, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ResourceListColumn<TItem> = {
  header: string;
  cell: (item: TItem) => ReactNode;
  className?: string;
  exportValue?: (item: TItem) => string | number | null | undefined;
  sortValue?: (item: TItem) => string | number | Date | null | undefined;
};

type ResourceListProps<TItem> = {
  title: string;
  items: TItem[];
  columns: ResourceListColumn<TItem>[];
  getSearchText: (item: TItem) => string;
  getRowId: (item: TItem) => string;
  emptyTitle: string;
  emptyDescription: string;
  pageSize?: number;
  searchPlaceholder?: string;
  renderMobileCard?: (item: TItem) => ReactNode;
  getRowTestId?: (item: TItem) => string;
  testId?: string;
  exportFileName?: string;
  pageSizeOptions?: number[];
};

type SortDirection = "asc" | "desc";

function normalizeSortValue(value: string | number | Date | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return String(value ?? "").toLocaleLowerCase();
}

function escapeCsvValue(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function ResourceList<TItem>({
  columns,
  emptyDescription,
  emptyTitle,
  getRowId,
  getRowTestId,
  getSearchText,
  items,
  pageSize = 8,
  pageSizeOptions = [8, 16, 32],
  renderMobileCard,
  searchPlaceholder,
  testId,
  title,
  exportFileName,
}: ResourceListProps<TItem>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(pageSize);
  const [sort, setSort] = useState<{ header: string; direction: SortDirection } | null>(null);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;

    return items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(normalizedQuery));
  }, [getSearchText, items, normalizedQuery]);
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;

    const column = columns.find((entry) => entry.header === sort.header);
    if (!column?.sortValue) return filteredItems;

    return [...filteredItems].sort((left, right) => {
      const leftValue = normalizeSortValue(column.sortValue?.(left));
      const rightValue = normalizeSortValue(column.sortValue?.(right));
      const result = leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, filteredItems, sort]);
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / activePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = sortedItems.slice((safePage - 1) * activePageSize, safePage * activePageSize);
  const hasSearch = searchQuery.trim().length > 0;
  const exportableColumns = columns.filter((column) => column.exportValue);

  function toggleSort(header: string) {
    setCurrentPage(1);
    setSort((current) => {
      if (current?.header !== header) return { header, direction: "asc" };
      if (current.direction === "asc") return { header, direction: "desc" };
      return null;
    });
  }

  function exportVisibleRows() {
    const csvRows = [
      exportableColumns.map((column) => escapeCsvValue(column.header)).join(","),
      ...sortedItems.map((item) => exportableColumns.map((column) => escapeCsvValue(column.exportValue?.(item))).join(",")),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName ?? `${title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4" data-testid={testId} aria-labelledby={`${testId ?? "resource-list"}-title`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-medium" id={`${testId ?? "resource-list"}-title`}>
            {title}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid={`${testId ?? "resource-list"}-summary`}>
            {sortedItems.length} de {items.length} registros visibles
          </p>
        </div>
        {items.length > 0 ? <div className="flex w-full flex-col gap-2 sm:flex-row md:max-w-2xl">
          <label className="sr-only" htmlFor={`${testId ?? "resource-list"}-search`}>
            Buscar en {title}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 pr-8"
              id={`${testId ?? "resource-list"}-search`}
              placeholder={searchPlaceholder ?? `Buscar en ${title.toLocaleLowerCase()}`}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setCurrentPage(1);
              }}
            />
            {hasSearch ? (
              <Button
                aria-label="Limpiar búsqueda"
                className="absolute right-0 top-0"
                onClick={() => {
                  setSearchQuery("");
                  setCurrentPage(1);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          {exportableColumns.length > 0 ? (
            <Button disabled={sortedItems.length === 0} onClick={exportVisibleRows} type="button" variant="outline">
              <Download aria-hidden="true" />
              Exportar
            </Button>
          ) : null}
          <label className="sr-only" htmlFor={`${testId ?? "resource-list"}-page-size`}>
            Registros por página
          </label>
          <select
            className="h-8 rounded-lg border bg-background px-2 text-sm"
            id={`${testId ?? "resource-list"}-page-size`}
            onChange={(event) => {
              setActivePageSize(Number(event.target.value));
              setCurrentPage(1);
            }}
            value={activePageSize}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}/pág.
              </option>
            ))}
          </select>
        </div> : null}
      </div>

      {paginatedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">{hasSearch ? "Sin resultados" : emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasSearch ? "Prueba con otro término de búsqueda o limpia el filtro." : emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      aria-sort={sort?.header === column.header ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={column.className}
                      key={column.header}
                    >
                      {column.sortValue ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(column.header)} type="button">
                          {column.header}
                          {sort?.header === column.header ? (
                            sort.direction === "asc" ? <ChevronUp aria-hidden="true" className="size-3" /> : <ChevronDown aria-hidden="true" className="size-3" />
                          ) : (
                            <ChevronsUpDown aria-hidden="true" className="size-3" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item) => (
                  <TableRow data-testid={getRowTestId?.(item)} key={getRowId(item)}>
                    {columns.map((column) => (
                      <TableCell className={column.className} key={column.header}>
                        {column.cell(item)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden" data-testid="resource-list-mobile">
            {paginatedItems.map((item) => (
              <article className="rounded-lg border p-3" data-testid={getRowTestId ? `${getRowTestId(item)}-mobile` : undefined} key={getRowId(item)}>
                {renderMobileCard ? (
                  renderMobileCard(item)
                ) : (
                  <dl className="space-y-2">
                    {columns.map((column) => (
                      <div className="flex justify-between gap-3" key={column.header}>
                        <dt className="text-sm text-muted-foreground">{column.header}</dt>
                        <dd className="text-right text-sm font-medium">{column.cell(item)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {sortedItems.length > activePageSize ? (
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Página {safePage} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1}>
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={safePage === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
