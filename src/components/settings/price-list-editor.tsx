"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { resolveLinePrice } from "@/lib/pricing";

export type PriceListDetail = {
  id: string;
  code: string;
  name: string;
  adjustmentPct: number;
  isActive: boolean;
  items: Array<{ id: string; sku: string; name: string; salePrice: number; price: number | null }>;
};

const toText = (value: number | null) => (value === null ? "" : value.toFixed(2).replace(".", ","));

/** Precios propios de una tarifa: vacío = precio de venta con el ajuste general. */
export function PriceListEditor({ currencyCode, list }: { currencyCode: string; list: PriceListDetail }) {
  const router = useRouter();
  const [name, setName] = useState(list.name);
  const [adjustment, setAdjustment] = useState(list.adjustmentPct ? String(list.adjustmentPct).replace(".", ",") : "");
  const [isActive, setIsActive] = useState(list.isActive);
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(list.items.map((entry) => [entry.id, toText(entry.price)])));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const adjustmentPct = adjustment.trim() ? parseDecimalInput(adjustment.replace("−", "-")) : 0;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return needle ? list.items.filter((entry) => `${entry.sku} ${entry.name}`.toLocaleLowerCase("es").includes(needle)) : list.items;
  }, [list.items, query]);

  const changedPrices = list.items.flatMap((entry) => {
    const text = prices[entry.id]?.trim() ?? "";
    const next = text ? parseDecimalInput(text, { maximumFractionDigits: 2 }) : null;
    if (text && (next === null || next < 0)) return [{ itemId: entry.id, price: Number.NaN }];
    return next === entry.price ? [] : [{ itemId: entry.id, price: next }];
  });
  const invalidPrice = changedPrices.some((entry) => entry.price !== null && Number.isNaN(entry.price));
  const dirty = name !== list.name || adjustmentPct !== list.adjustmentPct || isActive !== list.isActive || changedPrices.length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Indica el nombre de la tarifa.");
    if (adjustmentPct === null || adjustmentPct < -100 || adjustmentPct > 1000) return setError("El ajuste general debe estar entre −100 y 1000 %.");
    if (invalidPrice) return setError("Hay precios que no son un importe válido. Déjalos vacíos para usar el precio de venta con el ajuste.");
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/price-lists/${list.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ name: name.trim(), adjustmentPct, isActive, prices: changedPrices }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la tarifa."));
      toast.success(changedPrices.length ? `Tarifa guardada (${changedPrices.length} precio(s) cambiados).` : "Tarifa guardada.");
      router.refresh();
    } catch (saveError) {
      setError(errorMessage(saveError, "No se pudo guardar la tarifa."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const response = await fetch(`/api/price-lists/${list.id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo borrar la tarifa."));
      toast.success(`Tarifa «${list.name}» borrada.`);
      router.push("/settings/pricing#tarifas");
    } catch (deleteError) {
      setError(errorMessage(deleteError, "No se pudo borrar la tarifa."));
      setSaving(false);
    }
  }

  const listForPreview = { id: list.id, name, adjustmentPct: adjustmentPct ?? 0, prices: {} };

  return (
    <form className="space-y-3" noValidate onSubmit={save}>
      <div className="grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-start">
        <AccessibleField id="price-list-name" label="Nombre" required>
          <Input id="price-list-name" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
        </AccessibleField>
        <AccessibleField helperText="Para los artículos sin precio propio. −10 = 10 % más barato." id="price-list-adjustment" label="Ajuste general (%)">
          <Input id="price-list-adjustment" inputMode="decimal" onChange={(event) => setAdjustment(event.target.value)} placeholder="0" value={adjustment} />
        </AccessibleField>
        <label className="flex items-center gap-2 text-sm md:pt-6" htmlFor="price-list-active">
          <input checked={isActive} className="size-4 accent-primary" id="price-list-active" onChange={(event) => setIsActive(event.target.checked)} type="checkbox" />
          Activa
        </label>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <AccessibleField className="w-full max-w-xs" id="price-list-search" label="Buscar artículo">
          <Input id="price-list-search" onChange={(event) => setQuery(event.target.value)} placeholder="Código o nombre" type="search" value={query} />
        </AccessibleField>
        <p className="text-xs text-muted-foreground">Deja el precio vacío para usar el de venta con el ajuste general. Precios sin IVA.</p>
      </div>

      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay artículos activos. Créalos en Inventario › Artículos.</p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-surface border border-window-dark-shadow">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead className="text-right">Precio de venta</TableHead>
                <TableHead className="text-right">Sin precio propio</TableHead>
                <TableHead className="w-40 text-right">Precio en la tarifa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{entry.sku}</span> <span className="font-bold">{entry.name}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(entry.salePrice, currencyCode)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatMoney(resolveLinePrice(entry, { priceList: listForPreview, group: null }).unitPrice, currencyCode)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`Precio de ${entry.name} en la tarifa`}
                      className="text-right tabular-nums"
                      data-testid={`price-list-price-${entry.sku}`}
                      inputMode="decimal"
                      onChange={(event) => setPrices((current) => ({ ...current, [entry.id]: event.target.value }))}
                      placeholder="—"
                      value={prices[entry.id] ?? ""}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormErrorMessage>{error}</FormErrorMessage>
      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={() => setConfirmDelete(true)} type="button" variant="ghost">Borrar tarifa</Button>
        <SubmitButton disabled={!dirty} pending={saving} pendingLabel="Guardando…">Guardar tarifa</SubmitButton>
      </div>
      <DestructiveActionDialog
        confirmLabel="Borrar tarifa"
        description="Los clientes y grupos que la usan volverán al precio de venta. Las facturas ya hechas no cambian."
        isSubmitting={saving}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        open={confirmDelete}
        title={`¿Borrar la tarifa «${list.name}»?`}
      />
    </form>
  );
}
