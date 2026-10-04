"use client";

import { CaretDown, CaretUp, DownloadSimple, ListBullets, MagnifyingGlass, Plus, SquaresFour, TreeStructure, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";

import { AccountContextMenu, type ContextMenuCommand } from "@/components/accounting/chart/account-context-menu";
import { AccountDetailPanel } from "@/components/accounting/chart/account-detail-panel";
import { AccountTree } from "@/components/accounting/chart/account-tree";
import { ChartListView } from "@/components/accounting/chart/chart-list-view";
import { ChartMobileView } from "@/components/accounting/chart/chart-mobile-view";
import { ChartSchemeView } from "@/components/accounting/chart/chart-scheme-view";
import { readKeyboardPreferences } from "@/components/layout/keyboard-preferences";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { ledgerHref } from "@/lib/chart-of-accounts/format";
import { chartApiParams, hasActiveFilters, NO_CHART_FILTERS, serializeChartFilters, serializeChartUrlState, type ChartUrlState } from "@/lib/chart-of-accounts/query";
import {
  ancestorsInStore,
  expandedFromLoaded,
  flattenVisible,
  mergeTreeResponse,
  nextMatchCode,
  ROOT_KEY,
  treeStoreFromResponse,
  updateStoreNode,
  type LoadStatus,
  type TreeKeyAction,
  type TreeStore,
} from "@/lib/chart-of-accounts/tree";
import {
  CHART_FILTER_KEYS,
  CHART_FILTER_LABELS,
  CHART_LEVELS,
  type ChartFilterKey,
  type ChartFiscalYearOption,
  type ChartLevel,
  type ChartNode,
  type ChartTreeResponse,
  type ChartView,
} from "@/lib/chart-of-accounts/types";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";

type ChartOfAccountsViewProps = {
  initialState: ChartUrlState;
  initialTree: ChartTreeResponse;
  years: ChartFiscalYearOption[];
  activeYearId: string | null;
  canManage: boolean;
  currency: string;
};

const LEVEL_LABELS: Record<ChartLevel, string> = { "1": "1", "2": "2", "3": "3", "4": "4", sub: "Sub" };
const VIEW_OPTIONS: Array<{ value: ChartView; label: string; icon: typeof TreeStructure }> = [
  { value: "tree", label: "Árbol", icon: TreeStructure },
  { value: "list", label: "Lista", icon: ListBullets },
  { value: "scheme", label: "Esquema", icon: SquaresFour },
];
const MOBILE_QUERY = "(max-width: 767px)";
const PANEL_MIN = 300;
const PANEL_MAX = 640;
const PANEL_DEFAULT = 380;

function subscribeMedia(callback: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function useIsMobile() {
  return useSyncExternalStore(subscribeMedia, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}

async function fetchTree(params: URLSearchParams, signal?: AbortSignal): Promise<ChartTreeResponse> {
  const response = await fetch(`/api/accounts/tree?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(await readApiError(response, "No se pudo cargar el plan contable."));
  return response.json();
}

type TreeRequest = { level: ChartLevel; q: string; fy: string | null; from: string | null; to: string | null; filters: string; reveal: string | null };

function treeRequestKey(request: TreeRequest) {
  return JSON.stringify(request);
}

function treeRequestParams(request: TreeRequest) {
  const params = new URLSearchParams();
  if (request.fy) params.set("fy", request.fy);
  if (request.from) params.set("from", request.from);
  if (request.to) params.set("to", request.to);
  if (request.filters) params.set("f", request.filters);
  if (request.q) params.set("q", request.q);
  else {
    params.set("level", request.level);
    if (request.reveal) params.set("reveal", request.reveal);
  }
  return params;
}

function initialExpanded(store: TreeStore, tree: ChartTreeResponse, reveal: string | null) {
  const expanded = expandedFromLoaded(store);
  if (tree.matchCodes.length > 0) for (const code of tree.loadedParents) if (code) expanded.add(code);
  if (reveal) for (const code of ancestorsInStore(store, reveal)) expanded.add(code);
  return expanded;
}

/**
 * Plan contable: barra común (vista, ejercicio y periodo, nivel, búsqueda, filtros, exportar) y
 * vistas Árbol (treegrid con ficha lateral), Lista y Esquema. El estado vive en la URL.
 */
export function ChartOfAccountsView({ activeYearId, canManage, currency, initialState, initialTree, years }: ChartOfAccountsViewProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const searchId = useId();
  const helpId = useId();
  const detailHeadingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<ChartUrlState>(initialState);
  const [searchText, setSearchText] = useState(initialState.q);
  const [reveal, setReveal] = useState<string | null>(initialState.q ? null : initialState.sel);
  const treeRequest: TreeRequest = useMemo(
    () => ({ level: state.level, q: state.q.trim(), fy: state.fy, from: state.from, to: state.to, filters: serializeChartFilters(state.filters), reveal }),
    [reveal, state.filters, state.from, state.fy, state.level, state.q, state.to],
  );
  const treeKey = treeRequestKey(treeRequest);

  const [store, setStore] = useState<TreeStore>(() => treeStoreFromResponse(initialTree));
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(treeStoreFromResponse(initialTree), initialTree, reveal));
  const [matchCodes, setMatchCodes] = useState<string[]>(initialTree.matchCodes);
  const [truncated, setTruncated] = useState(initialTree.truncated);
  const [range, setRange] = useState(initialTree.range);
  const [loadedKey, setLoadedKey] = useState(treeKey);
  const [treeError, setTreeError] = useState<{ key: string; message: string } | null>(null);
  const [treeRetry, setTreeRetry] = useState(0);
  const [status, setStatus] = useState<Map<string, LoadStatus>>(new Map());
  const [focusedCode, setFocusedCode] = useState<string | null>(initialState.sel ?? initialTree.matchCodes[0] ?? null);
  const [selectedCode, setSelectedCode] = useState<string | null>(initialState.sel ?? initialTree.matchCodes[0] ?? null);
  const [scrollTarget, setScrollTarget] = useState<{ code: string; nonce: number } | null>(selectedCode ? { code: selectedCode, nonce: 0 } : null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [mobileParent, setMobileParent] = useState<string>(ROOT_KEY);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ code: string; x: number; y: number } | null>(null);
  const [listData, setListData] = useState<{ key: string; nodes: ChartNode[]; error: string | null } | null>(null);
  const [schemeData, setSchemeData] = useState<{ key: string; nodes: ChartNode[]; error: string | null } | null>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  const storeRef = useRef(store);
  const selectedRef = useRef(selectedCode);

  useEffect(() => {
    storeRef.current = store;
    selectedRef.current = selectedCode;
  }, [selectedCode, store]);

  // Estado en la URL (sin navegación): Atrás y los enlaces compartidos vuelven a la misma vista.
  useEffect(() => {
    const query = serializeChartUrlState(state);
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [state]);

  // Búsqueda con espera: se lanza 300 ms después de dejar de escribir.
  useEffect(() => {
    if (searchText.trim() === state.q.trim()) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, q: searchText.trim(), sel: null }));
      setReveal(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, state.q]);

  // Árbol: recarga completa al cambiar nivel, búsqueda, periodo o filtros.
  useEffect(() => {
    if (loadedKey === treeKey) return;
    const controller = new AbortController();
    const request: TreeRequest = JSON.parse(treeKey);
    fetchTree(treeRequestParams(request), controller.signal)
      .then((response) => {
        const nextStore = treeStoreFromResponse(response);
        const pending = pendingSelectionRef.current ?? request.reveal;
        pendingSelectionRef.current = null;
        const selection = request.q ? response.matchCodes[0] ?? null : pending && nextStore.nodes.has(pending) ? pending : null;
        // Sin selección nueva se conserva la actual si sigue en el árbol (y se trae a la vista).
        const kept = selection ?? (selectedRef.current && nextStore.nodes.has(selectedRef.current) ? selectedRef.current : null);
        const nextExpanded = initialExpanded(nextStore, response, kept ?? request.reveal);
        if (kept && !selection) setScrollTarget({ code: kept, nonce: Date.now() });
        setStore(nextStore);
        setExpanded(nextExpanded);
        setMatchCodes(response.matchCodes);
        setTruncated(response.truncated);
        setRange(response.range);
        setStatus(new Map());
        setMobileParent(ROOT_KEY);
        if (selection) {
          setSelectedCode(selection);
          setFocusedCode(selection);
          setScrollTarget({ code: selection, nonce: Date.now() });
          setState((current) => (current.sel === selection ? current : { ...current, sel: selection }));
        }
        setTreeError(null);
        setLoadedKey(treeKey);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTreeError({ key: treeKey, message: errorMessage(error, "No se pudo cargar el plan contable.") });
      });
    return () => controller.abort();
  }, [loadedKey, treeKey, treeRetry]);

  const periodParams = useMemo(() => chartApiParams({ fy: state.fy, from: state.from, to: state.to, filters: state.filters }), [state.filters, state.from, state.fy, state.to]);
  const periodQuery = useMemo(() => chartApiParams({ fy: state.fy, from: state.from, to: state.to, filters: NO_CHART_FILTERS }).toString(), [state.from, state.fy, state.to]);

  // Lista: todas las cuentas del periodo con los filtros (se carga al abrir la vista).
  const listKey = `${periodParams.toString()}#${refreshKey}`;
  useEffect(() => {
    if (state.view !== "list" || listData?.key === listKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams(periodParams);
    params.set("level", "sub");
    fetchTree(params, controller.signal)
      .then((response) => setListData({ key: listKey, nodes: [...response.nodes].sort((a, b) => a.code.localeCompare(b.code)), error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListData({ key: listKey, nodes: [], error: errorMessage(error, "No se pudo cargar la lista de cuentas.") });
      });
    return () => controller.abort();
  }, [listData?.key, listKey, periodParams, state.view]);

  // Esquema: grupos y subgrupos del periodo, sin filtros.
  const schemeKey = periodQuery;
  useEffect(() => {
    if (state.view !== "scheme" || schemeData?.key === schemeKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams(periodQuery);
    params.set("level", "2");
    fetchTree(params, controller.signal)
      .then((response) => setSchemeData({ key: schemeKey, nodes: response.nodes, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSchemeData({ key: schemeKey, nodes: [], error: errorMessage(error, "No se pudo cargar el esquema.") });
      });
    return () => controller.abort();
  }, [periodQuery, schemeData?.key, schemeKey, state.view]);

  // «/» enfoca la búsqueda del plan (antes que la paleta de comandos global).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"))) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']") || !readKeyboardPreferences().singleKeyShortcuts) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const treeLoading = loadedKey !== treeKey && treeError?.key !== treeKey;
  const rows = useMemo(() => flattenVisible(store, expanded, status), [expanded, status, store]);
  const matchSet = useMemo(() => new Set(matchCodes), [matchCodes]);
  const selectedNode = selectedCode ? store.nodes.get(selectedCode) ?? listData?.nodes.find((node) => node.code === selectedCode) ?? null : null;
  const activeYear = years.find((year) => year.id === (state.fy ?? activeYearId)) ?? null;
  const periodKey = activeYear?.periods.find((period) => period.from === range.from && period.to === range.to)?.key ?? "custom";
  const exactCodeMatch = /^\d+\.\d*$/.test(state.q.trim());
  const rowHeight = state.density === "comfortable" ? 36 : 28;
  const rootCount = store.children.get(ROOT_KEY)?.length ?? 0;

  const updateState = useCallback((patch: Partial<ChartUrlState>) => setState((current) => ({ ...current, ...patch })), []);

  const loadChildren = useCallback(
    (code: string) => {
      setStatus((current) => new Map(current).set(code, { state: "loading" }));
      const params = new URLSearchParams(periodParams);
      params.set("parent", code);
      fetchTree(params)
        .then((response) => {
          setStore((current) => mergeTreeResponse(current, response));
          setStatus((current) => {
            const next = new Map(current);
            next.delete(code);
            return next;
          });
        })
        .catch((error: unknown) => {
          setStatus((current) => new Map(current).set(code, { state: "error", message: errorMessage(error, `No se pudieron cargar las cuentas de ${code}.`) }));
        });
    },
    [periodParams],
  );

  const toggle = useCallback(
    (code: string) => {
      const isOpen = expanded.has(code);
      setExpanded((current) => {
        const next = new Set(current);
        if (isOpen) next.delete(code);
        else next.add(code);
        return next;
      });
      if (!isOpen && !storeRef.current.loaded.has(code) && status.get(code)?.state !== "loading") loadChildren(code);
    },
    [expanded, loadChildren, status],
  );

  const select = useCallback(
    (code: string, options: { openMobile?: boolean; scroll?: boolean } = {}) => {
      setSelectedCode(code);
      setFocusedCode(code);
      updateState({ sel: code });
      if (options.scroll) setScrollTarget({ code, nonce: Date.now() });
      if (options.openMobile ?? isMobile) setMobileDetailOpen(true);
    },
    [isMobile, updateState],
  );

  /** Abre una cuenta en el árbol (desde el esquema, la lista o la ruta de la ficha) desplegando su rama. */
  const openInTree = useCallback(
    (code: string) => {
      setSearchText("");
      setContextMenu(null);
      if (store.nodes.has(code) && !state.q) {
        setExpanded((current) => new Set([...current, ...ancestorsInStore(store, code), code]));
        if (!store.loaded.has(code) && (store.nodes.get(code)?.childCount ?? 0) > 0) loadChildren(code);
        updateState({ view: "tree" });
        select(code, { scroll: true, openMobile: false });
        return;
      }
      pendingSelectionRef.current = code;
      setReveal(code);
      updateState({ view: "tree", q: "", sel: code });
    },
    [loadChildren, select, state.q, store, updateState],
  );

  const setBlocked = useCallback(
    (code: string, blocked: boolean) => {
      setStore((current) => updateStoreNode(current, code, { isBlocked: blocked }));
      setListData((current) => (current ? { ...current, nodes: current.nodes.map((node) => (node.code === code ? { ...node, isBlocked: blocked } : node)) } : current));
      setRefreshKey((value) => value + 1);
    },
    [],
  );

  const toggleBlocked = useCallback(
    async (node: ChartNode) => {
      try {
        const response = await fetch(`/api/accounts/${node.id}/block`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ blocked: !node.isBlocked }),
        });
        if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar el bloqueo."));
        toast.success(node.isBlocked ? `Cuenta ${node.code} desbloqueada.` : `Cuenta ${node.code} bloqueada: no admite apuntes manuales nuevos.`);
        setBlocked(node.code, !node.isBlocked);
      } catch (error) {
        toast.error(errorMessage(error, "No se pudo cambiar el bloqueo."));
      }
    },
    [setBlocked],
  );

  const copyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Código ${code} copiado.`);
    } catch {
      toast.error("No se pudo copiar el código: selecciónalo y cópialo a mano.");
    }
  }, []);

  const newChildHref = useCallback((node: ChartNode) => `/accounting/accounts/new?parent=${node.isPostable ? node.parentCode ?? "" : node.code}`, []);

  const runCommand = useCallback(
    (command: ContextMenuCommand, node: ChartNode) => {
      if (command === "open") select(node.code);
      else if (command === "ledger") router.push(ledgerHref(node.id, range));
      else if (command === "newChild") router.push(newChildHref(node));
      else if (command === "edit") router.push(`/accounting/accounts/${node.id}/edit`);
      else if (command === "toggleBlocked") void toggleBlocked(node);
      else void copyCode(node.code);
    },
    [copyCode, newChildHref, range, router, select, toggleBlocked],
  );

  const handleTreeAction = useCallback(
    (action: TreeKeyAction, position?: { x: number; y: number }) => {
      const node = "code" in action ? store.nodes.get(action.code) : undefined;
      switch (action.type) {
        case "expand":
          if (!expanded.has(action.code)) toggle(action.code);
          else if (status.get(action.code)?.state === "error") loadChildren(action.code);
          return;
        case "collapse":
          if (expanded.has(action.code)) toggle(action.code);
          return;
        case "expandSiblings":
          setExpanded((current) => new Set([...current, ...action.codes]));
          for (const code of action.codes) if (!store.loaded.has(code)) loadChildren(code);
          return;
        case "open":
          select(action.code);
          return;
        case "ledger":
          if (node?.isPostable) router.push(ledgerHref(node.id, range));
          else toast.info("Las cuentas de grupo no tienen mayor propio: abre una de sus subcuentas.");
          return;
        case "newChild":
          if (!canManage) toast.info("Tu rol no permite crear cuentas.");
          else if (node) router.push(newChildHref(node));
          return;
        case "menu":
          setContextMenu({ code: action.code, x: position?.x ?? 120, y: position?.y ?? 120 });
          return;
        case "search":
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        default:
          return;
      }
    },
    [canManage, expanded, loadChildren, newChildHref, range, router, select, status, store, toggle],
  );

  const goToMatch = (direction: 1 | -1) => {
    const code = nextMatchCode(matchCodes, selectedCode, direction);
    if (!code) return;
    setExpanded((current) => new Set([...current, ...ancestorsInStore(store, code)]));
    select(code, { scroll: true, openMobile: false });
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (searchText.trim() !== state.q.trim()) {
        setState((current) => ({ ...current, q: searchText.trim(), sel: null }));
        setReveal(null);
      } else goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && searchText) {
      event.preventDefault();
      event.stopPropagation();
      setSearchText("");
    } else if (event.key === "ArrowDown" && rows.length > 0) {
      event.preventDefault();
      const target = selectedCode ?? rows.find((row) => row.kind === "node")?.key ?? null;
      if (target) {
        setFocusedCode(target);
        document.querySelector<HTMLElement>(`[data-testid='account-tree'] [data-row-key='${target}']`)?.focus();
      }
    }
  };

  const setLevel = (level: ChartLevel) => {
    setSearchText("");
    pendingSelectionRef.current = selectedCode;
    setReveal(selectedCode);
    updateState({ level, q: "" });
  };

  const setFilter = (key: ChartFilterKey, value: boolean) => {
    pendingSelectionRef.current = selectedCode;
    updateState({ filters: { ...state.filters, [key]: value } });
  };

  const clearFilters = () => {
    setSearchText("");
    updateState({ filters: NO_CHART_FILTERS, q: "" });
  };

  const changeYear = (id: string) => {
    const year = years.find((entry) => entry.id === id);
    pendingSelectionRef.current = selectedCode;
    updateState({ fy: id, from: year?.from ?? null, to: year?.to ?? null });
    setRefreshKey((value) => value + 1);
  };

  const changePeriod = (key: string) => {
    const period = activeYear?.periods.find((entry) => entry.key === key);
    if (!period) return;
    pendingSelectionRef.current = selectedCode;
    updateState({ fy: activeYear?.id ?? state.fy, from: period.from, to: period.to });
    setRefreshKey((value) => value + 1);
  };

  const exportUrl = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(periodParams);
    params.set("level", state.level);
    params.set("format", format);
    return `/api/accounts/export?${params.toString()}`;
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const move = (moveEvent: PointerEvent) => setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + startX - moveEvent.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const panelStyle: Record<string, string> = { "--panel-width": `${panelWidth}px` };
  const contextNode = contextMenu ? store.nodes.get(contextMenu.code) ?? null : null;
  const filtersActive = hasActiveFilters(state.filters);
  const statusMessage = treeLoading
    ? "Cargando el plan contable…"
    : state.q && state.view === "tree"
      ? matchCodes.length === 0
        ? "Sin coincidencias."
        : `${matchCodes.length}${truncated ? "+" : ""} ${matchCodes.length === 1 ? "coincidencia" : "coincidencias"}${selectedCode && matchSet.has(selectedCode) ? ` · ${matchCodes.indexOf(selectedCode) + 1} de ${matchCodes.length}` : ""}`
      : "";

  const detail = selectedNode ? (
    <AccountDetailPanel
      accountId={selectedNode.id}
      canManage={canManage}
      currency={currency}
      headingId={detailHeadingId}
      key={selectedNode.id}
      onBlockedChange={setBlocked}
      onSelectCode={openInTree}
      query={periodQuery}
      refreshKey={refreshKey}
    />
  ) : null;

  return (
    <div className="space-y-2" data-testid="chart-of-accounts">
      <section aria-label="Opciones del plan contable" className="space-y-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-2">
        <div className="flex flex-wrap items-end gap-2">
          <div aria-label="Vista" className="flex" role="group">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  aria-pressed={state.view === option.value}
                  className={cn("-ml-px first:ml-0", state.view === option.value && "bg-window-highlight shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-highlight)]")}
                  key={option.value}
                  onClick={() => updateState({ view: option.value })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icon aria-hidden="true" />
                  {option.label}
                </Button>
              );
            })}
          </div>
          {years.length > 0 ? (
            <>
              <div className="space-y-0.5">
                <Label htmlFor={`${searchId}-year`}>Ejercicio</Label>
                <Select className="h-7 w-32" id={`${searchId}-year`} onChange={(event) => changeYear(event.target.value)} value={activeYear?.id ?? ""}>
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>{year.code}{year.isClosed ? " (cerrado)" : ""}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-0.5">
                <Label htmlFor={`${searchId}-period`}>Periodo</Label>
                <Select className="h-7 w-44" id={`${searchId}-period`} onChange={(event) => changePeriod(event.target.value)} value={periodKey}>
                  {periodKey === "custom" ? <option value="custom">Del {range.from} al {range.to}</option> : null}
                  {activeYear?.periods.map((period) => (
                    <option key={period.key} value={period.key}>{period.label}</option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}
          <div aria-label="Desplegar hasta el nivel" className="flex items-center gap-1" role="group">
            <span aria-hidden="true" className="font-mono text-xs font-bold">Nivel</span>
            {CHART_LEVELS.map((level) => (
              <Button
                aria-label={level === "sub" ? "Desplegar hasta las subcuentas" : `Desplegar hasta el nivel ${level}`}
                aria-pressed={state.level === level && !state.q}
                className={cn("min-w-7 px-1.5", state.level === level && !state.q && "bg-window-highlight shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-highlight)]")}
                key={level}
                onClick={() => setLevel(level)}
                size="sm"
                title={level === "sub" ? "Todas las subcuentas" : `Cuentas de hasta ${level} dígitos`}
                type="button"
                variant="outline"
              >
                {LEVEL_LABELS[level]}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <DropdownMenu label="Exportar el plan contable" trigger={<><DownloadSimple aria-hidden="true" />Exportar</>} triggerVariant="outline">
              <DropdownMenuItem onClick={() => window.location.assign(exportUrl("xlsx"))}>Excel (XLSX) · nivel {LEVEL_LABELS[state.level]}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.location.assign(exportUrl("csv"))}>CSV · nivel {LEVEL_LABELS[state.level]}</DropdownMenuItem>
            </DropdownMenu>
            {canManage ? (
              <Link className={buttonVariants({ size: "sm" })} href={selectedNode && selectedNode.code.length >= 3 ? newChildHref(selectedNode) : "/accounting/accounts/new"}>
                <Plus aria-hidden="true" />
                Nueva cuenta
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-64 flex-1 items-center gap-1 sm:max-w-md">
            <Label className="sr-only" htmlFor={searchId}>Buscar en el plan contable</Label>
            <div className="relative flex-1">
              <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-describedby={`${searchId}-hint`}
                autoComplete="off"
                className="h-7 pl-7 pr-7 pointer-coarse:pr-10"
                id={searchId}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Buscar código, 43.1, nombre o NIF  ( / )"
                ref={searchRef}
                type="search"
                value={searchText}
              />
              {searchText ? (
                <button aria-label="Borrar la búsqueda" className="absolute right-0.5 top-1/2 inline-flex size-6 -translate-y-1/2 pointer-coarse:size-9 items-center justify-center hover:bg-window-highlight" onClick={() => setSearchText("")} type="button">
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>
            {state.q && matchCodes.length > 1 && state.view === "tree" ? (
              <>
                <Button aria-label="Coincidencia anterior" onClick={() => goToMatch(-1)} size="icon-sm" type="button" variant="outline"><CaretUp aria-hidden="true" /></Button>
                <Button aria-label="Coincidencia siguiente" onClick={() => goToMatch(1)} size="icon-sm" type="button" variant="outline"><CaretDown aria-hidden="true" /></Button>
              </>
            ) : null}
          </div>
          <p className="sr-only" id={`${searchId}-hint`}>Intro va a la siguiente coincidencia y Mayús+Intro a la anterior. El atajo 43.1 busca la subcuenta 43000001.</p>
          <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <legend className="sr-only">Filtros</legend>
            {CHART_FILTER_KEYS.map((key) => (
              <label className="flex items-center gap-1 font-mono text-xs" key={key}>
                <input checked={state.filters[key]} onChange={(event) => setFilter(key, event.target.checked)} type="checkbox" />
                {CHART_FILTER_LABELS[key]}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-1 font-mono text-xs">
            <input checked={state.density === "comfortable"} onChange={(event) => updateState({ density: event.target.checked ? "comfortable" : "compact" })} type="checkbox" />
            Filas amplias
          </label>
          <p aria-live="polite" className="font-mono text-xs text-muted-foreground" role="status">{statusMessage}</p>
        </div>
      </section>

      {treeError?.key === treeKey ? (
        <InlineAlert tone="danger">
          <p>{treeError.message}</p>
          <Button className="mt-1" onClick={() => setTreeRetry((value) => value + 1)} size="sm" type="button" variant="outline">Reintentar</Button>
        </InlineAlert>
      ) : null}
      {truncated && state.q ? <InlineAlert tone="info">Se muestran las {matchCodes.length} primeras coincidencias: concreta más la búsqueda.</InlineAlert> : null}

      {state.view === "scheme" ? (
        schemeData?.error ? (
          <InlineAlert tone="danger">{schemeData.error}</InlineAlert>
        ) : (
          <ChartSchemeView currency={currency} loading={schemeData?.key !== schemeKey} nodes={schemeData?.nodes ?? []} onOpenInTree={openInTree} />
        )
      ) : state.view === "list" ? (
        listData?.error ? (
          <InlineAlert tone="danger">{listData.error}</InlineAlert>
        ) : listData?.key !== listKey && !listData ? (
          <p className="p-2 font-mono text-xs text-muted-foreground" role="status">Cargando las cuentas…</p>
        ) : (
          <ChartListView
            canManage={canManage}
            loading={listData?.key !== listKey}
            nodes={listData?.nodes ?? []}
            onCopyCode={copyCode}
            onOpen={openInTree}
            onToggleBlocked={toggleBlocked}
            range={range}
          />
        )
      ) : rootCount === 0 && !treeLoading ? (
        <EmptyState
          action={
            <Button onClick={clearFilters} size="sm" type="button" variant="outline">Quitar filtros</Button>
          }
          description={state.q ? `Ninguna cuenta coincide con «${state.q}»${filtersActive ? " con los filtros actuales" : ""}.` : "Ninguna cuenta cumple los filtros en este periodo."}
          title="Sin resultados"
        />
      ) : isMobile ? (
        <ChartMobileView
          matchCodes={matchSet}
          onNavigate={(code) => {
            setMobileParent(code);
            if (code && !store.loaded.has(code) && status.get(code)?.state !== "loading") loadChildren(code);
          }}
          onOpen={(code) => select(code, { openMobile: true })}
          onRetry={loadChildren}
          parentCode={mobileParent}
          query={state.q}
          status={status}
          store={store}
        />
      ) : (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start" style={panelStyle}>
          <div aria-busy={treeLoading || undefined} className={cn("min-w-0 flex-1", treeLoading && "opacity-70")}>
            <p className="sr-only" id={helpId}>
              Flechas arriba y abajo para moverse, derecha despliega, izquierda pliega o sube al padre, asterisco despliega los hermanos, Intro abre la ficha, Control+Intro abre el mayor, barra busca, n crea una subcuenta y Mayúsculas+F10 abre el menú de la cuenta.
            </p>
            <AccountTree
              describedBy={helpId}
              exactCodeMatch={exactCodeMatch}
              focusedCode={focusedCode}
              label="Plan contable"
              matchCodes={matchSet}
              onAction={handleTreeAction}
              onFocusCode={setFocusedCode}
              onRetry={loadChildren}
              onToggle={toggle}
              query={state.q}
              rowHeight={rowHeight}
              rows={rows}
              scrollTarget={scrollTarget}
              selectedCode={selectedCode}
            />
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Periodo del {range.from} al {range.to}. Saldo = saldo inicial + debe − haber · D deudor · A acreedor · · sin importe.
            </p>
          </div>
          <div
            aria-label="Ancho de la ficha"
            aria-orientation="vertical"
            aria-valuemax={PANEL_MAX}
            aria-valuemin={PANEL_MIN}
            aria-valuenow={panelWidth}
            className="hidden w-1.5 cursor-col-resize self-stretch border-x border-window-shadow bg-window-panel hover:bg-window-highlight focus-visible:outline-2 focus-visible:outline-focus-accent lg:block"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const step = event.key === "ArrowLeft" ? 20 : -20;
                setPanelWidth((width) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, width + step)));
              }
            }}
            onPointerDown={startResize}
            role="separator"
            tabIndex={0}
          />
          <aside
            aria-labelledby={selectedNode ? detailHeadingId : undefined}
            aria-label={selectedNode ? undefined : "Ficha de la cuenta"}
            className="w-full shrink-0 rounded-[2px] border border-window-dark-shadow bg-window-surface lg:sticky lg:top-2 lg:max-h-[calc(100dvh-1rem)] lg:w-[var(--panel-width)] lg:overflow-y-auto"
          >
            {detail ?? (
              <p className="p-3 text-xs text-muted-foreground">Selecciona una cuenta para ver su ficha: sumas del periodo, evolución mensual y últimos apuntes.</p>
            )}
          </aside>
        </div>
      )}

      {isMobile && selectedNode ? (
        <Dialog className="h-dvh max-h-dvh max-w-none sm:h-auto" onClose={() => setMobileDetailOpen(false)} open={mobileDetailOpen} size="xl" title={`${selectedNode.code} · ${selectedNode.name}`}>
          {detail}
        </Dialog>
      ) : null}

      {contextMenu && contextNode ? (
        <AccountContextMenu
          canManage={canManage}
          node={contextNode}
          onClose={() => {
            setContextMenu(null);
            document.querySelector<HTMLElement>(`[data-testid='account-tree'] [data-row-key='${contextNode.code}']`)?.focus();
          }}
          onCommand={runCommand}
          position={{ x: contextMenu.x, y: contextMenu.y }}
        />
      ) : null}
    </div>
  );
}
