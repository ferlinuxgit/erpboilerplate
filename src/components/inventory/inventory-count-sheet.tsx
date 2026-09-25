"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { useLeaveWarning } from "@/components/expenses/use-leave-warning";
import { normalizeSearchText } from "@/lib/account-aliases";
import { getCsrfHeader } from "@/lib/csrf-client";
import { computeCountDifferences } from "@/lib/inventory-count";
import { cn } from "@/lib/utils";

type Warehouse = { id: string; code: string; name: string };
type Item = { id: string; sku: string; name: string };

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value);
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${formatQuantity(value)}`;
}

function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Hoja de recuento: eliges almacén, escribes lo que has contado y el sistema calcula las
 * diferencias. Al confirmar se registran todos los ajustes de una vez (auditado).
 * Los artículos que dejes en blanco no se tocan.
 */
export function InventoryCountSheet({ items, stock, warehouses }: { items: Item[]; stock: Record<string, Record<string, number>>; warehouses: Warehouse[] }) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [countedAt, setCountedAt] = useState(todayInput);
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const systemStock = useMemo(() => (warehouseId ? stock[warehouseId] ?? {} : {}), [stock, warehouseId]);
  const result = useMemo(
    () => computeCountDifferences(items.map((item) => ({ itemId: item.id, systemQuantity: systemStock[item.id] ?? 0, countedRaw: counts[item.id] ?? "" }))),
    [counts, items, systemStock],
  );
  useLeaveWarning(result.counted.length > 0 && !pending, "Tienes cantidades contadas sin registrar. Si sales se perderán.");
  const differenceByItem = new Map(result.counted.map((entry) => [entry.itemId, entry]));
  const query = normalizeSearchText(search);
  const visibleItems = items.filter((item) => {
    if (query && !normalizeSearchText(`${item.sku} ${item.name}`).includes(query)) return false;
    if (onlyDifferences) {
      const entry = differenceByItem.get(item.id);
      return Boolean(entry && entry.difference !== 0) || Boolean(result.errors[item.id]);
    }
    return true;
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const hasErrors = Object.keys(result.errors).length > 0;
  const warehouse = warehouses.find((candidate) => candidate.id === warehouseId);

  function changeWarehouse(nextId: string) {
    if (result.counted.length > 0 && !window.confirm("Al cambiar de almacén se borran las cantidades contadas. ¿Continuar?")) return;
    setWarehouseId(nextId);
    setCounts({});
  }

  async function post() {
    setPending(true);
    setFormError(null);
    try {
      const response = await fetch("/api/inventory/count", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          warehouseId,
          countedAt: new Date(`${countedAt}T12:00:00.000Z`).toISOString(),
          notes,
          lines: result.counted.map((entry) => ({ itemId: entry.itemId, countedQuantity: entry.countedQuantity, expectedQuantity: entry.systemQuantity })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el recuento."));
      const payload = (await response.json()) as { reference: string; adjustments: number };
      toast.success(payload.adjustments === 0 ? "Recuento registrado: el stock ya cuadraba." : `Recuento ${payload.reference} registrado con ${payload.adjustments === 1 ? "1 ajuste" : `${payload.adjustments} ajustes`}.`);
      setConfirmOpen(false);
      setCounts({});
      router.push(`/inventory?q=${encodeURIComponent(payload.reference)}`);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo registrar el recuento.");
      setFormError(message);
      toast.error(message);
      setConfirmOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (warehouses.length === 0 || items.length === 0) {
    return (
      <p className="border border-dashed border-window-dark-shadow bg-window-panel p-3 text-xs text-muted-foreground">
        Para contar necesitas al menos un almacén y un artículo de stock:{" "}
        <Link className="font-bold text-primary underline" href="/inventory/warehouses/new">nuevo almacén</Link> ·{" "}
        <Link className="font-bold text-primary underline" href="/inventory/items/new">nuevo artículo</Link>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 border border-window-dark-shadow bg-window-panel p-3 md:grid-cols-4">
        <AccessibleField helperText="Se muestra el stock que el sistema cree que hay en él." id="count-warehouse" label="Almacén que cuentas" required>
          <Select onChange={(event) => changeWarehouse(event.target.value)} value={warehouseId}>
            <option value="">Elige un almacén</option>
            {warehouses.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id="count-date" label="Fecha del recuento" required>
          <Input onChange={(event) => setCountedAt(event.target.value)} type="date" value={countedAt} />
        </AccessibleField>
        <AccessibleField className="md:col-span-2" helperText="Opcional; queda en el motivo de los ajustes." id="count-notes" label="Observaciones">
          <Input onChange={(event) => setNotes(event.target.value)} placeholder="Ej. Inventario de cierre de trimestre" value={notes} />
        </AccessibleField>
      </div>

      {warehouseId ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <AccessibleField className="sm:max-w-xs" id="count-search" label="Buscar artículo">
              <Input onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o referencia" type="search" value={search} />
            </AccessibleField>
            <label className="flex items-center gap-2 text-xs" htmlFor="count-only-differences">
              <input checked={onlyDifferences} id="count-only-differences" onChange={(event) => setOnlyDifferences(event.target.checked)} type="checkbox" />
              Ver solo artículos con diferencias
            </label>
          </div>

          <div className="overflow-x-auto border border-window-dark-shadow">
            <table className="w-full min-w-[36rem] text-xs">
              <caption className="sr-only">Hoja de recuento de {warehouse?.name}</caption>
              <thead className="bg-window-panel font-mono text-[0.7rem] uppercase text-window-muted">
                <tr>
                  <th className="px-2 py-1 text-left" scope="col">Artículo</th>
                  <th className="px-2 py-1 text-right" scope="col">Según el sistema</th>
                  <th className="px-2 py-1 text-right" scope="col">Contado</th>
                  <th className="px-2 py-1 text-right" scope="col">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr><td className="px-2 py-2 text-muted-foreground" colSpan={4}>No hay artículos que coincidan.</td></tr>
                ) : visibleItems.map((item) => {
                  const system = systemStock[item.id] ?? 0;
                  const entry = differenceByItem.get(item.id);
                  const rowError = result.errors[item.id];
                  return (
                    <tr className="border-t border-window-shadow" key={item.id}>
                      <th className="px-2 py-1.5 text-left font-normal" scope="row">
                        <span className="block font-bold">{item.name}</span>
                        <span className="text-muted-foreground">{item.sku}</span>
                      </th>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatQuantity(system)}</td>
                      <td className="w-36 px-2 py-1.5">
                        <QuantityInput
                          aria-describedby={rowError ? `count-error-${item.id}` : undefined}
                          aria-invalid={rowError ? true : undefined}
                          aria-label={`Cantidad contada de ${item.name}`}
                          onChange={(event) => setCounts((current) => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Sin contar"
                          value={counts[item.id] ?? ""}
                        />
                        {rowError ? <p className="mt-0.5 text-destructive" id={`count-error-${item.id}`}>{rowError}</p> : null}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right font-mono font-bold tabular-nums", entry && entry.difference > 0 && "text-success-text", entry && entry.difference < 0 && "text-danger-text")}>
                        {entry ? (entry.difference === 0 ? "Cuadra" : signed(entry.difference)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div aria-live="polite" className="flex flex-col gap-2 border border-window-dark-shadow bg-window-panel p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p>
              {result.summary.countedItems === 0
                ? "Escribe las cantidades contadas. Lo que dejes en blanco no se modifica."
                : `${result.summary.countedItems} artículo${result.summary.countedItems === 1 ? "" : "s"} contado${result.summary.countedItems === 1 ? "" : "s"} · ${result.summary.adjustments} con diferencia (entran ${formatQuantity(result.summary.unitsIn)}, salen ${formatQuantity(result.summary.unitsOut)} unidades).`}
            </p>
            <Button disabled={result.summary.countedItems === 0 || hasErrors || pending} onClick={() => setConfirmOpen(true)} type="button">
              Revisar y registrar recuento
            </Button>
          </div>
          <FormErrorMessage>{formError}</FormErrorMessage>
        </>
      ) : null}

      <Dialog
        description={result.summary.adjustments === 0
          ? `Todo lo contado en ${warehouse?.name ?? "el almacén"} coincide con el sistema. Se registrará el recuento sin ajustes.`
          : `Se registrarán ${result.summary.adjustments === 1 ? "1 ajuste" : `${result.summary.adjustments} ajustes`} en ${warehouse?.name ?? "el almacén"} con fecha ${countedAt}.`}
        initialFocusId="count-confirm-cancel"
        onClose={() => { if (!pending) setConfirmOpen(false); }}
        open={confirmOpen}
        size="lg"
        title="Registrar recuento"
      >
        {result.adjustments.length > 0 ? (
          <ul className="max-h-72 space-y-1 overflow-y-auto border border-window-shadow p-2 text-xs">
            {result.adjustments.map((entry) => (
              <li className="flex justify-between gap-3" key={entry.itemId}>
                <span>{itemById.get(entry.itemId)?.name}</span>
                <span className="font-mono tabular-nums">{formatQuantity(entry.systemQuantity)} → {formatQuantity(entry.countedQuantity)} ({signed(entry.difference)})</span>
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button disabled={pending} id="count-confirm-cancel" onClick={() => setConfirmOpen(false)} type="button" variant="outline">Seguir contando</Button>
          <Button disabled={pending} onClick={() => void post()} type="button">{pending ? "Registrando…" : "Registrar recuento"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
