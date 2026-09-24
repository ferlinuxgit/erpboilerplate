"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isSearchOnlyChange } from "@/components/ui/resource-list";
import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage as describeError, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDateTime, parseDecimalInput } from "@/lib/format";
import { buildListSearch, DEFAULT_LIST_PAGE_SIZE, LIST_PARAM } from "@/lib/list-params";

export type InventoryItemOption = {
  id: string;
  sku: string;
  name: string;
  minimumStock: string;
};

export type InventoryWarehouseOption = {
  id: string;
  code: string;
  name: string;
};

export type StockSnapshotRow = {
  itemId: string;
  itemName: string;
  itemSku: string;
  warehouseId: string | null;
  warehouseName: string | null;
  warehouseCode: string | null;
  minimumStock: string;
  quantity: string;
};

export type StockMovementHistoryRow = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: string;
  movedAt: string;
  reason: string;
  reference: string | null;
};

/**
 * Server-paginated history: `movements` is then only the current page, already filtered by
 * the server from `?q=&page=&type=&itemId=&warehouseId=`, which the filters below write.
 */
export type StockMovementHistoryServerState = {
  /** Movements matching the filters (all pages). */
  total: number;
  /** Movements without filters. */
  unfilteredTotal: number;
  page: number;
  pageSize: number;
  q: string;
  filters: { type: string | null; itemId: string | null; warehouseId: string | null };
};

const HISTORY_FILTER_KEYS = ["itemId", "warehouseId", "type"] as const;
const HISTORY_SEARCH_DEBOUNCE_MS = 300;

function historySearchFor(state: { q: string; page: number; pageSize: number; itemId: string; warehouseId: string; type: string }) {
  const value = (selected: string) => (selected === "all" ? null : selected);
  return buildListSearch(
    "",
    {
      q: state.q,
      page: state.page,
      pageSize: state.pageSize,
      defaultPageSize: DEFAULT_LIST_PAGE_SIZE,
      filters: { itemId: value(state.itemId), warehouseId: value(state.warehouseId), type: value(state.type) },
    },
    HISTORY_FILTER_KEYS,
  );
}

type Props = {
  items: InventoryItemOption[];
  warehouses: InventoryWarehouseOption[];
  stock: StockSnapshotRow[];
  alerts: StockSnapshotRow[];
  movements: StockMovementHistoryRow[];
  /** Server mode for the movement history (see `StockMovementHistoryServerState`). */
  movementHistory?: StockMovementHistoryServerState;
  initialItemId?: string;
  initialWarehouseId?: string;
  initialMovementItemId?: string;
  initialMovementWarehouseId?: string;
  redirectAfterSubmit?: string;
  showMovementForm?: boolean;
  showOverview?: boolean;
};

const movementLabels = {
  IN: "Recepción",
  OUT: "Salida",
  ADJUSTMENT: "Ajuste / conteo",
  TRANSFER: "Transferencia",
} as const;

const movementHelp: Record<keyof typeof movementLabels, string> = {
  IN: "Entrada de mercancía en el almacén (por ejemplo, compra a proveedor).",
  OUT: "Salida de mercancía del almacén.",
  ADJUSTMENT: "Corrige el stock tras un conteo físico o una incidencia.",
  TRANSFER: "Mueve mercancía de un almacén a otro.",
};

type MovementFieldErrors = Partial<Record<"itemId" | "warehouseId" | "destinationWarehouseId" | "quantity" | "movedAt" | "reason" | "reference", string>>;

function nowForDateTimeInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatQuantity(value: string) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(Number(value));
}

function formatDate(value: string) {
  return formatDateTime(value);
}

export function InventoryOperationsPanel({
  items,
  warehouses,
  stock,
  alerts,
  movements,
  movementHistory,
  initialItemId = "all",
  initialWarehouseId = "all",
  initialMovementItemId,
  initialMovementWarehouseId,
  redirectAfterSubmit,
  showMovementForm = true,
  showOverview = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isHistoryNavigating, startHistoryNavigation] = useTransition();
  const isServerHistory = Boolean(movementHistory);
  const [movementType, setMovementType] = useState<keyof typeof movementLabels>("ADJUSTMENT");
  const [itemId, setItemId] = useState(items.some((item) => item.id === initialMovementItemId) ? initialMovementItemId ?? "" : items[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses.some((warehouse) => warehouse.id === initialMovementWarehouseId) ? initialMovementWarehouseId ?? "" : warehouses[0]?.id ?? "");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(warehouses[1]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [movedAt, setMovedAt] = useState(nowForDateTimeInput());
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [historyItemFilter, setHistoryItemFilter] = useState(movementHistory ? movementHistory.filters.itemId ?? "all" : initialItemId);
  const [historyWarehouseFilter, setHistoryWarehouseFilter] = useState(
    movementHistory ? movementHistory.filters.warehouseId ?? "all" : initialWarehouseId,
  );
  const [historyTypeFilter, setHistoryTypeFilter] = useState(movementHistory?.filters.type ?? "all");
  const [historySearch, setHistorySearch] = useState(movementHistory?.q ?? "");
  const [historyPage, setHistoryPage] = useState(movementHistory?.page ?? 1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<MovementFieldErrors>({});

  // Server mode: write the history filters to the URL (search debounced) and let the page re-render.
  const historyPageSize = movementHistory?.pageSize ?? DEFAULT_LIST_PAGE_SIZE;
  const historyUrlSearch = isServerHistory
    ? historySearchFor({
        q: historySearch,
        page: historyPage,
        pageSize: historyPageSize,
        itemId: historyItemFilter,
        warehouseId: historyWarehouseFilter,
        type: historyTypeFilter,
      })
    : "";
  const lastHistorySearchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isServerHistory) return;
    const managedKeys = new Set<string>([...Object.values(LIST_PARAM), ...HISTORY_FILTER_KEYS]);
    const current = new URLSearchParams(window.location.search);
    const managedCurrent = new URLSearchParams([...current].filter(([key]) => managedKeys.has(key)));
    managedCurrent.sort();
    if (managedCurrent.toString() === historyUrlSearch) {
      lastHistorySearchRef.current = historyUrlSearch;
      return;
    }
    const onlyQueryChanged = isSearchOnlyChange(lastHistorySearchRef.current ?? managedCurrent.toString(), historyUrlSearch);
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams([...current].filter(([key]) => !managedKeys.has(key)));
      for (const [key, value] of new URLSearchParams(historyUrlSearch)) next.set(key, value);
      const query = next.toString();
      lastHistorySearchRef.current = historyUrlSearch;
      startHistoryNavigation(() => {
        router.replace(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, { scroll: false });
      });
    }, onlyQueryChanged ? HISTORY_SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [historyUrlSearch, isServerHistory, pathname, router]);

  // Server mode: adopt URL changes made elsewhere (links, back/forward, page clamped by the server).
  const historyStateKey = movementHistory ? JSON.stringify(movementHistory) : "";
  useEffect(() => {
    if (!movementHistory || isHistoryNavigating) return;
    const received = historySearchFor({
      q: movementHistory.q,
      page: movementHistory.page,
      pageSize: movementHistory.pageSize,
      itemId: movementHistory.filters.itemId ?? "all",
      warehouseId: movementHistory.filters.warehouseId ?? "all",
      type: movementHistory.filters.type ?? "all",
    });
    if (received === lastHistorySearchRef.current) return;
    const timer = window.setTimeout(() => {
      lastHistorySearchRef.current = received;
      setHistoryPage(movementHistory.page);
      setHistoryItemFilter(movementHistory.filters.itemId ?? "all");
      setHistoryWarehouseFilter(movementHistory.filters.warehouseId ?? "all");
      setHistoryTypeFilter(movementHistory.filters.type ?? "all");
      setHistorySearch((current) => (current.trim() === movementHistory.q ? current : movementHistory.q));
    }, 0);
    return () => window.clearTimeout(timer);
    // `historyStateKey` captures every field of `movementHistory`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyStateKey, isHistoryNavigating]);

  const historyPageCount = movementHistory ? Math.max(1, Math.ceil(movementHistory.total / movementHistory.pageSize)) : 1;

  const filteredMovements = useMemo(() => {
    if (isServerHistory) return movements;
    const query = historySearch.trim().toLowerCase();
    return movements.filter((movement) => {
      const matchesItem = historyItemFilter === "all" || movement.itemId === historyItemFilter;
      const matchesWarehouse = historyWarehouseFilter === "all" || movement.warehouseId === historyWarehouseFilter;
      const matchesType = historyTypeFilter === "all" || movement.movementType === historyTypeFilter;
      const matchesSearch =
        !query ||
        movement.reason.toLowerCase().includes(query) ||
        movement.reference?.toLowerCase().includes(query) ||
        movement.itemName.toLowerCase().includes(query) ||
        movement.warehouseName.toLowerCase().includes(query);
      return matchesItem && matchesWarehouse && matchesType && matchesSearch;
    });
  }, [historyItemFilter, historySearch, historyTypeFilter, historyWarehouseFilter, isServerHistory, movements]);

  function validateMovement() {
    const next: MovementFieldErrors = {};
    const parsedQuantity = parseDecimalInput(quantity);
    if (!itemId) next.itemId = "Selecciona el producto.";
    if (!warehouseId) next.warehouseId = "Selecciona el almacén de origen.";
    if (movementType === "TRANSFER") {
      if (!destinationWarehouseId) next.destinationWarehouseId = "Selecciona el almacén de destino.";
      else if (destinationWarehouseId === warehouseId) next.destinationWarehouseId = "El destino debe ser distinto del origen.";
    }
    if (parsedQuantity === null) next.quantity = "Introduce una cantidad válida, por ejemplo 7,5.";
    else if (parsedQuantity === 0) next.quantity = "La cantidad no puede ser cero.";
    if (!movedAt) next.movedAt = "Indica la fecha y hora del movimiento.";
    if (!reason.trim()) next.reason = "Explica brevemente el motivo (por ejemplo, conteo físico).";
    if (!reference.trim()) next.reference = "Indica una referencia (albarán, lote o ticket).";
    setFieldErrors(next);
    return Object.keys(next).length === 0 ? parsedQuantity : null;
  }

  async function submitMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    const parsedQuantity = validateMovement();
    if (parsedQuantity === null) {
      toast.error("Revisa los campos marcados antes de registrar el movimiento.");
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/stock-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          itemId,
          warehouseId,
          destinationWarehouseId: movementType === "TRANSFER" ? destinationWarehouseId : undefined,
          movementType,
          quantity: String(parsedQuantity),
          movedAt,
          reason,
          reference,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el movimiento."));

      setStatusMessage("Movimiento de stock registrado. Datos actualizados.");
      setErrorMessage(null);
      setReason("");
      setReference("");
      toast.success(`Movimiento registrado: ${movementLabels[movementType].toLocaleLowerCase("es-ES")}.`);
      if (redirectAfterSubmit) router.push(redirectAfterSubmit);
      router.refresh();
    } catch (error) {
      const message = describeError(error, "No se pudo registrar el movimiento.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const missingMasters = items.length === 0 || warehouses.length === 0;

  return (
    <div className="space-y-2">
      {showMovementForm ? (
      <section className="border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]" aria-labelledby="inventory-actions-title">
        <div className="mb-2 space-y-0.5 border-b border-window-shadow pb-1.5">
          <h2 id="inventory-actions-title" className="font-mono text-sm font-bold">
            Operaciones de stock
          </h2>
          <p className="text-xs text-muted-foreground">Registra recepciones, ajustes/conteos y transferencias con trazabilidad.</p>
        </div>
        <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" noValidate onSubmit={submitMovement}>
          <RequiredFieldsNote className="md:col-span-2 xl:col-span-3" />
          <AccessibleField helperText={movementHelp[movementType]} id="stock-movement-type" label="Tipo de operación" required>
            <Select id="stock-movement-type" autoFocus value={movementType} onChange={(event) => setMovementType(event.target.value as keyof typeof movementLabels)} required>
              <option value="IN">Recepción</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </AccessibleField>
          <AccessibleField error={fieldErrors.itemId} id="stock-movement-item" label="Producto" required>
            <Select id="stock-movement-item" value={itemId} onChange={(event) => setItemId(event.target.value)} required disabled={items.length === 0}>
              {items.length === 0 ? <option value="">Sin productos</option> : null}
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </AccessibleField>
          <AccessibleField error={fieldErrors.warehouseId} id="stock-movement-warehouse" label="Almacén / ubicación origen" required>
            <Select id="stock-movement-warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required disabled={warehouses.length === 0}>
              {warehouses.length === 0 ? <option value="">Sin almacenes</option> : null}
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </Select>
          </AccessibleField>
          {movementType === "TRANSFER" ? (
            <AccessibleField error={fieldErrors.destinationWarehouseId} id="stock-movement-destination" label="Almacén destino" required>
              <Select id="stock-movement-destination" value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)} required>
                <option value="">Selecciona destino</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </option>
                ))}
              </Select>
            </AccessibleField>
          ) : null}
          <AccessibleField
            error={fieldErrors.quantity}
            helperText={movementType === "ADJUSTMENT" ? "Usa un número negativo para restar stock (por ejemplo, -2)." : "Admite hasta 3 decimales, por ejemplo 7,5."}
            id="stock-movement-quantity"
            label="Cantidad"
            required
          >
            <QuantityInput id="stock-movement-quantity" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </AccessibleField>
          <AccessibleField error={fieldErrors.movedAt} id="stock-movement-date" label="Fecha" required>
            <Input id="stock-movement-date" type="datetime-local" value={movedAt} onChange={(event) => setMovedAt(event.target.value)} required />
          </AccessibleField>
          <AccessibleField className="md:col-span-2" error={fieldErrors.reason} id="stock-movement-reason" label="Motivo" required>
            <Textarea id="stock-movement-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. conteo físico, recepción proveedor, traspaso entre almacenes" required />
          </AccessibleField>
          <AccessibleField error={fieldErrors.reference} helperText="Sirve para localizar el movimiento en el historial." id="stock-movement-reference" label="Referencia" required>
            <Input id="stock-movement-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Albarán, lote, ticket..." required />
          </AccessibleField>
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            {missingMasters ? (
              <p className="border border-dashed border-window-dark-shadow bg-window-panel p-2 text-xs text-muted-foreground">
                Crea al menos un producto y un almacén antes de mover stock:{" "}
                <Link className="font-bold text-primary underline" href="/inventory/items/new">nuevo artículo</Link>
                {" · "}
                <Link className="font-bold text-primary underline" href="/inventory/warehouses/new">nuevo almacén</Link>.
              </p>
            ) : null}
            <FormErrorMessage>{errorMessage}</FormErrorMessage>
            {statusMessage ? <p className="font-mono text-xs text-success" aria-live="polite">{statusMessage}</p> : null}
            <FormActions>
              <SubmitButton aria-keyshortcuts="Control+Enter Meta+Enter" disabled={missingMasters} pending={isSubmitting} pendingLabel="Registrando…">
                Registrar movimiento
              </SubmitButton>
            </FormActions>
          </div>
        </form>
      </section>
      ) : null}

      {showOverview ? <>
      <section className="border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]" aria-labelledby="stock-alerts-title">
        <h2 id="stock-alerts-title" className="font-mono text-sm font-bold">
          Alertas de stock mínimo
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No hay alertas activas.</p>
        ) : (
          <div className="mt-2 grid gap-1.5 md:grid-cols-2">
            {alerts.map((row) => (
              <a
                key={`alert-${row.itemId}-${row.warehouseId ?? "sin-almacen"}`}
                className="border border-window-shadow p-2 text-xs hover:bg-window-highlight"
                href={`#stock-${row.itemId}-${row.warehouseId ?? "sin-almacen"}`}
                onClick={() => {
                  setHistoryItemFilter(row.itemId);
                  setHistoryWarehouseFilter(row.warehouseId ?? "all");
                  setHistoryPage(1);
                }}
              >
                <span className="font-medium">{row.itemSku} · {row.itemName}</span>
                <span className="block text-muted-foreground">
                  {row.warehouseName ?? "Sin almacén"}: {formatQuantity(row.quantity)} / mínimo {formatQuantity(row.minimumStock)}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]" aria-labelledby="stock-snapshot-title">
        <h2 id="stock-snapshot-title" className="font-mono text-sm font-bold">
          Stock por producto y almacén
        </h2>
        <div className="mt-2 grid gap-1.5 md:hidden">
          {stock.length === 0 ? <p className="text-xs text-muted-foreground">No hay datos de stock. Registra un movimiento para empezar.</p> : stock.map((row) => (
            <article className="border border-window-dark-shadow bg-background p-2" id={`stock-mobile-${row.itemId}-${row.warehouseId ?? "sin-almacen"}`} key={`${row.itemId}-${row.warehouseId ?? "sin-almacen"}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{row.itemName}</p><p className="text-xs text-muted-foreground">{row.itemSku} · {row.warehouseName ?? "Sin almacén"}</p></div>
                <p className="font-mono text-lg font-semibold">{formatQuantity(row.quantity)}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Stock mínimo: {formatQuantity(row.minimumStock)}</p>
            </article>
          ))}
        </div>
        <div className="mt-2 hidden overflow-x-auto border border-window-dark-shadow md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Almacén</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No hay datos de stock. Registra un movimiento para empezar.
                  </TableCell>
                </TableRow>
              ) : (
                stock.map((row) => (
                  <TableRow key={`${row.itemId}-${row.warehouseId ?? "sin-almacen"}`} id={`stock-${row.itemId}-${row.warehouseId ?? "sin-almacen"}`}>
                    <TableCell>
                      <span className="font-medium">{row.itemName}</span>
                      <span className="block text-xs text-muted-foreground">{row.itemSku}</span>
                    </TableCell>
                    <TableCell>{row.warehouseName ?? "Sin almacén"}</TableCell>
                    <TableCell className="text-right">{formatQuantity(row.quantity)}</TableCell>
                    <TableCell className="text-right">{formatQuantity(row.minimumStock)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="border border-window-dark-shadow bg-card p-2.5 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]" aria-labelledby="movement-history-title">
        <div className="space-y-0.5">
          <h2 id="movement-history-title" className="font-mono text-sm font-bold">
            Historial de movimientos
          </h2>
          <p className="text-xs text-muted-foreground">Filtra por producto, almacén, tipo o referencia/motivo.</p>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <AccessibleField id="stock-history-item" label="Producto">
            <Select id="stock-history-item" value={historyItemFilter} onChange={(event) => {
                setHistoryItemFilter(event.target.value);
                setHistoryPage(1);
              }}>
              <option value="all">Todos</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </AccessibleField>
          <AccessibleField id="stock-history-warehouse" label="Almacén">
            <Select id="stock-history-warehouse" value={historyWarehouseFilter} onChange={(event) => {
                setHistoryWarehouseFilter(event.target.value);
                setHistoryPage(1);
              }}>
              <option value="all">Todos</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </Select>
          </AccessibleField>
          <AccessibleField id="stock-history-type" label="Tipo">
            <Select id="stock-history-type" value={historyTypeFilter} onChange={(event) => {
                setHistoryTypeFilter(event.target.value);
                setHistoryPage(1);
              }}>
              <option value="all">Todos</option>
              <option value="IN">Recepción</option>
              <option value="OUT">Salida</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </AccessibleField>
          <AccessibleField id="stock-history-search" label="Buscar">
            <Input id="stock-history-search" type="search" value={historySearch} onChange={(event) => {
                setHistorySearch(event.target.value);
                setHistoryPage(1);
              }} placeholder="Motivo o referencia" />
          </AccessibleField>
        </div>
        <div aria-busy={isHistoryNavigating || undefined} className="mt-2 grid gap-1.5 md:hidden">
          {filteredMovements.length === 0 ? <p className="text-xs text-muted-foreground">No hay movimientos para los filtros seleccionados.</p> : filteredMovements.map((movement) => (
            <article className="border border-window-dark-shadow bg-background p-2" key={movement.id}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{movement.itemName}</p><p className="text-xs text-muted-foreground">{movement.itemSku} · {movement.warehouseName}</p></div>
                <p className="font-mono font-semibold">{formatQuantity(movement.quantity)}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{movementLabels[movement.movementType]}</span><time>{formatDate(movement.movedAt)}</time></div>
              <p className="mt-2 text-sm">{movement.reason}{movement.reference ? <span className="text-muted-foreground"> · Ref. {movement.reference}</span> : null}</p>
            </article>
          ))}
        </div>
        <div aria-busy={isHistoryNavigating || undefined} className="mt-2 hidden overflow-x-auto border border-window-dark-shadow md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Almacén</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Motivo / referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMovements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No hay movimientos para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                filteredMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>{formatDate(movement.movedAt)}</TableCell>
                    <TableCell>{movementLabels[movement.movementType]}</TableCell>
                    <TableCell>
                      {movement.itemName}
                      <span className="block text-xs text-muted-foreground">{movement.itemSku}</span>
                    </TableCell>
                    <TableCell>{movement.warehouseName}</TableCell>
                    <TableCell className="text-right">{formatQuantity(movement.quantity)}</TableCell>
                    <TableCell>
                      {movement.reason}
                      {movement.reference ? <span className="block text-xs text-muted-foreground">Ref. {movement.reference}</span> : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {movementHistory && movementHistory.total > 0 ? (
          <nav aria-label="Paginación del historial de movimientos" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p aria-live="polite">
              Página {movementHistory.page} de {historyPageCount} · {movementHistory.total}
              {movementHistory.total !== movementHistory.unfilteredTotal ? ` de ${movementHistory.unfilteredTotal}` : ""} movimientos
            </p>
            {historyPageCount > 1 ? (
              <div className="flex gap-2">
                <Button
                  disabled={movementHistory.page <= 1 || isHistoryNavigating}
                  onClick={() => setHistoryPage(movementHistory.page - 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Anterior
                </Button>
                <Button
                  disabled={movementHistory.page >= historyPageCount || isHistoryNavigating}
                  onClick={() => setHistoryPage(movementHistory.page + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Siguiente
                </Button>
              </div>
            ) : null}
          </nav>
        ) : null}
      </section>
      </> : null}
    </div>
  );
}
