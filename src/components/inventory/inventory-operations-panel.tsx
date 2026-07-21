"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";

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

type Props = {
  items: InventoryItemOption[];
  warehouses: InventoryWarehouseOption[];
  stock: StockSnapshotRow[];
  alerts: StockSnapshotRow[];
  movements: StockMovementHistoryRow[];
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

function nowForDateTimeInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatQuantity(value: string) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(Number(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function InventoryOperationsPanel({
  items,
  warehouses,
  stock,
  alerts,
  movements,
  initialItemId = "all",
  initialWarehouseId = "all",
  initialMovementItemId,
  initialMovementWarehouseId,
  redirectAfterSubmit,
  showMovementForm = true,
  showOverview = true,
}: Props) {
  const router = useRouter();
  const [movementType, setMovementType] = useState<keyof typeof movementLabels>("ADJUSTMENT");
  const [itemId, setItemId] = useState(items.some((item) => item.id === initialMovementItemId) ? initialMovementItemId ?? "" : items[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses.some((warehouse) => warehouse.id === initialMovementWarehouseId) ? initialMovementWarehouseId ?? "" : warehouses[0]?.id ?? "");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(warehouses[1]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [movedAt, setMovedAt] = useState(nowForDateTimeInput());
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [historyItemFilter, setHistoryItemFilter] = useState(initialItemId);
  const [historyWarehouseFilter, setHistoryWarehouseFilter] = useState(initialWarehouseId);
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredMovements = useMemo(() => {
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
  }, [historyItemFilter, historySearch, historyTypeFilter, historyWarehouseFilter, movements]);

  async function submitMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/stock-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          itemId,
          warehouseId,
          destinationWarehouseId: movementType === "TRANSFER" ? destinationWarehouseId : undefined,
          movementType,
          quantity,
          movedAt,
          reason,
          reference,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "No se pudo registrar el movimiento.");

      setStatusMessage("Movimiento de stock registrado. Datos actualizados.");
      setErrorMessage(null);
      setReason("");
      setReference("");
      toast.success("Movimiento de stock registrado.");
      if (redirectAfterSubmit) router.push(redirectAfterSubmit);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

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
        <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitMovement}>
          <label className="space-y-1 font-mono text-xs font-bold">
            Tipo de operación
            <Select value={movementType} onChange={(event) => setMovementType(event.target.value as keyof typeof movementLabels)} required>
              <option value="IN">Recepción</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Producto
            <Select value={itemId} onChange={(event) => setItemId(event.target.value)} required disabled={items.length === 0}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Almacén / ubicación origen
            <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required disabled={warehouses.length === 0}>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </Select>
          </label>
          {movementType === "TRANSFER" ? (
            <label className="space-y-1 font-mono text-xs font-bold">
              Almacén destino
              <Select value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)} required>
                <option value="">Selecciona destino</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="space-y-1 font-mono text-xs font-bold">
            Cantidad
            <Input type="number" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Fecha
            <Input type="datetime-local" value={movedAt} onChange={(event) => setMovedAt(event.target.value)} required />
          </label>
          <label className="space-y-1 font-mono text-xs font-bold md:col-span-2">
            Motivo
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. conteo físico, recepción proveedor, traspaso entre almacenes" required />
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Referencia
            <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Albarán, lote, ticket..." required />
          </label>
          <div className="flex flex-col justify-end gap-1 md:col-span-2 xl:col-span-3">
            <Button type="submit" disabled={isSubmitting || items.length === 0 || warehouses.length === 0}>
              {isSubmitting ? "Registrando..." : "Registrar movimiento"}
            </Button>
            <div className="min-h-4 font-mono text-xs" aria-live="polite">
              {statusMessage ? <p className="text-emerald-600">{statusMessage}</p> : null}
              {errorMessage ? <p className="text-destructive">{errorMessage}</p> : null}
              {items.length === 0 || warehouses.length === 0 ? <p className="text-muted-foreground">Crea al menos un producto y un almacén antes de mover stock.</p> : null}
            </div>
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
          {stock.length === 0 ? <p className="text-sm text-muted-foreground">No hay datos de stock.</p> : stock.map((row) => (
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
                    No hay datos de stock.
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
          <label className="space-y-1 font-mono text-xs font-bold">
            Producto
            <Select value={historyItemFilter} onChange={(event) => setHistoryItemFilter(event.target.value)}>
              <option value="all">Todos</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Almacén
            <Select value={historyWarehouseFilter} onChange={(event) => setHistoryWarehouseFilter(event.target.value)}>
              <option value="all">Todos</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Tipo
            <Select value={historyTypeFilter} onChange={(event) => setHistoryTypeFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="IN">Recepción</option>
              <option value="OUT">Salida</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </label>
          <label className="space-y-1 font-mono text-xs font-bold">
            Buscar
            <Input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Motivo o referencia" />
          </label>
        </div>
        <div className="mt-2 grid gap-1.5 md:hidden">
          {filteredMovements.length === 0 ? <p className="text-sm text-muted-foreground">No hay movimientos para los filtros seleccionados.</p> : filteredMovements.map((movement) => (
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
        <div className="mt-2 hidden overflow-x-auto border border-window-dark-shadow md:block">
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
      </section>
      </> : null}
    </div>
  );
}
