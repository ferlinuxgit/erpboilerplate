"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ResourceListColumn<TItem> = {
  header: string;
  cell: (item: TItem) => ReactNode;
  className?: string;
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
};

export function ResourceList<TItem>({
  columns,
  emptyDescription,
  emptyTitle,
  getRowId,
  getRowTestId,
  getSearchText,
  items,
  pageSize = 8,
  renderMobileCard,
  searchPlaceholder,
  testId,
  title,
}: ResourceListProps<TItem>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;

    return items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(normalizedQuery));
  }, [getSearchText, items, normalizedQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasSearch = searchQuery.trim().length > 0;

  return (
    <section className="space-y-4" data-testid={testId} aria-labelledby={`${testId ?? "resource-list"}-title`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-medium" id={`${testId ?? "resource-list"}-title`}>
            {title}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {filteredItems.length} de {items.length} registros visibles
          </p>
        </div>
        <div className="w-full md:max-w-xs">
          <label className="sr-only" htmlFor={`${testId ?? "resource-list"}-search`}>
            Buscar en {title}
          </label>
          <Input
            id={`${testId ?? "resource-list"}-search`}
            placeholder={searchPlaceholder ?? `Buscar en ${title.toLocaleLowerCase()}`}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
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
                    <TableHead className={column.className} key={column.header}>
                      {column.header}
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

      {filteredItems.length > pageSize ? (
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
