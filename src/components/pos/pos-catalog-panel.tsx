"use client";

import { Barcode, Calculator, X } from "@phosphor-icons/react";
import { forwardRef, useMemo, useState } from "react";

import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { grossPrice } from "@/modules/pos/model";

import type { PosCatalogItem } from "./types";

/**
 * Catálogo táctil del TPV (mostrador y mesas): buscador que también sirve para lector de códigos
 * (referencia + Intro), categorías deslizables y fichas grandes con el PVP y lo que ya va en la cuenta.
 */
export const PosCatalogPanel = forwardRef<HTMLInputElement, {
  catalog: PosCatalogItem[];
  className?: string;
  currencyCode: string;
  inCart: Map<string, number>;
  onAdd: (entry: PosCatalogItem) => void;
  onFreeAmount: () => void;
  /** Artículos agotados hoy (se ven marcados; el que los toca decide). */
  soldOut?: ReadonlySet<string>;
}>(function PosCatalogPanel({ catalog, className, currencyCode, inCart, onAdd, onFreeAmount, soldOut }, searchRef) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(catalog.map((entry) => entry.categoryName).filter((name): name is string => Boolean(name)))], [catalog]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-ES");
    return catalog
      .filter((entry) => !category || entry.categoryName === category)
      .filter((entry) => !normalized || entry.name.toLocaleLowerCase("es-ES").includes(normalized) || entry.sku.toLocaleLowerCase("es-ES").includes(normalized))
      .slice(0, 200);
  }, [catalog, category, query]);

  function onSearchEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = query.trim().toLocaleLowerCase("es-ES");
    if (!term) return;
    // Lector de códigos o referencia exacta: añade directamente.
    const exact = catalog.find((entry) => entry.sku.toLocaleLowerCase("es-ES") === term) ?? (visibleItems.length === 1 ? visibleItems[0] : undefined);
    if (exact) {
      onAdd(exact);
      setQuery("");
    }
  }

  return (
    <section aria-label="Productos" className={cn("min-h-0 flex-col", className)}>
      <div className="space-y-2 border-b border-window-shadow p-2">
        <div className="relative">
          <Barcode aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Buscar artículo o leer código"
            className="h-12 w-full border-2 border-window-dark-shadow bg-white pl-10 pr-10 text-base outline-none focus:border-primary"
            data-testid="pos-search"
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchEnter}
            placeholder="Buscar o leer código"
            ref={searchRef}
            type="search"
            value={query}
          />
          {query ? (
            <button aria-label="Borrar búsqueda" className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center" onClick={() => setQuery("")} type="button"><X aria-hidden="true" className="size-5" /></button>
          ) : null}
        </div>
        {categories.length > 0 ? (
          <div className="-mx-2 flex snap-x gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none]">
            <CategoryChip active={category === null} label="Todo" onClick={() => setCategory(null)} />
            {categories.map((name) => <CategoryChip active={category === name} key={name} label={name} onClick={() => setCategory(name)} />)}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-24 md:pb-2">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-2 lg:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]" data-testid="pos-catalog">
          <li>
            <button className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-window-dark-shadow bg-window-panel p-2 text-center font-mono text-sm font-bold active:translate-y-px" data-testid="pos-free-amount-tile" onClick={onFreeAmount} type="button">
              <Calculator aria-hidden="true" className="size-7 text-link" />Importe libre
            </button>
          </li>
          {visibleItems.map((entry) => {
            const count = inCart.get(entry.id);
            const out = soldOut?.has(entry.id) ?? false;
            return (
              <li key={entry.id}>
                <button
                  aria-label={out ? `${entry.name} (agotado)` : undefined}
                  className={cn("relative flex h-full min-h-24 w-full select-none flex-col justify-between border-2 bg-window-panel p-2 text-left shadow-raised active:translate-y-px active:bg-window-highlight", out ? "border-dashed border-destructive opacity-60" : count ? "border-primary" : "border-window-dark-shadow")}
                  data-testid={`pos-item-${entry.sku}`}
                  onClick={() => onAdd(entry)}
                  type="button"
                >
                  {count ? <span className="absolute right-1 top-1 min-w-6 bg-primary px-1 text-center font-mono text-xs font-bold text-primary-foreground">×{count.toLocaleString("es-ES")}</span> : null}
                  {out ? <span className="absolute bottom-1 right-1 bg-destructive px-1 font-mono text-[11px] font-black uppercase text-destructive-foreground" data-testid="pos-item-sold-out">Agotado</span> : null}
                  <span className="line-clamp-3 pr-6 text-sm font-semibold leading-tight">{entry.name}</span>
                  <span className="mt-1 flex items-end justify-between gap-1">
                    <span className="font-mono text-base font-black tabular-nums">{formatMoney(grossPrice(entry.unitPrice, entry.taxRate), currencyCode)}</span>
                    {entry.stock !== null ? <span className={cn("font-mono text-[11px]", entry.stock <= 0 ? "font-bold text-destructive" : "text-muted-foreground")}>{entry.stock.toLocaleString("es-ES")} ud</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {visibleItems.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{catalog.length === 0 ? "No hay artículos en el catálogo: usa «Importe libre» o da de alta artículos." : "Sin resultados."}</p>
        ) : null}
      </div>
    </section>
  );
});

function CategoryChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={cn("h-11 shrink-0 snap-start border-2 px-4 font-mono text-sm font-bold", active ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} onClick={onClick} type="button">
      {label}
    </button>
  );
}
