"use client";

import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretUpDown,
  DownloadSimple,
  FloppyDisk,
  Funnel,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildListSearch, LIST_PARAM, type ServerListState } from "@/lib/list-params";
import { cn } from "@/lib/utils";

export type { ServerListState };

export type ResourceListColumn<TItem> = {
  header: string;
  cell: (item: TItem) => ReactNode;
  alwaysVisible?: boolean;
  className?: string;
  exportValue?: (item: TItem) => string | number | null | undefined;
  sortValue?: (item: TItem) => string | number | Date | null | undefined;
  /** Server mode: whitelisted sort key sent as `?sort=` (the column is sortable only if set). */
  sortKey?: string;
  /**
   * Footer value computed over every filtered row (not only the current page), e.g. a sum of amounts.
   * In server mode `rows` is only the current page: return a server-computed total instead.
   */
  summary?: (rows: TItem[]) => ReactNode;
};

export type ResourceListCreateAction = {
  label: string;
  href: string;
  testId?: string;
};

export type ResourceListDateRange<TItem> = {
  /** Label of the date being filtered, e.g. "Fecha de emisión". */
  label: string;
  /** Client mode only (server mode filters with `?from=&to=`). */
  getValue?: (item: TItem) => string | Date | null | undefined;
};

export type ResourceListFilter<TItem> = {
  key: string;
  label: string;
  allLabel?: string;
  options: Array<{ label: string; value: string }>;
  /** Client mode only (server mode sends `?<key>=<value>`). */
  getValue?: (item: TItem) => string | null | undefined;
};

type ResourceListProps<TItem> = {
  title: string;
  items: TItem[];
  columns: ResourceListColumn<TItem>[];
  /** Client mode only: text matched by the search box (server mode searches in SQL). */
  getSearchText?: (item: TItem) => string;
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
  /** Human name of a row for the selection checkbox ("Seleccionar F-2026/0001"). */
  getRowLabel?: (item: TItem) => string;
  /** Extra classes per row (e.g. highlight overdue invoices). */
  getRowClassName?: (item: TItem) => string | undefined;
  /** Primary "create" action shown in the toolbar and in the empty state. */
  createAction?: ResourceListCreateAction;
  /** Adds "desde / hasta" date inputs filtering by the given date. */
  dateRange?: ResourceListDateRange<TItem>;
  /** Actions for the selected rows, rendered in a bar above the table. */
  bulkActions?: (selectedItems: TItem[], clearSelection: () => void) => ReactNode;
  /** Label of the totals footer row. */
  summaryLabel?: string;
  /**
   * Server mode: `items` is already the requested page (searched, filtered and sorted by
   * the server). The list keeps the same UX but writes its state to the URL
   * (`?q=&page=&pageSize=&sort=&dir=&from=&to=&<filter>=`) and the page re-renders.
   * Omit for small lists (client-side filtering and pagination).
   */
  server?: ServerListState;
};

type SortDirection = "asc" | "desc";
const defaultPageSizeOptions = [10, 25, 50, 100];
const DATE_FROM_KEY = "date-from";
const DATE_TO_KEY = "date-to";
const SEARCH_DEBOUNCE_MS = 300;

/** Server state → internal filter state (dates live under the client-mode keys). */
function serverFiltersToState(server: ServerListState): Record<string, string> {
  return {
    ...server.filters,
    ...(server.from ? { [DATE_FROM_KEY]: server.from } : {}),
    ...(server.to ? { [DATE_TO_KEY]: server.to } : {}),
  };
}

/** True when only the search text changed (typing resets the page too): debounce those. */
export function isSearchOnlyChange(previous: string, next: string) {
  const before = new URLSearchParams(previous);
  const after = new URLSearchParams(next);
  if (before.get(LIST_PARAM.q) === after.get(LIST_PARAM.q)) return false;
  for (const params of [before, after]) {
    params.delete(LIST_PARAM.q);
    params.delete(LIST_PARAM.page);
    params.sort();
  }
  return before.toString() === after.toString();
}

function toDateKey(value: string | Date | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** Page numbers with ellipsis: 1 … 4 5 6 … 12 */
export function paginationRange(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));
  const sorted = [...pages].sort((left, right) => left - right);
  const result: Array<number | "…"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("…");
    result.push(page);
  });
  return result;
}
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

// Spanish Excel expects ";" as separator and "," as decimal mark.
const CSV_DELIMITER = ";";

export function escapeCsvValue(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 10 })
      : "";
  }
  let text = String(value ?? "");
  // Neutralise spreadsheet formula injection from user-provided text.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d[\d.,]*(\s?[%€])?$/.test(text)) text = `'${text}`;
  return /[";,\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCsv(rows: Array<Array<string | number | null | undefined>>) {
  // BOM so Excel detects UTF-8 (accents, €) instead of the ANSI code page.
  return `﻿${rows.map((row) => row.map(escapeCsvValue).join(CSV_DELIMITER)).join("\r\n")}`;
}

export function ResourceList<TItem>({
  columns,
  emptyDescription,
  emptyTitle,
  getRowId,
  getRowTestId,
  getSearchText,
  items,
  pageSize = 25,
  pageSizeOptions = defaultPageSizeOptions,
  renderMobileCard,
  searchPlaceholder,
  testId,
  title,
  exportFileName,
  enableSelection = true,
  filters = [],
  getRowLabel,
  getRowClassName,
  createAction,
  dateRange,
  bulkActions,
  summaryLabel = "Total",
  server,
}: ResourceListProps<TItem>) {
  const isServerMode = Boolean(server);
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startNavigation] = useTransition();
  const sectionRef = useRef<HTMLElement>(null);
  const selectPageRef = useRef<HTMLInputElement>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const listId = testId ?? "resource-list";
  const sortHeaderFor = (sortKey: string | null | undefined) =>
    sortKey ? columns.find((column) => column.sortKey === sortKey)?.header ?? null : null;
  const [searchQuery, setSearchQuery] = useState(() => server?.q ?? "");
  const [currentPage, setCurrentPage] = useState(() => server?.page ?? 1);
  const [activePageSize, setActivePageSize] = useState(() => server?.pageSize ?? pageSize);
  const [sort, setSort] = useState<{
    header: string;
    direction: SortDirection;
  } | null>(() => {
    const header = sortHeaderFor(server?.sort);
    return header && server ? { header, direction: server.dir } : null;
  });
  const [visibleHeaders, setVisibleHeaders] = useState(
    () => new Set(columns.map((column) => column.header)),
  );
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const [activeViewName, setActiveViewName] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(
    () => (server ? serverFiltersToState(server) : {}),
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
  const filterKeysKey = [
    ...filters.map((filter) => filter.key),
    ...(dateRange ? [DATE_FROM_KEY, DATE_TO_KEY] : []),
  ].join("\u001f");
  const urlPrefix = `rl-${testId ?? title.toLocaleLowerCase().replaceAll(/\s+/g, "-")}-`;
  const visibleColumns = columns.filter((column) =>
    column.alwaysVisible || visibleHeaders.has(column.header),
  );
  const isSortable = (column: ResourceListColumn<TItem>) => (isServerMode ? Boolean(column.sortKey) : Boolean(column.sortValue));

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
          // In server mode the URL is the source of truth for the page size.
          if (
            !isServerMode &&
            parsed.pageSize &&
            pageSizeOptionsKey.split(",").map(Number).includes(parsed.pageSize)
          )
            setActivePageSize(parsed.pageSize);
        }
        if (isServerMode) return;
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
    isServerMode,
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

  // Client mode: mirror the state in prefixed URL params without navigating.
  useEffect(() => {
    if (!preferencesLoaded || isServerMode) return;
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
    for (const key of filterKeysKey.split("\u001f").filter(Boolean))
      setOrDelete(`${urlPrefix}filter-${key}`, activeFilters[key]);
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
    filterKeysKey,
    isServerMode,
    pageSize,
    preferencesLoaded,
    searchQuery,
    sort,
    urlPrefix,
  ]);

  // Server mode: write the state to `?q=&page=…` and let the page re-render with the new rows.
  // Typing is debounced; every other change navigates immediately.
  const serverSortKey = sort ? columns.find((column) => column.header === sort.header)?.sortKey ?? null : null;
  const serverSearch = isServerMode
    ? buildListSearch(
        "",
        {
          q: searchQuery,
          page: currentPage,
          pageSize: activePageSize,
          defaultPageSize: pageSize,
          sort: serverSortKey,
          dir: sort?.direction ?? null,
          from: activeFilters[DATE_FROM_KEY],
          to: activeFilters[DATE_TO_KEY],
          filters: activeFilters,
        },
        filters.map((filter) => filter.key),
      )
    : "";
  const lastSearchRef = useRef<string | null>(null);
  // Pending debounced URL update. It is cancelled when the user opens a record (link click or
  // Enter on a row): otherwise the late `router.replace` would drag them back to the list.
  const pendingSearchTimerRef = useRef<number | null>(null);
  const cancelPendingSearch = () => {
    if (pendingSearchTimerRef.current !== null) window.clearTimeout(pendingSearchTimerRef.current);
    pendingSearchTimerRef.current = null;
  };
  useEffect(() => {
    if (!isServerMode) return;
    const managedKeys = new Set<string>([
      ...Object.values(LIST_PARAM),
      ...filterKeysKey.split("\u001f").filter(Boolean),
    ]);
    const current = new URLSearchParams(window.location.search);
    const managedCurrent = new URLSearchParams([...current].filter(([key]) => managedKeys.has(key)));
    managedCurrent.sort();
    if (managedCurrent.toString() === serverSearch) {
      lastSearchRef.current = serverSearch;
      return;
    }
    const onlyQueryChanged = isSearchOnlyChange(lastSearchRef.current ?? managedCurrent.toString(), serverSearch);
    const timer = window.setTimeout(() => {
      pendingSearchTimerRef.current = null;
      // The user already left the list (e.g. opened a record): never pull them back.
      if (window.location.pathname !== pathname) return;
      const next = new URLSearchParams([...current].filter(([key]) => !managedKeys.has(key)));
      for (const [key, value] of new URLSearchParams(serverSearch)) next.set(key, value);
      const query = next.toString();
      lastSearchRef.current = serverSearch;
      startNavigation(() => {
        router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
      });
    }, onlyQueryChanged ? SEARCH_DEBOUNCE_MS : 0);
    pendingSearchTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingSearchTimerRef.current === timer) pendingSearchTimerRef.current = null;
    };
  }, [filterKeysKey, isServerMode, pathname, router, serverSearch]);

  // Server mode: adopt URL changes made outside the list (links, back/forward, server clamping the page).
  const serverStateKey = server ? JSON.stringify(server) : "";
  useEffect(() => {
    if (!server || isNavigating) return;
    const receivedSearch = buildListSearch(
      "",
      {
        q: server.q,
        page: server.page,
        pageSize: server.pageSize,
        defaultPageSize: pageSize,
        sort: server.sort,
        dir: server.dir,
        from: server.from,
        to: server.to,
        filters: server.filters,
      },
      filters.map((filter) => filter.key),
    );
    // Echo of our own navigation: the local state is already current (maybe newer, while typing).
    if (receivedSearch === lastSearchRef.current) return;
    const timer = window.setTimeout(() => {
      lastSearchRef.current = receivedSearch;
      setCurrentPage(server.page);
      setActivePageSize(server.pageSize);
      setActiveFilters(serverFiltersToState(server));
      const header = columns.find((column) => server.sort && column.sortKey === server.sort)?.header;
      setSort(header ? { header, direction: server.dir } : null);
      setSearchQuery((current) => (current.trim() === server.q ? current : server.q));
    }, 0);
    return () => window.clearTimeout(timer);
    // `serverStateKey` captures every field of `server`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverStateKey, isNavigating]);

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredItems = useMemo(
    () =>
      isServerMode
        ? items
        : items.filter((item) => {
            if (
              normalizedQuery &&
              !(getSearchText?.(item) ?? "").toLocaleLowerCase().includes(normalizedQuery)
            )
              return false;
            if (dateRange?.getValue && (activeFilters[DATE_FROM_KEY] || activeFilters[DATE_TO_KEY])) {
              const date = toDateKey(dateRange.getValue(item));
              if (!date) return false;
              if (activeFilters[DATE_FROM_KEY] && date < activeFilters[DATE_FROM_KEY]) return false;
              if (activeFilters[DATE_TO_KEY] && date > activeFilters[DATE_TO_KEY]) return false;
            }
            return filters.every((filter) => {
              const selected = activeFilters[filter.key];
              return !selected || !filter.getValue || filter.getValue(item) === selected;
            });
          }),
    [activeFilters, dateRange, filters, getSearchText, isServerMode, items, normalizedQuery],
  );
  const sortedItems = useMemo(() => {
    if (!sort || isServerMode) return filteredItems;

    const column = visibleColumns.find((entry) => entry.header === sort.header);
    if (!column?.sortValue) return filteredItems;

    return [...filteredItems].sort((left, right) => {
      const leftValue = normalizeSortValue(column.sortValue?.(left));
      const rightValue = normalizeSortValue(column.sortValue?.(right));
      const result =
        leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
      return sort.direction === "asc" ? result : -result;
    });
  }, [filteredItems, isServerMode, sort, visibleColumns]);
  /** Rows matching search and filters (all pages). */
  const matchingCount = server ? server.total : sortedItems.length;
  /** Rows without search/filters. */
  const recordCount = server ? server.unfilteredTotal : items.length;
  const totalPages = Math.max(
    1,
    Math.ceil(matchingCount / activePageSize),
  );
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = isServerMode
    ? sortedItems
    : sortedItems.slice(
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
  const summaryColumns = visibleColumns.filter((column) => column.summary);
  const pageSelectedCount = paginatedItems.filter((item) => selectedIds.has(getRowId(item))).length;
  const allPageSelected = paginatedItems.length > 0 && pageSelectedCount === paginatedItems.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;
  const firstShown = matchingCount === 0 ? 0 : (safePage - 1) * activePageSize + 1;
  const lastShown = Math.min(safePage * activePageSize, matchingCount);
  const rowIdsOnPage = paginatedItems.map((item) => getRowId(item));
  const focusableRowId = activeRowId && rowIdsOnPage.includes(activeRowId) ? activeRowId : rowIdsOnPage[0];
  const rowLabel = (item: TItem, index: number) => getRowLabel?.(item) ?? `fila ${(safePage - 1) * activePageSize + index + 1}`;

  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = somePageSelected;
  }, [somePageSelected]);

  function setFilterValue(key: string, value: string) {
    setActiveFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
    setSelectedIds(new Set());
    setActiveViewName("");
  }

  function goToPage(page: number) {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
    requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>("[data-resource-row]")?.scrollIntoView({ block: "nearest" }));
  }

  function toggleSort(header: string) {
    setCurrentPage(1);
    setSort((current) => {
      if (current?.header !== header) return { header, direction: "asc" };
      if (current.direction === "asc") return { header, direction: "desc" };
      return null;
    });
  }

  function exportRows(rows: TItem[]) {
    const csv = buildCsv([
      exportableColumns.map((column) => column.header),
      ...rows.map((item) =>
        exportableColumns.map((column) => column.exportValue?.(item)),
      ),
    ]);
    const blob = new Blob([csv], {
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
    if ((event.key === "PageDown" || event.key === "PageUp") && totalPages > 1) {
      event.preventDefault();
      goToPage(safePage + (event.key === "PageDown" ? 1 : -1));
      requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>("[data-resource-row][tabindex='0']")?.focus());
      return;
    }
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
      aria-busy={isNavigating || undefined}
      aria-describedby={`${listId}-keyboard-help`}
      className="min-w-0 space-y-2"
      data-loading={isNavigating || undefined}
      data-testid={testId}
      // Named region instead of a hidden heading: pages already render the same text as
      // their <h1>/<h2>, and a duplicate heading confuses screen readers and locators.
      aria-label={title}
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest("a[href]");
        if (anchor && !anchor.getAttribute("href")?.startsWith("?")) cancelPendingSearch();
      }}
      ref={sectionRef}
    >
      <p className="sr-only" id={`${listId}-keyboard-help`}>
        Pulsa Alt F para buscar. En las filas usa flecha arriba y abajo para moverte, Enter para abrir, Espacio para seleccionar y Av Pág o Re Pág para cambiar de página.
      </p>
      <div className="w-full overflow-visible rounded-[2px] border border-window-dark-shadow bg-card p-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]">
        <div className="mb-1.5 flex min-h-5 flex-wrap items-center justify-between gap-1">
          <p
            className="font-mono text-[0.7rem] font-bold text-foreground"
            aria-live="polite"
            data-testid={`${listId}-summary`}
          >
            <span className="font-semibold tabular-nums">
              {matchingCount}
            </span>
            <span className="text-muted-foreground">
              {" "}de {recordCount} registros
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {selectedItems.length > 0 ? (
              <p
                aria-live="polite"
                className="border border-window-dark-shadow bg-primary px-1.5 py-0.5 font-mono text-[0.65rem] font-bold text-primary-foreground"
              >
                {selectedItems.length} seleccionados
              </p>
            ) : null}
            {createAction && recordCount > 0 ? (
              <Link
                className={buttonVariants({ size: "sm" })}
                data-testid={createAction.testId}
                href={createAction.href}
              >
                <Plus aria-hidden="true" />
                {createAction.label}
              </Link>
            ) : null}
          </div>
        </div>
        {recordCount > 0 ? (
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
                  htmlFor={`${listId}-search`}
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
                    id={`${listId}-search`}
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
                        : isServerMode
                          ? "Exportar los registros de esta página"
                          : "Exportar registros visibles"
                    }
                    disabled={paginatedItems.length === 0}
                    onClick={() =>
                      exportRows(
                        selectedItems.length > 0 ? selectedItems : sortedItems,
                      )
                    }
                    size="icon-lg"
                    title={
                      selectedItems.length > 0
                        ? `Exportar ${selectedItems.length} seleccionados`
                        : isServerMode
                          ? "Exportar esta página"
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
                    htmlFor={`${listId}-page-size`}
                  >
                    Registros por página
                  </label>
                  <Select
                    className="h-9"
                    id={`${listId}-page-size`}
                    onChange={(event) => {
                      setActivePageSize(Number(event.target.value));
                      setCurrentPage(1);
                    }}
                    value={activePageSize}
                  >
                    {pageSizeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} por página
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
            {filters.length > 0 || dateRange ? (
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
                        onChange={(event) => setFilterValue(filter.key, event.target.value)}
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
                  {dateRange ? (
                    <fieldset className="flex min-w-0 flex-1 gap-1.5 sm:min-w-64 sm:max-w-80">
                      <legend className="sr-only">{dateRange.label}</legend>
                      <label className="min-w-0 flex-1 space-y-0.5">
                        <span className="block font-mono text-[0.6rem] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                          {dateRange.label}: desde
                        </span>
                        <Input
                          className="h-8"
                          data-testid={`${listId}-date-from`}
                          max={activeFilters[DATE_TO_KEY] || undefined}
                          onChange={(event) => setFilterValue(DATE_FROM_KEY, event.target.value)}
                          type="date"
                          value={activeFilters[DATE_FROM_KEY] ?? ""}
                        />
                      </label>
                      <label className="min-w-0 flex-1 space-y-0.5">
                        <span className="block font-mono text-[0.6rem] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                          hasta
                        </span>
                        <Input
                          className="h-8"
                          data-testid={`${listId}-date-to`}
                          min={activeFilters[DATE_FROM_KEY] || undefined}
                          onChange={(event) => setFilterValue(DATE_TO_KEY, event.target.value)}
                          type="date"
                          value={activeFilters[DATE_TO_KEY] ?? ""}
                        />
                      </label>
                    </fieldset>
                  ) : null}
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
        {bulkActions && selectedItems.length > 0 ? (
          <div
            aria-label="Acciones sobre la selección"
            className="mt-1.5 flex flex-wrap items-center gap-1.5 border border-primary bg-primary/10 p-1.5"
            role="toolbar"
          >
            <span className="font-mono text-[0.7rem] font-bold">Con {selectedItems.length} seleccionados:</span>
            {bulkActions(selectedItems, () => setSelectedIds(new Set()))}
            <Button className="ml-auto" onClick={() => setSelectedIds(new Set())} size="sm" type="button" variant="ghost">
              <X aria-hidden="true" />
              Quitar selección
            </Button>
          </div>
        ) : null}
      </div>

      {paginatedItems.length === 0 ? (
        <div
          className="border border-dashed border-window-dark-shadow bg-window-panel px-4 py-5 text-center"
          role="status"
        >
          <p className="font-mono text-sm font-bold">
            {hasSearch || hasActiveFilters ? "Sin resultados" : emptyTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasSearch || hasActiveFilters
              ? `Ningún registro coincide con ${hasSearch && hasActiveFilters ? "la búsqueda y los filtros" : hasSearch ? "la búsqueda" : "los filtros"} aplicados.`
              : emptyDescription}
          </p>
          {!hasSearch && !hasActiveFilters && createAction ? (
            <Link
              className={cn(buttonVariants(), "mt-2")}
              data-testid={createAction.testId ? `${createAction.testId}-empty` : undefined}
              href={createAction.href}
            >
              <Plus aria-hidden="true" />
              {createAction.label}
            </Link>
          ) : null}
          {hasSearch || hasActiveFilters ? (
            <Button
              className="mt-2"
              onClick={resetFilters}
              size="sm"
              type="button"
              variant="outline"
            >
              <X aria-hidden="true" />
              Limpiar búsqueda y filtros
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className={cn("hidden max-h-[max(24rem,calc(100dvh-13rem))] overflow-auto border border-window-dark-shadow bg-card md:block", isNavigating && "opacity-60 motion-safe:transition-opacity")}>
            <Table>
              <TableHeader className="sticky top-0 z-10 shadow-[0_1px_0_var(--window-dark-shadow)]">
                <TableRow>
                  {enableSelection ? (
                    <TableHead className="w-10">
                      <input
                        aria-checked={somePageSelected ? "mixed" : allPageSelected}
                        aria-label={`Seleccionar las ${paginatedItems.length} filas de esta página`}
                        checked={allPageSelected}
                        ref={selectPageRef}
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
                      {isSortable(column) ? (
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
                    aria-selected={enableSelection ? selectedIds.has(getRowId(item)) : undefined}
                    className={cn(
                      "focus-visible:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                      selectedIds.has(getRowId(item)) && "bg-primary/10",
                      getRowClassName?.(item),
                    )}
                    data-resource-row
                    data-testid={getRowTestId?.(item)}
                    key={getRowId(item)}
                    onFocus={() => setActiveRowId(getRowId(item))}
                    onKeyDown={(event) => handleRowKeyDown(event, getRowId(item))}
                    tabIndex={getRowId(item) === focusableRowId ? 0 : -1}
                  >
                    {enableSelection ? (
                      <TableCell>
                        <input
                          aria-label={`Seleccionar ${rowLabel(item, index)}`}
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
              {summaryColumns.length > 0 ? (
                <TableFooter className="sticky bottom-0 z-10" data-testid={`${listId}-totals`}>
                  <TableRow className="hover:bg-transparent">
                    {enableSelection ? <TableCell /> : null}
                    {visibleColumns.map((column, columnIndex) => (
                      <TableCell className={column.className} key={column.header}>
                        {column.summary ? (
                          <span className="tabular-nums">{column.summary(sortedItems)}</span>
                        ) : columnIndex === 0 ? (
                          <span className="text-[0.68rem] uppercase tracking-[0.04em]">
                            {summaryLabel} ({matchingCount})
                          </span>
                        ) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>

          <div
            className={cn("grid gap-2 md:hidden", isNavigating && "opacity-60")}
            data-testid="resource-list-mobile"
          >
            {paginatedItems.map((item) => (
              <article
                aria-keyshortcuts="ArrowUp ArrowDown Home End Enter Space"
                aria-label={getRowLabel?.(item)}
                className={cn(
                  "border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  selectedIds.has(getRowId(item)) && "outline-2 outline-primary",
                  getRowClassName?.(item),
                )}
                data-resource-row
                data-testid={
                  getRowTestId ? `${getRowTestId(item)}-mobile` : undefined
                }
                key={getRowId(item)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setActiveRowId(getRowId(item));
                }}
                onKeyDown={(event) => handleRowKeyDown(event, getRowId(item))}
                tabIndex={getRowId(item) === focusableRowId ? 0 : -1}
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
            {summaryColumns.length > 0 ? (
              <dl className="space-y-1 border border-window-dark-shadow bg-window-panel p-2.5 font-mono text-xs">
                <div className="flex justify-between gap-3 font-bold uppercase">
                  <dt>{summaryLabel}</dt>
                  <dd>{matchingCount} registros</dd>
                </div>
                {summaryColumns.map((column) => (
                  <div className="flex justify-between gap-3" key={column.header}>
                    <dt className="text-muted-foreground">{column.header}</dt>
                    <dd className="font-bold tabular-nums">{column.summary?.(sortedItems)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </>
      )}

      {matchingCount > 0 ? (
        <div className="flex flex-col gap-2 border-t border-window-shadow pt-2 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="font-mono text-xs text-muted-foreground" data-testid={`${listId}-range`}>
            Mostrando <span className="font-bold text-foreground tabular-nums">{firstShown}–{lastShown}</span> de{" "}
            <span className="font-bold text-foreground tabular-nums">{matchingCount}</span>
          </p>
          {totalPages > 1 ? (
            <nav aria-label={`Paginación de ${title.toLocaleLowerCase()}`}>
              <ul className="flex flex-wrap items-center gap-1">
                <li>
                  <Button
                    aria-label="Página anterior"
                    disabled={safePage === 1}
                    onClick={() => goToPage(safePage - 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <CaretLeft aria-hidden="true" />
                    <span className="max-sm:sr-only">Anterior</span>
                  </Button>
                </li>
                {paginationRange(safePage, totalPages).map((page, index) =>
                  page === "…" ? (
                    <li aria-hidden="true" className="px-1 font-mono text-xs text-muted-foreground" key={`gap-${index}`}>
                      …
                    </li>
                  ) : (
                    <li key={page}>
                      <Button
                        aria-current={page === safePage ? "page" : undefined}
                        aria-label={`Página ${page}`}
                        className="min-w-7 tabular-nums"
                        onClick={() => goToPage(page)}
                        size="sm"
                        type="button"
                        variant={page === safePage ? "default" : "outline"}
                      >
                        {page}
                      </Button>
                    </li>
                  ),
                )}
                <li>
                  <Button
                    aria-label="Página siguiente"
                    disabled={safePage === totalPages}
                    onClick={() => goToPage(safePage + 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <span className="max-sm:sr-only">Siguiente</span>
                    <CaretRight aria-hidden="true" />
                  </Button>
                </li>
              </ul>
            </nav>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
