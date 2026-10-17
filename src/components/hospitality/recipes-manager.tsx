"use client";

import { NotePencil, Plus, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { foodCost } from "@/modules/hospitality/recipes";
import type { RecipeList } from "@/server/pos/recipes";

import { postJson } from "./types";

type Recipe = RecipeList["recipes"][number];
type ItemOption = RecipeList["items"][number];

const TONE: Record<"good" | "warning" | "bad" | "neutral", string> = {
  good: "bg-success text-white",
  warning: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
  neutral: "bg-window-shadow text-white",
};
const quantityText = (value: number) => String(value).replace(".", ",");
const parseQuantity = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Escandallos: coste de cada plato, margen y food cost, y qué sale del almacén al venderlo. */
export function RecipesManager({ canManage, data, inventoryEnabled }: { canManage: boolean; data: RecipeList; inventoryEnabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ itemId: string; recipe: Recipe | null } | null>(null);
  const [newItem, setNewItem] = useState("");
  const [pending, setPending] = useState(false);
  const withoutRecipe = data.items.filter((entry) => !entry.hasRecipe);
  const average = data.recipes.filter((recipe) => recipe.foodCost.percent !== null);
  const averagePercent = average.length > 0 ? Math.round((average.reduce((sum, recipe) => sum + (recipe.foodCost.percent ?? 0), 0) / average.length) * 10) / 10 : null;

  async function remove(recipe: Recipe) {
    if (!window.confirm(`¿Quitar el escandallo de «${recipe.name}»? Al venderlo volverá a descontarse el propio artículo.`)) return;
    setPending(true);
    try {
      await postJson(`/api/pos/recipes/${recipe.itemId}`, {}, "DELETE");
      toast.success("Escandallo quitado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="pos-recipes">
      {!inventoryEnabled ? <p className="border border-window-shadow bg-window-panel p-2 text-sm">Con el módulo de Inventario activo y un almacén en la caja, cada venta descontará los ingredientes. Sin él, los escandallos sirven para conocer el coste y el margen.</p> : null}
      {data.recipes.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="border border-window-shadow px-2 py-1"><strong>{data.recipes.length}</strong> escandallos</span>
          {averagePercent !== null ? <span className={cn("px-2 py-1 font-semibold", TONE[foodCost(averagePercent, 100).tone])}>Food cost medio {averagePercent.toLocaleString("es-ES")} %</span> : null}
          <span className="px-1 py-1 text-xs text-muted-foreground">Referencia: hasta 30 % bien · 30–35 % vigilar · más de 35 % revisar precio o ración.</span>
        </div>
      ) : null}
      {data.recipes.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay escandallos. Elige un plato y añade sus ingredientes con la cantidad por ración (en la unidad de cada ingrediente: kg, l, ud…).</p> : (
        <div className="overflow-x-auto border border-window-shadow">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-window-panel text-left font-mono text-xs uppercase">
              <tr><th className="p-2">Plato</th><th className="p-2 text-right">PVP</th><th className="p-2 text-right">Coste ración</th><th className="p-2 text-right">Margen (sin IVA)</th><th className="p-2 text-right">Food cost</th><th className="p-2" /></tr>
            </thead>
            <tbody className="divide-y divide-window-shadow">
              {data.recipes.map((recipe) => (
                <tr data-testid={`pos-recipe-${recipe.name}`} key={recipe.itemId}>
                  <td className="p-2"><p className="font-semibold">{recipe.name}</p><p className="text-xs text-muted-foreground">{recipe.lines.map((line) => `${quantityText(line.quantity)} ${line.unit} ${line.name}`).join(" · ")}</p></td>
                  <td className="p-2 text-right font-mono tabular-nums">{formatMoney(recipe.price)}</td>
                  <td className="p-2 text-right font-mono tabular-nums" data-testid="pos-recipe-cost">{formatMoney(recipe.cost)}</td>
                  <td className="p-2 text-right font-mono tabular-nums">{formatMoney(recipe.margin)}</td>
                  <td className="p-2 text-right"><span className={cn("inline-block min-w-16 px-1.5 py-0.5 text-center font-mono text-xs font-bold", TONE[recipe.foodCost.tone])} data-testid="pos-recipe-food-cost">{recipe.foodCost.percent === null ? "—" : `${recipe.foodCost.percent.toLocaleString("es-ES")} %`}</span></td>
                  <td className="p-2 text-right">
                    {canManage ? (
                      <span className="inline-flex gap-1">
                        <Button aria-label={`Editar el escandallo de ${recipe.name}`} disabled={pending} onClick={() => setEditing({ itemId: recipe.itemId, recipe })} size="icon-sm" type="button" variant="ghost"><NotePencil aria-hidden="true" /></Button>
                        <Button aria-label={`Quitar el escandallo de ${recipe.name}`} disabled={pending} onClick={() => void remove(recipe)} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">Plato o bebida
            <select className="h-11 w-72 border border-input bg-window-surface px-2 text-sm" data-testid="pos-recipe-item" onChange={(event) => setNewItem(event.target.value)} value={newItem}>
              <option value="">Elige el artículo…</option>
              {withoutRecipe.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.categoryName ? ` · ${entry.categoryName}` : ""}</option>)}
            </select>
          </label>
          <Button className="h-11" data-testid="pos-recipe-new" disabled={!newItem} onClick={() => setEditing({ itemId: newItem, recipe: null })} type="button" variant="outline"><Plus aria-hidden="true" /> Crear escandallo</Button>
        </div>
      ) : null}
      {editing ? <RecipeDialog items={data.items} itemId={editing.itemId} onClose={() => { setEditing(null); setNewItem(""); }} recipe={editing.recipe} /> : null}
    </div>
  );
}

function RecipeDialog({ itemId, items, onClose, recipe }: { itemId: string; items: ItemOption[]; onClose: () => void; recipe: Recipe | null }) {
  const router = useRouter();
  const dish = items.find((entry) => entry.id === itemId);
  const [lines, setLines] = useState(recipe?.lines.map((line) => ({ ingredientItemId: line.ingredientItemId, quantity: quantityText(line.quantity) })) ?? []);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const normalized = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const matches = normalized ? items.filter((entry) => entry.id !== itemId && !lines.some((line) => line.ingredientItemId === entry.id) && `${entry.name} ${entry.sku}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(normalized)).slice(0, 8) : [];
  const cost = Math.round(lines.reduce((sum, line) => sum + parseQuantity(line.quantity) * (byId.get(line.ingredientItemId)?.unitCost ?? 0), 0) * 100) / 100;
  const preview = foodCost(cost, dish?.netPrice ?? 0);

  async function save() {
    setPending(true);
    try {
      await postJson(`/api/pos/recipes/${itemId}`, { lines: lines.map((line) => ({ ingredientItemId: line.ingredientItemId, quantity: parseQuantity(line.quantity) })) }, "PUT");
      toast.success("Escandallo guardado.");
      router.refresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
      setPending(false);
    }
  }

  return (
    <Dialog onClose={onClose} open title={`Escandallo · ${dish?.name ?? ""}`}>
      <div className="max-h-[75dvh] space-y-3 overflow-y-auto pr-1" data-testid="pos-recipe-dialog">
        <p className="text-xs text-muted-foreground">Cantidad por ración en la unidad de cada ingrediente (0,18 kg de carne, 1 ud de pan, 0,05 l de aceite). El coste usa el coste medio del almacén o, si no hay, el precio de compra.</p>
        {lines.length > 0 ? (
          <ul className="divide-y divide-window-shadow border border-window-shadow">
            {lines.map((line, index) => {
              const ingredient = byId.get(line.ingredientItemId);
              return (
                <li className="flex flex-wrap items-center gap-2 p-2 text-sm" key={line.ingredientItemId}>
                  <span className="min-w-0 flex-1"><span className="font-semibold">{ingredient?.name ?? "?"}</span>{ingredient?.hasRecipe ? <span className="ml-1 text-xs text-link">(sub-receta)</span> : null}<span className="block text-xs text-muted-foreground">{formatMoney(ingredient?.unitCost ?? 0)} / {ingredient?.unit ?? "ud"}</span></span>
                  <span className="flex items-center gap-1">
                    <Input aria-label={`Cantidad de ${ingredient?.name ?? ""}`} className="h-10 w-24 text-right" inputMode="decimal" onChange={(event) => setLines(lines.map((entry, position) => (position === index ? { ...entry, quantity: event.target.value.replace(/[^\d,.]/g, "") } : entry)))} value={line.quantity} />
                    <span className="w-8 font-mono text-xs">{ingredient?.unit ?? "ud"}</span>
                  </span>
                  <span className="w-20 text-right font-mono tabular-nums">{formatMoney(Math.round(parseQuantity(line.quantity) * (ingredient?.unitCost ?? 0) * 100) / 100)}</span>
                  <Button aria-label={`Quitar ${ingredient?.name ?? ""}`} onClick={() => setLines(lines.filter((_, position) => position !== index))} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="space-y-1">
          <Input aria-label="Buscar ingrediente" className="h-11" onChange={(event) => setQuery(event.target.value)} placeholder="Añadir ingrediente: buscar por nombre o referencia…" type="search" value={query} />
          {normalized ? (
            <ul className="divide-y divide-window-shadow border border-window-shadow">
              {matches.length === 0 ? <li className="p-2 text-sm text-muted-foreground">Sin resultados. Da de alta el ingrediente en Inventario → Artículos.</li> : matches.map((entry) => (
                <li key={entry.id}><button className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-window-highlight" onClick={() => { setLines([...lines, { ingredientItemId: entry.id, quantity: "" }]); setQuery(""); }} type="button"><span>{entry.name} <span className="text-muted-foreground">· {formatMoney(entry.unitCost)}/{entry.unit}</span></span><Plus aria-hidden="true" className="size-4" /></button></li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-window-shadow pt-2 font-mono">
          <span>Coste por ración <strong className="tabular-nums" data-testid="pos-recipe-dialog-cost">{formatMoney(cost)}</strong></span>
          <span className={cn("px-1.5 py-0.5 text-xs font-bold", TONE[preview.tone])}>{preview.percent === null ? "—" : `Food cost ${preview.percent.toLocaleString("es-ES")} %`}</span>
        </div>
        <Button className="h-12 w-full" data-testid="pos-recipe-save" disabled={pending || lines.length === 0 || lines.some((line) => parseQuantity(line.quantity) <= 0)} onClick={() => void save()} type="button">Guardar escandallo</Button>
      </div>
    </Dialog>
  );
}
