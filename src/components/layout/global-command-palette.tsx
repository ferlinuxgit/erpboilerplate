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
  { href: "/sales/quotes", label: "Presupuestos", group: "Navegación" },
  { href: "/sales/orders", label: "Pedidos", group: "Navegación" },
  { href: "/sales/delivery-notes", label: "Albaranes", group: "Navegación" },
  { href: "/invoices", label: "Facturas", group: "Navegación" },
  { href: "/purchases/orders", label: "Pedidos de compra", group: "Navegación" },
  { href: "/purchases/receipts", label: "Recepciones", group: "Navegación" },
  { href: "/purchases/supplier-invoices", label: "Facturas de proveedor", group: "Navegación" },
  { href: "/purchases/payments", label: "Pagos a proveedores", group: "Navegación" },
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
  { href: "/purchases/new", label: "Crear pedido de compra", group: "Acciones" },
  { href: "/purchases/supplier-invoices/new", label: "Registrar factura de proveedor", group: "Acciones" },
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

export function CommandPaletteButton({ className, compact = false, onOpen }: { className?: string; compact?: boolean; onOpen?: () => void }) {
  return (
    <Button className={cn("justify-between text-window-muted", className)} onClick={() => { onOpen?.(); openCommandPalette(); }} type="button" variant="outline">
      <span className="flex items-center gap-2"><MagnifyingGlass aria-hidden="true" />{compact ? "Buscar" : "Buscar o crear…"}</span>
      {!compact ? <kbd className="border border-window-shadow bg-window-panel px-1 py-0.5 font-mono text-[0.58rem] text-window-muted">CTRL K</kbd> : null}
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
    <Dialog description="Navega a cualquier área o inicia una operación sin abandonar el teclado." initialFocusId="global-command-search" onClose={() => setOpen(false)} open={open} size="lg" title="COMMAND.EXE — Buscar y ejecutar">
      <div className="relative">
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-window-muted" />
        <Input className="h-9 pl-8 text-sm" id="global-command-search" onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, factura, nuevo gasto…" value={query} />
      </div>
      <div className="mt-2 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
        {query.trim().length >= 2 ? (
          <section>
            <p className="mb-1 border-b border-window-shadow pb-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-window-muted">Resultados</p>
            {isSearching ? <p className="px-2 py-2 font-mono text-xs text-window-muted">Buscando registros…</p> : recordResults.length > 0 ? (
              <div className="grid gap-px border border-window-dark-shadow sm:grid-cols-2">
                {recordResults.map((item) => (
                  <Link className="flex min-w-0 items-center gap-2 bg-window-surface px-2 py-1.5 text-xs hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={item.href} key={`${item.type}-${item.href}`} onClick={() => { setOpen(false); setQuery(""); }}>
                    <span className="grid size-6 shrink-0 place-items-center border border-window-shadow bg-window-panel"><MagnifyingGlass aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block truncate font-mono font-bold">{item.label}</span><span className="block truncate text-[0.68rem] opacity-75">{item.type} · {item.description}</span></span>
                  </Link>
                ))}
              </div>
            ) : <p className="px-2 py-2 font-mono text-xs text-window-muted">No hay registros que coincidan.</p>}
          </section>
        ) : null}
        {(["Acciones", "Navegación"] as const).map((group) => {
          const groupItems = results.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <section key={group}>
              <p className="mb-1 border-b border-window-shadow pb-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-window-muted">{group}</p>
              <div className="grid gap-px border border-window-dark-shadow sm:grid-cols-2">
                {groupItems.map((item) => (
                  <Link className="flex items-center gap-2 bg-window-surface px-2 py-1.5 font-mono text-xs font-bold hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" href={item.href} key={item.href} onClick={() => { setOpen(false); setQuery(""); }}>
                    <span className="grid size-6 place-items-center border border-window-shadow bg-window-panel">{group === "Acciones" ? <Plus aria-hidden="true" /> : <SquaresFour aria-hidden="true" />}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {results.length === 0 && query.trim().length < 2 ? <p className="border border-dashed border-window-dark-shadow p-3 text-center font-mono text-xs text-window-muted">No hay acciones ni módulos que coincidan.</p> : null}
      </div>
    </Dialog>
  );
}
