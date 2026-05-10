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
}: Props) {
  const router = useRouter();
  const [movementType, setMovementType] = useState<keyof typeof movementLabels>("ADJUSTMENT");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
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
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4 shadow-sm" aria-labelledby="inventory-actions-title">
        <div className="mb-4 space-y-1">
          <h2 id="inventory-actions-title" className="text-lg font-semibold">
            Operaciones de stock
          </h2>
          <p className="text-sm text-muted-foreground">Registra recepciones, ajustes/conteos y transferencias con trazabilidad.</p>
        </div>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitMovement}>
          <label className="space-y-1 text-sm font-medium">
            Tipo de operación
            <Select value={movementType} onChange={(event) => setMovementType(event.target.value as keyof typeof movementLabels)} required>
              <option value="IN">Recepción</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Producto
            <Select value={itemId} onChange={(event) => setItemId(event.target.value)} required disabled={items.length === 0}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
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
            <label className="space-y-1 text-sm font-medium">
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
          <label className="space-y-1 text-sm font-medium">
            Cantidad
            <Input type="number" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Fecha
            <Input type="datetime-local" value={movedAt} onChange={(event) => setMovedAt(event.target.value)} required />
          </label>
          <label className="space-y-1 text-sm font-medium md:col-span-2">
            Motivo
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. conteo físico, recepción proveedor, traspaso entre almacenes" required />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Referencia
            <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Albarán, lote, ticket..." required />
          </label>
          <div className="flex flex-col justify-end gap-2 md:col-span-2 xl:col-span-3">
            <Button type="submit" disabled={isSubmitting || items.length === 0 || warehouses.length === 0}>
              {isSubmitting ? "Registrando..." : "Registrar movimiento"}
            </Button>
            <div className="min-h-5 text-sm" aria-live="polite">
              {statusMessage ? <p className="text-emerald-600">{statusMessage}</p> : null}
              {errorMessage ? <p className="text-destructive">{errorMessage}</p> : null}
              {items.length === 0 || warehouses.length === 0 ? <p className="text-muted-foreground">Crea al menos un producto y un almacén antes de mover stock.</p> : null}
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm" aria-labelledby="stock-alerts-title">
        <h2 id="stock-alerts-title" className="text-lg font-semibold">
          Alertas de stock mínimo
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No hay alertas activas.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {alerts.map((row) => (
              <a
                key={`alert-${row.itemId}-${row.warehouseId ?? "sin-almacen"}`}
                className="rounded-md border p-3 text-sm transition hover:bg-muted"
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

      <section className="rounded-lg border bg-card p-4 shadow-sm" aria-labelledby="stock-snapshot-title">
        <h2 id="stock-snapshot-title" className="text-lg font-semibold">
          Stock por producto y almacén
        </h2>
        <div className="mt-3 overflow-x-auto">
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

      <section className="rounded-lg border bg-card p-4 shadow-sm" aria-labelledby="movement-history-title">
        <div className="space-y-1">
          <h2 id="movement-history-title" className="text-lg font-semibold">
            Historial de movimientos
          </h2>
          <p className="text-sm text-muted-foreground">Filtra por producto, almacén, tipo o referencia/motivo.</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm font-medium">
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
          <label className="space-y-1 text-sm font-medium">
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
          <label className="space-y-1 text-sm font-medium">
            Tipo
            <Select value={historyTypeFilter} onChange={(event) => setHistoryTypeFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="IN">Recepción</option>
              <option value="OUT">Salida</option>
              <option value="ADJUSTMENT">Ajuste / conteo</option>
              <option value="TRANSFER">Transferencia</option>
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Buscar
            <Input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Motivo o referencia" />
          </label>
        </div>
        <div className="mt-4 overflow-x-auto">
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
    </div>
  );
}
