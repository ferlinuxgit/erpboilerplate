"use client";

import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  DownloadSimple,
  FloppyDisk,
  Funnel,
  MagnifyingGlass,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ResourceListColumn<TItem> = {
  header: string;
  cell: (item: TItem) => ReactNode;
  className?: string;
  exportValue?: (item: TItem) => string | number | null | undefined;
  sortValue?: (item: TItem) => string | number | Date | null | undefined;
};

export type ResourceListFilter<TItem> = {
  key: string;
  label: string;
  allLabel?: string;
  options: Array<{ label: string; value: string }>;
  getValue: (item: TItem) => string | null | undefined;
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
  filters?: ResourceListFilter<TItem>[];
};

type SortDirection = "asc" | "desc";
const defaultPageSizeOptions = [8, 16, 32];
type SavedView = {
  name: string;
  searchQuery: string;
  sort: { header: string; direction: SortDirection } | null;
  visibleHeaders: string[];
  pageSize: number;
  filters: Record<string, string>;
};

function normalizeSortValue(value: string | number | Date | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return String(value ?? "").toLocaleLowerCase();
}

function escapeCsvValue(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
  filters = [],
}: ResourceListProps<TItem>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(pageSize);
  const [sort, setSort] = useState<{
    header: string;
    direction: SortDirection;
  } | null>(null);
  const [visibleHeaders, setVisibleHeaders] = useState(
    () => new Set(columns.map((column) => column.header)),
  );
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const [activeViewName, setActiveViewName] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(
    {},
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const storageKey = `erp-resource-list:${testId ?? title}`;
  const pageSizeOptionsKey = pageSizeOptions.join(",");
  const columnHeadersKey = columns
    .map((column) => column.header)
    .join("\u001f");
  const filterKeysKey = filters.map((filter) => filter.key).join("\u001f");
  const urlPrefix = `rl-${testId ?? title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}-`;
  const visibleColumns = columns.filter((column) =>
    visibleHeaders.has(column.header),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as {
            views?: SavedView[];
            visibleHeaders?: string[];
            pageSize?: number;
          };
          setSavedViews(parsed.views ?? []);
          if (parsed.visibleHeaders?.length) {
            const availableHeaders = new Set(columnHeadersKey.split("\u001f"));
            const restoredHeaders = parsed.visibleHeaders.filter((header) =>
              availableHeaders.has(header),
            );
            setVisibleHeaders(
              new Set(
                restoredHeaders.length > 0 ? restoredHeaders : availableHeaders,
              ),
            );
          }
          if (
            parsed.pageSize &&
            pageSizeOptionsKey.split(",").map(Number).includes(parsed.pageSize)
          )
            setActivePageSize(parsed.pageSize);
        }
        const params = new URLSearchParams(window.location.search);
        const storedQuery = params.get(`${urlPrefix}q`);
        const storedSort = params.get(`${urlPrefix}sort`);
        const storedDirection = params.get(`${urlPrefix}dir`);
        const storedPage = Number(params.get(`${urlPrefix}page`));
        const storedSize = Number(params.get(`${urlPrefix}size`));
        if (storedQuery) setSearchQuery(storedQuery);
        if (
          storedSort &&
          (storedDirection === "asc" || storedDirection === "desc")
        )
          setSort({ header: storedSort, direction: storedDirection });
        if (Number.isFinite(storedPage) && storedPage > 0)
          setCurrentPage(storedPage);
        if (pageSizeOptionsKey.split(",").map(Number).includes(storedSize))
          setActivePageSize(storedSize);
        const restoredFilters: Record<string, string> = {};
        for (const key of filterKeysKey.split("\u001f").filter(Boolean)) {
          const value = params.get(`${urlPrefix}filter-${key}`);
          if (value) restoredFilters[key] = value;
        }
        setActiveFilters(restoredFilters);
      } catch {
        window.localStorage.removeItem(storageKey);
      } finally {
        setPreferencesLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    columnHeadersKey,
    filterKeysKey,
    pageSizeOptionsKey,
    storageKey,
    urlPrefix,
  ]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        views: savedViews,
        visibleHeaders: [...visibleHeaders],
        pageSize: activePageSize,
      }),
    );
  }, [
    activePageSize,
    preferencesLoaded,
    savedViews,
    storageKey,
    visibleHeaders,
  ]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (
      key: string,
      value: string | number | null | undefined,
    ) => {
      if (value === null || value === undefined || value === "" || value === 1)
        params.delete(key);
      else params.set(key, String(value));
    };
    setOrDelete(`${urlPrefix}q`, searchQuery.trim());
    setOrDelete(`${urlPrefix}sort`, sort?.header);
    setOrDelete(`${urlPrefix}dir`, sort?.direction);
    setOrDelete(`${urlPrefix}page`, currentPage);
    setOrDelete(
      `${urlPrefix}size`,
      activePageSize === pageSize ? null : activePageSize,
    );
    for (const filter of filters)
      setOrDelete(
        `${urlPrefix}filter-${filter.key}`,
        activeFilters[filter.key],
      );
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [
    activeFilters,
    activePageSize,
    currentPage,
    filters,
    pageSize,
    preferencesLoaded,
    searchQuery,
    sort,
    urlPrefix,
  ]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          normalizedQuery &&
          !getSearchText(item).toLocaleLowerCase().includes(normalizedQuery)
        )
          return false;
        return filters.every((filter) => {
          const selected = activeFilters[filter.key];
          return !selected || filter.getValue(item) === selected;
        });
      }),
    [activeFilters, filters, getSearchText, items, normalizedQuery],
  );
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;

    const column = visibleColumns.find((entry) => entry.header === sort.header);
    if (!column?.sortValue) return filteredItems;

    return [...filteredItems].sort((left, right) => {
      const leftValue = normalizeSortValue(column.sortValue?.(left));
      const rightValue = normalizeSortValue(column.sortValue?.(right));
      const result =
        leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
      return sort.direction === "asc" ? result : -result;
    });
  }, [filteredItems, sort, visibleColumns]);
  const totalPages = Math.max(
    1,
    Math.ceil(sortedItems.length / activePageSize),
  );
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = sortedItems.slice(
    (safePage - 1) * activePageSize,
    safePage * activePageSize,
  );
  const hasSearch = searchQuery.trim().length > 0;
  const exportableColumns = visibleColumns.filter(
    (column) => column.exportValue,
  );
  const selectedItems = sortedItems.filter((item) =>
    selectedIds.has(getRowId(item)),
  );
  const hasActiveFilters = Object.values(activeFilters).some(Boolean);

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
      exportableColumns
        .map((column) => escapeCsvValue(column.header))
        .join(","),
      ...rows.map((item) =>
        exportableColumns
          .map((column) => escapeCsvValue(column.exportValue?.(item)))
          .join(","),
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      exportFileName ??
      `${title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    const nextView: SavedView = {
      name,
      searchQuery,
      sort,
      visibleHeaders: [...visibleHeaders],
      pageSize: activePageSize,
      filters: activeFilters,
    };
    setSavedViews((current) => [
      ...current.filter((view) => view.name !== name),
      nextView,
    ]);
    setViewName("");
    setShowSaveView(false);
    setActiveViewName(name);
  }

  function applyView(name: string) {
    const view = savedViews.find((candidate) => candidate.name === name);
    if (!view) return;
    setSearchQuery(view.searchQuery);
    setSort(view.sort);
    setActiveFilters(view.filters ?? {});
    const availableHeaders = new Set(columns.map((column) => column.header));
    const restoredHeaders = view.visibleHeaders.filter((header) =>
      availableHeaders.has(header),
    );
    setVisibleHeaders(
      new Set(restoredHeaders.length > 0 ? restoredHeaders : availableHeaders),
    );
    setActivePageSize(view.pageSize);
    setCurrentPage(1);
    setSelectedIds(new Set());
    setActiveViewName(name);
  }

  function deleteActiveView() {
    if (!activeViewName) return;
    setSavedViews((current) =>
      current.filter((view) => view.name !== activeViewName),
    );
    setActiveViewName("");
  }

  function resetFilters() {
    setSearchQuery("");
    setActiveFilters({});
    setSort(null);
    setCurrentPage(1);
    setSelectedIds(new Set());
    setActiveViewName("");
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
    <section
      className="min-w-0 space-y-4"
      data-testid={testId}
      aria-labelledby={`${testId ?? "resource-list"}-title`}
    >
      <h3 className="sr-only" id={`${testId ?? "resource-list"}-title`}>
        {title}
      </h3>
      <div className="w-full overflow-visible rounded-xl border border-border/80 bg-card p-3 shadow-[0_1px_2px_rgba(25,55,45,0.025)] sm:p-4">
        <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2">
          <p
            className="text-sm font-medium text-foreground"
            aria-live="polite"
            data-testid={`${testId ?? "resource-list"}-summary`}
          >
            <span className="font-semibold tabular-nums">
              {sortedItems.length}
            </span>
            <span className="text-muted-foreground">
              {" "}de {items.length} registros
            </span>
          </p>
          {selectedItems.length > 0 ? (
            <p
              aria-live="polite"
              className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"
            >
              {selectedItems.length} seleccionados
            </p>
          ) : null}
        </div>
        {items.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-3">
            <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(16rem,1fr)_auto]">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                {savedViews.length > 0 ? (
                  <div className="flex min-w-0 gap-1 sm:w-48 sm:shrink-0">
                    <Select
                      aria-label="Aplicar vista guardada"
                      className="min-w-0"
                      value={activeViewName}
                      onChange={(event) => applyView(event.target.value)}
                    >
                      <option value="">Vistas guardadas</option>
                      {savedViews.map((view) => (
                        <option key={view.name} value={view.name}>
                          {view.name}
                        </option>
                      ))}
                    </Select>
                    {activeViewName ? (
                      <Button
                        aria-label={`Eliminar vista ${activeViewName}`}
                        onClick={deleteActiveView}
                        size="icon-lg"
                        type="button"
                        variant="ghost"
                      >
                        <Trash aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <label
                  className="sr-only"
                  htmlFor={`${testId ?? "resource-list"}-search`}
                >
                  Buscar en {title}
                </label>
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlass
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    className="h-11 pl-10 pr-11"
                    id={`${testId ?? "resource-list"}-search`}
                    placeholder={
                      searchPlaceholder ??
                      `Buscar en ${title.toLocaleLowerCase()}`
                    }
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
                      size="icon-lg"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                {exportableColumns.length > 0 ? (
                  <Button
                    aria-label={
                      selectedItems.length > 0
                        ? `Exportar ${selectedItems.length} registros seleccionados`
                        : "Exportar registros visibles"
                    }
                    disabled={sortedItems.length === 0}
                    onClick={() =>
                      exportRows(
                        selectedItems.length > 0 ? selectedItems : sortedItems,
                      )
                    }
                    size="icon-lg"
                    title={
                      selectedItems.length > 0
                        ? `Exportar ${selectedItems.length} seleccionados`
                        : "Exportar registros"
                    }
                    type="button"
                    variant="outline"
                  >
                    <DownloadSimple aria-hidden="true" />
                  </Button>
                ) : null}
                <details className="relative">
                  <summary
                    aria-label="Configurar campos visibles"
                    className="grid size-11 cursor-pointer list-none place-items-center rounded-md border border-border bg-card text-foreground transition-[background-color,border-color,color,transform] duration-200 hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 active:scale-[0.985]"
                    title="Configurar campos"
                  >
                    <SlidersHorizontal aria-hidden="true" />
                    <span className="sr-only">Configurar campos</span>
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 min-w-56 space-y-2 rounded-xl border bg-card p-3 shadow-lg">
                    {columns.map((column) => (
                      <label
                        className="flex items-center gap-2 text-sm"
                        key={column.header}
                      >
                        <input
                          checked={visibleHeaders.has(column.header)}
                          disabled={
                            visibleHeaders.size === 1 &&
                            visibleHeaders.has(column.header)
                          }
                          onChange={() =>
                            setVisibleHeaders((current) => {
                              const next = new Set(current);
                              if (next.has(column.header))
                                next.delete(column.header);
                              else next.add(column.header);
                              return next;
                            })
                          }
                          type="checkbox"
                        />
                        {column.header}
                      </label>
                    ))}
                  </div>
                </details>
                <Button
                  aria-label="Guardar vista actual"
                  onClick={() => setShowSaveView((current) => !current)}
                  size="icon-lg"
                  title="Guardar vista"
                  type="button"
                  variant="outline"
                >
                  <FloppyDisk aria-hidden="true" />
                </Button>
                <div className="min-w-24 flex-1 sm:flex-none">
                  <label
                    className="sr-only"
                    htmlFor={`${testId ?? "resource-list"}-page-size`}
                  >
                    Registros por página
                  </label>
                  <Select
                    className="h-11"
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
              </div>
            </div>
            {showSaveView ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/25 p-3 sm:flex-row">
                <Input
                  aria-label="Nombre de la vista"
                  className="h-11"
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="Nombre de la vista"
                  value={viewName}
                />
                <Button
                  disabled={!viewName.trim()}
                  onClick={saveCurrentView}
                  size="lg"
                  type="button"
                >
                  Guardar
                </Button>
                <Button
                  onClick={() => setShowSaveView(false)}
                  size="lg"
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
              </div>
            ) : null}
            {filters.length > 0 ? (
              <div className="flex w-full flex-col gap-3 rounded-lg bg-muted/45 p-3 lg:flex-row lg:items-end">
                <div className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-foreground lg:pr-2">
                  <span className="grid size-8 place-items-center rounded-md bg-card text-primary shadow-[0_0_0_1px_var(--border)]">
                    <Funnel aria-hidden="true" />
                  </span>
                  <span>Filtrar</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {filters.map((filter) => (
                    <label
                      className="min-w-0 flex-1 space-y-1 sm:min-w-48 sm:max-w-64"
                      key={filter.key}
                    >
                      <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {filter.label}
                      </span>
                      <Select
                        className="h-11 bg-card"
                        onChange={(event) => {
                          setActiveFilters((current) => ({
                            ...current,
                            [filter.key]: event.target.value,
                          }));
                          setCurrentPage(1);
                          setSelectedIds(new Set());
                          setActiveViewName("");
                        }}
                        value={activeFilters[filter.key] ?? ""}
                      >
                        <option value="">
                          {filter.allLabel ??
                            `Todos: ${filter.label.toLocaleLowerCase()}`}
                        </option>
                        {filter.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
                {hasActiveFilters || hasSearch || sort ? (
                  <Button
                    className="shrink-0 lg:ml-auto"
                    onClick={resetFilters}
                    size="lg"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                    Limpiar
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {paginatedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center">
          <p className="font-medium">
            {hasSearch ? "Sin resultados" : emptyTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasSearch
              ? "Prueba con otro término de búsqueda o limpia el filtro."
              : emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border/90 bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {enableSelection ? (
                    <TableHead className="w-10">
                      <input
                        aria-label="Seleccionar página"
                        checked={
                          paginatedItems.length > 0 &&
                          paginatedItems.every((item) =>
                            selectedIds.has(getRowId(item)),
                          )
                        }
                        onChange={(event) =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            for (const item of paginatedItems) {
                              const id = getRowId(item);
                              if (event.target.checked) next.add(id);
                              else next.delete(id);
                            }
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    </TableHead>
                  ) : null}
                  {visibleColumns.map((column) => (
                    <TableHead
                      aria-sort={
                        sort?.header === column.header
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={column.className}
                      key={column.header}
                    >
                      {column.sortValue ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort(column.header)}
                          type="button"
                        >
                          {column.header}
                          {sort?.header === column.header ? (
                            sort.direction === "asc" ? (
                              <CaretUp aria-hidden="true" className="size-3" />
                            ) : (
                              <CaretDown
                                aria-hidden="true"
                                className="size-3"
                              />
                            )
                          ) : (
                            <CaretUpDown
                              aria-hidden="true"
                              className="size-3"
                            />
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
                  <TableRow
                    data-testid={getRowTestId?.(item)}
                    key={getRowId(item)}
                  >
                    {enableSelection ? (
                      <TableCell>
                        <input
                          aria-label={`Seleccionar ${getRowId(item)}`}
                          checked={selectedIds.has(getRowId(item))}
                          onChange={() => toggleSelection(getRowId(item))}
                          type="checkbox"
                        />
                      </TableCell>
                    ) : null}
                    {visibleColumns.map((column) => (
                      <TableCell
                        className={column.className}
                        key={column.header}
                      >
                        {column.cell(item)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div
            className="grid gap-3 md:hidden"
            data-testid="resource-list-mobile"
          >
            {paginatedItems.map((item) => (
              <article
                className="rounded-xl border border-border/90 bg-card p-4"
                data-testid={
                  getRowTestId ? `${getRowTestId(item)}-mobile` : undefined
                }
                key={getRowId(item)}
              >
                {renderMobileCard ? (
                  renderMobileCard(item)
                ) : (
                  <dl className="space-y-2">
                    {visibleColumns.map((column) => (
                      <div
                        className="flex justify-between gap-3"
                        key={column.header}
                      >
                        <dt className="text-sm text-muted-foreground">
                          {column.header}
                        </dt>
                        <dd className="text-right text-sm font-medium">
                          {column.cell(item)}
                        </dd>
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safePage === 1}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
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
