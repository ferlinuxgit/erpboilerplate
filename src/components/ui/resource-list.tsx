"use client";

import { CaretDown, CaretUp, CaretUpDown, DownloadSimple, FloppyDisk, MagnifyingGlass, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  enableSelection?: boolean;
};

type SortDirection = "asc" | "desc";
const defaultPageSizeOptions = [8, 16, 32];
type SavedView = {
  name: string;
  searchQuery: string;
  sort: { header: string; direction: SortDirection } | null;
  visibleHeaders: string[];
  pageSize: number;
};

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
  pageSizeOptions = defaultPageSizeOptions,
  renderMobileCard,
  searchPlaceholder,
  testId,
  title,
  exportFileName,
  enableSelection = true,
}: ResourceListProps<TItem>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(pageSize);
  const [sort, setSort] = useState<{ header: string; direction: SortDirection } | null>(null);
  const [visibleHeaders, setVisibleHeaders] = useState(() => new Set(columns.map((column) => column.header)));
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const storageKey = `erp-resource-list:${testId ?? title}`;
  const pageSizeOptionsKey = pageSizeOptions.join(",");
  const columnHeadersKey = columns.map((column) => column.header).join("\u001f");
  const visibleColumns = columns.filter((column) => visibleHeaders.has(column.header));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as { views?: SavedView[]; visibleHeaders?: string[]; pageSize?: number };
          setSavedViews(parsed.views ?? []);
          if (parsed.visibleHeaders?.length) {
            const availableHeaders = new Set(columnHeadersKey.split("\u001f"));
            const restoredHeaders = parsed.visibleHeaders.filter((header) => availableHeaders.has(header));
            setVisibleHeaders(new Set(restoredHeaders.length > 0 ? restoredHeaders : availableHeaders));
          }
          if (parsed.pageSize && pageSizeOptionsKey.split(",").map(Number).includes(parsed.pageSize)) setActivePageSize(parsed.pageSize);
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      } finally {
        setPreferencesLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [columnHeadersKey, pageSizeOptionsKey, storageKey]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ views: savedViews, visibleHeaders: [...visibleHeaders], pageSize: activePageSize }));
  }, [activePageSize, preferencesLoaded, savedViews, storageKey, visibleHeaders]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;

    return items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(normalizedQuery));
  }, [getSearchText, items, normalizedQuery]);
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;

    const column = visibleColumns.find((entry) => entry.header === sort.header);
    if (!column?.sortValue) return filteredItems;

    return [...filteredItems].sort((left, right) => {
      const leftValue = normalizeSortValue(column.sortValue?.(left));
      const rightValue = normalizeSortValue(column.sortValue?.(right));
      const result = leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
      return sort.direction === "asc" ? result : -result;
    });
  }, [filteredItems, sort, visibleColumns]);
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / activePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = sortedItems.slice((safePage - 1) * activePageSize, safePage * activePageSize);
  const hasSearch = searchQuery.trim().length > 0;
  const exportableColumns = visibleColumns.filter((column) => column.exportValue);
  const selectedItems = sortedItems.filter((item) => selectedIds.has(getRowId(item)));

  function toggleSort(header: string) {
    setCurrentPage(1);
    setSort((current) => {
      if (current?.header !== header) return { header, direction: "asc" };
      if (current.direction === "asc") return { header, direction: "desc" };
      return null;
    });
  }

  function exportRows(rows: TItem[]) {
    const csvRows = [
      exportableColumns.map((column) => escapeCsvValue(column.header)).join(","),
      ...rows.map((item) => exportableColumns.map((column) => escapeCsvValue(column.exportValue?.(item))).join(",")),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName ?? `${title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    const nextView: SavedView = { name, searchQuery, sort, visibleHeaders: [...visibleHeaders], pageSize: activePageSize };
    setSavedViews((current) => [...current.filter((view) => view.name !== name), nextView]);
    setViewName("");
    setShowSaveView(false);
  }

  function applyView(name: string) {
    const view = savedViews.find((candidate) => candidate.name === name);
    if (!view) return;
    setSearchQuery(view.searchQuery);
    setSort(view.sort);
    const availableHeaders = new Set(columns.map((column) => column.header));
    const restoredHeaders = view.visibleHeaders.filter((header) => availableHeaders.has(header));
    setVisibleHeaders(new Set(restoredHeaders.length > 0 ? restoredHeaders : availableHeaders));
    setActivePageSize(view.pageSize);
    setCurrentPage(1);
    setSelectedIds(new Set());
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-5" data-testid={testId} aria-labelledby={`${testId ?? "resource-list"}-title`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold" id={`${testId ?? "resource-list"}-title`}>
            {title}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid={`${testId ?? "resource-list"}-summary`}>
            {sortedItems.length} de {items.length} registros visibles
          </p>
        </div>
        {items.length > 0 ? <div className="flex w-full flex-col gap-2 lg:max-w-4xl">
          <div className="flex flex-col gap-2 sm:flex-row">
          {savedViews.length > 0 ? <Select aria-label="Aplicar vista guardada" className="sm:max-w-48" value="" onChange={(event) => applyView(event.target.value)}><option value="" disabled>Vistas guardadas</option>{savedViews.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}</Select> : null}
          <label className="sr-only" htmlFor={`${testId ?? "resource-list"}-search`}>
            Buscar en {title}
          </label>
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
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
            <Button disabled={sortedItems.length === 0} onClick={() => exportRows(selectedItems.length > 0 ? selectedItems : sortedItems)} type="button" variant="outline">
              <DownloadSimple aria-hidden="true" />
              {selectedItems.length > 0 ? `Exportar ${selectedItems.length}` : "Exportar"}
            </Button>
          ) : null}
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border bg-card px-3 text-sm font-semibold hover:bg-accent"><SlidersHorizontal aria-hidden="true" />Campos</summary>
            <div className="absolute right-0 z-20 mt-2 min-w-56 space-y-2 rounded-xl border bg-card p-3 shadow-lg">
              {columns.map((column) => <label className="flex items-center gap-2 text-sm" key={column.header}><input checked={visibleHeaders.has(column.header)} disabled={visibleHeaders.size === 1 && visibleHeaders.has(column.header)} onChange={() => setVisibleHeaders((current) => { const next = new Set(current); if (next.has(column.header)) next.delete(column.header); else next.add(column.header); return next; })} type="checkbox" />{column.header}</label>)}
            </div>
          </details>
          <Button onClick={() => setShowSaveView((current) => !current)} type="button" variant="outline"><FloppyDisk aria-hidden="true" />Guardar vista</Button>
          <label className="sr-only" htmlFor={`${testId ?? "resource-list"}-page-size`}>
            Registros por página
          </label>
          <Select
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
          </Select>
          </div>
          {showSaveView ? <div className="flex gap-2 rounded-lg border bg-muted/20 p-2"><Input aria-label="Nombre de la vista" onChange={(event) => setViewName(event.target.value)} placeholder="Nombre de la vista" value={viewName} /><Button disabled={!viewName.trim()} onClick={saveCurrentView} type="button">Guardar</Button><Button onClick={() => setShowSaveView(false)} type="button" variant="ghost">Cancelar</Button></div> : null}
        </div> : null}
      </div>

      {paginatedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center">
          <p className="font-medium">{hasSearch ? "Sin resultados" : emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasSearch ? "Prueba con otro término de búsqueda o limpia el filtro." : emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border/90 bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {enableSelection ? <TableHead className="w-10"><input aria-label="Seleccionar página" checked={paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.has(getRowId(item)))} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); for (const item of paginatedItems) { const id = getRowId(item); if (event.target.checked) next.add(id); else next.delete(id); } return next; })} type="checkbox" /></TableHead> : null}
                  {visibleColumns.map((column) => (
                    <TableHead
                      aria-sort={sort?.header === column.header ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={column.className}
                      key={column.header}
                    >
                      {column.sortValue ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(column.header)} type="button">
                          {column.header}
                          {sort?.header === column.header ? (
                            sort.direction === "asc" ? <CaretUp aria-hidden="true" className="size-3" /> : <CaretDown aria-hidden="true" className="size-3" />
                          ) : (
                            <CaretUpDown aria-hidden="true" className="size-3" />
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
                    {enableSelection ? <TableCell><input aria-label={`Seleccionar ${getRowId(item)}`} checked={selectedIds.has(getRowId(item))} onChange={() => toggleSelection(getRowId(item))} type="checkbox" /></TableCell> : null}
                    {visibleColumns.map((column) => (
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
              <article className="rounded-xl border border-border/90 bg-card p-4" data-testid={getRowTestId ? `${getRowTestId(item)}-mobile` : undefined} key={getRowId(item)}>
                {renderMobileCard ? (
                  renderMobileCard(item)
                ) : (
                  <dl className="space-y-2">
                    {visibleColumns.map((column) => (
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
