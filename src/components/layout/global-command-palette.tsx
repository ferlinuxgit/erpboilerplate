"use client";

import { MagnifyingGlass, Plus, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const destinations = [
  { href: "/dashboard", label: "Panel", group: "Navegación" },
  { href: "/customers", label: "Clientes", group: "Navegación" },
  { href: "/suppliers", label: "Proveedores", group: "Navegación" },
  { href: "/sales", label: "Ventas", group: "Navegación" },
  { href: "/invoices", label: "Facturas", group: "Navegación" },
  { href: "/purchases", label: "Compras", group: "Navegación" },
  { href: "/expenses", label: "Gastos", group: "Navegación" },
  { href: "/inventory", label: "Inventario", group: "Navegación" },
  { href: "/inventory/items", label: "Artículos", group: "Navegación" },
  { href: "/inventory/warehouses", label: "Almacenes", group: "Navegación" },
  { href: "/accounting", label: "Contabilidad", group: "Navegación" },
  { href: "/treasury", label: "Tesorería", group: "Navegación" },
  { href: "/fiscal", label: "Fiscal", group: "Navegación" },
  { href: "/reporting", label: "Informes", group: "Navegación" },
  { href: "/customers/new", label: "Crear cliente", group: "Acciones" },
  { href: "/suppliers/new", label: "Crear proveedor", group: "Acciones" },
  { href: "/sales/new", label: "Crear presupuesto", group: "Acciones" },
  { href: "/invoices/new", label: "Crear factura", group: "Acciones" },
  { href: "/purchases/new", label: "Crear compra", group: "Acciones" },
  { href: "/expenses/new", label: "Registrar gasto", group: "Acciones" },
  { href: "/inventory/movements/new", label: "Registrar movimiento de stock", group: "Acciones" },
  { href: "/inventory/items/new", label: "Crear artículo", group: "Acciones" },
  { href: "/inventory/warehouses/new", label: "Crear almacén", group: "Acciones" },
  { href: "/accounting/entries/new", label: "Crear asiento", group: "Acciones" },
  { href: "/accounting/accounts/new", label: "Crear cuenta contable", group: "Acciones" },
  { href: "/treasury/bank-transactions/new", label: "Registrar movimiento bancario", group: "Acciones" },
  { href: "/treasury/bank-accounts/new", label: "Crear cuenta bancaria", group: "Acciones" },
  { href: "/fiscal/new", label: "Crear modelo fiscal", group: "Acciones" },
] as const;

const openCommandPaletteEvent = "erp:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(openCommandPaletteEvent));
}

export function CommandPaletteButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Button className={cn("justify-between text-muted-foreground", className)} onClick={openCommandPalette} type="button" variant="outline">
      <span className="flex items-center gap-2"><MagnifyingGlass aria-hidden="true" />{compact ? "Buscar" : "Buscar o crear…"}</span>
      {!compact ? <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">⌘ K</kbd> : null}
    </Button>
  );
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recordResults, setRecordResults] = useState<Array<{ href: string; label: string; description: string; type: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener(openCommandPaletteEvent, onOpen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(openCommandPaletteEvent, onOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || normalized.length < 2) {
      const resetTimer = window.setTimeout(() => {
        setRecordResults([]);
        setIsSearching(false);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as { results?: Array<{ href: string; label: string; description: string; type: string }> } | null;
        if (response.ok) setRecordResults(payload?.results ?? []);
      } catch {
        if (!controller.signal.aborted) setRecordResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return destinations;
    return destinations.filter((item) => `${item.label} ${item.group}`.toLocaleLowerCase().includes(normalized));
  }, [query]);

  return (
    <Dialog description="Navega a cualquier área o inicia una operación sin abandonar el teclado." initialFocusId="global-command-search" onClose={() => setOpen(false)} open={open} size="lg" title="Buscar y ejecutar">
      <div className="relative">
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-12 pl-10 text-base" id="global-command-search" onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, factura, nuevo gasto…" value={query} />
      </div>
      <div className="mt-4 max-h-[24rem] space-y-5 overflow-y-auto pr-1">
        {query.trim().length >= 2 ? (
          <section>
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Resultados</p>
            {isSearching ? <p className="rounded-lg px-3 py-4 text-sm text-muted-foreground">Buscando registros…</p> : recordResults.length > 0 ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {recordResults.map((item) => (
                  <Link className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.href} key={`${item.type}-${item.href}`} onClick={() => { setOpen(false); setQuery(""); }}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><MagnifyingGlass aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block truncate font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.type} · {item.description}</span></span>
                  </Link>
                ))}
              </div>
            ) : <p className="rounded-lg px-3 py-4 text-sm text-muted-foreground">No hay registros que coincidan.</p>}
          </section>
        ) : null}
        {(["Acciones", "Navegación"] as const).map((group) => {
          const groupItems = results.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <section key={group}>
              <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group}</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {groupItems.map((item) => (
                  <Link className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.href} key={item.href} onClick={() => { setOpen(false); setQuery(""); }}>
                    <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">{group === "Acciones" ? <Plus aria-hidden="true" /> : <SquaresFour aria-hidden="true" />}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {results.length === 0 && query.trim().length < 2 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No hay acciones ni módulos que coincidan.</p> : null}
      </div>
    </Dialog>
  );
}
