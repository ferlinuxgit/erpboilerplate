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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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
  alwaysVisible?: boolean;
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
  const sectionRef = useRef<HTMLElement>(null);
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
  const alwaysVisibleHeadersKey = columns
    .filter((column) => column.alwaysVisible)
    .map((column) => column.header)
    .join("\u001f");
  const filterKeysKey = filters.map((filter) => filter.key).join("\u001f");
  const urlPrefix = `rl-${testId ?? title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}-`;
  const visibleColumns = columns.filter((column) =>
    column.alwaysVisible || visibleHeaders.has(column.header),
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
            const alwaysVisibleHeaders = alwaysVisibleHeadersKey
              .split("\u001f")
              .filter(Boolean);
            setVisibleHeaders(
              new Set(
                restoredHeaders.length > 0
                  ? [...restoredHeaders, ...alwaysVisibleHeaders]
                  : availableHeaders,
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
    alwaysVisibleHeadersKey,
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
    const alwaysVisibleHeaders = columns
      .filter((column) => column.alwaysVisible)
      .map((column) => column.header);
    setVisibleHeaders(
      new Set(
        restoredHeaders.length > 0
          ? [...restoredHeaders, ...alwaysVisibleHeaders]
          : availableHeaders,
      ),
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

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, rowId: string) {
    if (event.target !== event.currentTarget) return;
    const rows = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-resource-row]") ?? [])
      .filter((row) => row.getClientRects().length > 0);
    const currentIndex = rows.indexOf(event.currentTarget);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = rows.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      rows[nextIndex]?.focus();
      rows[nextIndex]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key === "Enter") {
      const primaryAction = event.currentTarget.querySelector<HTMLElement>("a[href], button:not([disabled])");
      if (primaryAction) {
        event.preventDefault();
        primaryAction.click();
      }
    } else if (event.key === " " && enableSelection) {
      event.preventDefault();
      toggleSelection(rowId);
    }
  }

  return (
    <section
      aria-describedby={`${testId ?? "resource-list"}-keyboard-help`}
      className="min-w-0 space-y-2"
      data-testid={testId}
      aria-labelledby={`${testId ?? "resource-list"}-title`}
      ref={sectionRef}
    >
      <h3 className="sr-only" id={`${testId ?? "resource-list"}-title`}>
        {title}
      </h3>
      <p className="sr-only" id={`${testId ?? "resource-list"}-keyboard-help`}>
        Pulsa Alt F para buscar. En las filas usa flecha arriba y abajo para moverte, Enter para abrir y Espacio para seleccionar.
      </p>
      <div className="w-full overflow-visible rounded-[2px] border border-window-dark-shadow bg-card p-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]">
        <div className="mb-1.5 flex min-h-5 flex-wrap items-center justify-between gap-1">
          <p
            className="font-mono text-[0.7rem] font-medium text-foreground"
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
              className="border border-window-dark-shadow bg-primary px-1.5 py-0.5 font-mono text-[0.65rem] font-bold text-primary-foreground"
            >
              {selectedItems.length} seleccionados
            </p>
          ) : null}
        </div>
        {items.length > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-1.5">
            <div className="grid min-w-0 gap-1.5 lg:grid-cols-[minmax(14rem,1fr)_auto]">
              <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row">
                {savedViews.length > 0 ? (
                  <div className="flex min-w-0 gap-1 sm:w-40 sm:shrink-0">
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
                    aria-keyshortcuts="Alt+F Escape"
                    className="h-8 pl-8 pr-8"
                    data-resource-search
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
                    onKeyDown={(event) => {
                      if (event.key !== "Escape" || !searchQuery) return;
                      event.preventDefault();
                      setSearchQuery("");
                      setCurrentPage(1);
                    }}
                  />
                  {hasSearch ? (
                    <Button
                      aria-label="Limpiar búsqueda"
                      className="absolute right-0 top-0 size-8"
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
              <div className="flex min-w-0 flex-wrap items-center gap-1 lg:justify-end">
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
                <details
                  className="relative"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !event.currentTarget.open) return;
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }}
                >
                  <summary
                    aria-label="Configurar campos visibles"
                    className="grid size-9 cursor-pointer list-none place-items-center rounded-[2px] border border-window-dark-shadow bg-window-surface text-window-text shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:translate-x-px active:translate-y-px"
                    title="Configurar campos"
                  >
                    <SlidersHorizontal aria-hidden="true" />
                    <span className="sr-only">Configurar campos</span>
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 min-w-52 space-y-1 border border-window-dark-shadow bg-window-surface p-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow),4px_4px_0_rgba(0,0,0,0.25)]">
                    {columns.map((column) => (
                      <label
                        className="flex items-center gap-1.5 font-mono text-xs"
                        key={column.header}
                      >
                        <input
                          checked={column.alwaysVisible || visibleHeaders.has(column.header)}
                          disabled={
                            column.alwaysVisible ||
                            (visibleHeaders.size === 1 && visibleHeaders.has(column.header))
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
                    className="h-9"
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
              <div className="flex flex-col gap-1.5 border border-window-dark-shadow bg-window-panel p-2 sm:flex-row">
                <Input
                  aria-label="Nombre de la vista"
                  className="h-8"
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
              <div className="flex w-full flex-col gap-1.5 border border-window-shadow bg-window-panel p-2 lg:flex-row lg:items-end">
                <div className="flex min-h-8 shrink-0 items-center gap-1.5 font-mono text-xs font-bold text-foreground lg:pr-1">
                  <span className="grid size-7 place-items-center border border-window-dark-shadow bg-window-surface text-primary shadow-[inset_1px_1px_0_var(--window-highlight)]">
                    <Funnel aria-hidden="true" />
                  </span>
                  <span>Filtrar</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap">
                  {filters.map((filter) => (
                    <label
                      className="min-w-0 flex-1 space-y-0.5 sm:min-w-40 sm:max-w-56"
                      key={filter.key}
                    >
                      <span className="block font-mono text-[0.6rem] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                        {filter.label}
                      </span>
                      <Select
                        className="h-8 bg-window-highlight"
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
        <div className="border border-dashed border-window-dark-shadow bg-window-panel px-4 py-5 text-center">
          <p className="font-mono text-sm font-bold">
            {hasSearch ? "Sin resultados" : emptyTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasSearch
              ? "Prueba con otro término de búsqueda o limpia el filtro."
              : emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto border border-window-dark-shadow bg-card md:block">
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
                {paginatedItems.map((item, index) => (
                  <TableRow
                    aria-keyshortcuts="ArrowUp ArrowDown Home End Enter Space"
                    className="focus-visible:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    data-resource-row
                    data-testid={getRowTestId?.(item)}
                    key={getRowId(item)}
                    onKeyDown={(event) => handleRowKeyDown(event, getRowId(item))}
                    tabIndex={index === 0 ? 0 : -1}
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
            className="grid gap-2 md:hidden"
            data-testid="resource-list-mobile"
          >
            {paginatedItems.map((item, index) => (
              <article
                aria-keyshortcuts="ArrowUp ArrowDown Home End Enter Space"
                className="border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                data-resource-row
                data-testid={
                  getRowTestId ? `${getRowTestId(item)}-mobile` : undefined
                }
                key={getRowId(item)}
                onKeyDown={(event) => handleRowKeyDown(event, getRowId(item))}
                tabIndex={index === 0 ? 0 : -1}
              >
                {renderMobileCard ? (
                  renderMobileCard(item)
                ) : (
                  <dl className="space-y-1.5">
                    {visibleColumns.map((column) => (
                      <div
                        className="flex justify-between gap-3"
                        key={column.header}
                      >
                        <dt className="font-mono text-xs text-muted-foreground">
                          {column.header}
                        </dt>
                        <dd className="text-right font-mono text-xs font-bold">
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
        <div className="flex items-center justify-between gap-2 border-t border-window-shadow pt-2">
          <p className="font-mono text-xs text-muted-foreground">
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
