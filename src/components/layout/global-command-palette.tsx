"use client";

import { ClockCounterClockwise, MagnifyingGlass, Plus, SquaresFour } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { navigationLinks } from "@/components/layout/navigation-config";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CommandKind = "action" | "navigation" | "record" | "recent";

type Command = {
  href: string;
  label: string;
  kind: CommandKind;
  description?: string;
  code?: string;
  keywords?: string;
};

/** Quick actions: the most frequent daily operations, phrased as the user thinks of them. */
const quickActions: Command[] = [
  { href: "/invoices/new", label: "Nueva factura", kind: "action", keywords: "emitir facturar venta cobro" },
  { href: "/customers/new", label: "Nuevo cliente", kind: "action", keywords: "alta cliente crear" },
  { href: "/expenses/new", label: "Registrar gasto", kind: "action", keywords: "factura de proveedor ticket compra gasto" },
  { href: "/sales/new", label: "Nuevo presupuesto", kind: "action", keywords: "oferta cotización crear" },
  { href: "/sales/orders/new", label: "Nuevo pedido de venta", kind: "action", keywords: "pedido cliente crear" },
  { href: "/invoices", label: "Registrar cobro de una factura", kind: "action", keywords: "cobrar pago cliente pendiente" },
  { href: "/suppliers/new", label: "Nuevo proveedor", kind: "action", keywords: "alta proveedor crear" },
  { href: "/purchases/orders/new", label: "Nuevo pedido de compra", kind: "action", keywords: "comprar pedido proveedor" },
  { href: "/purchases/payments", label: "Pagar a un proveedor", kind: "action", keywords: "pago proveedor deuda" },
  { href: "/inventory/movements/new", label: "Registrar movimiento de stock", kind: "action", keywords: "inventario ajuste entrada salida traspaso" },
  { href: "/inventory/items/new", label: "Nuevo artículo", kind: "action", keywords: "producto servicio catálogo" },
  { href: "/inventory/warehouses/new", label: "Nuevo almacén", kind: "action", keywords: "ubicación" },
  { href: "/accounting/entries/new", label: "Nuevo asiento contable", kind: "action", keywords: "contabilidad diario" },
  { href: "/accounting/accounts/new", label: "Nueva cuenta contable", kind: "action", keywords: "plan contable" },
  { href: "/treasury/bank-transactions/new", label: "Registrar movimiento bancario", kind: "action", keywords: "banco extracto" },
  { href: "/treasury/bank-accounts/new", label: "Nueva cuenta bancaria", kind: "action", keywords: "banco iban" },
  { href: "/fiscal/new", label: "Preparar modelo fiscal", kind: "action", keywords: "impuestos 303 111 hacienda" },
];

const navigationCommands: Command[] = navigationLinks.map((link) => ({
  href: link.href,
  label: link.label,
  kind: "navigation",
  code: link.code,
}));

const RECENT_STORAGE_KEY = "erp-command-palette:recent";
const MAX_RECENT = 6;
const openCommandPaletteEvent = "erp:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(openCommandPaletteEvent));
}

export function CommandPaletteButton({ className, compact = false, onOpen }: { className?: string; compact?: boolean; onOpen?: () => void }) {
  return (
    <Button aria-keyshortcuts="Control+K Meta+K" className={cn("justify-between text-window-muted", className)} onClick={() => { onOpen?.(); openCommandPalette(); }} type="button" variant="outline">
      <span className="flex items-center gap-2"><MagnifyingGlass aria-hidden="true" />{compact ? "Buscar" : "Buscar o crear…"}</span>
      {!compact ? <kbd className="border border-window-shadow bg-window-panel px-1 py-0.5 font-mono text-[0.58rem] text-window-muted">CTRL K</kbd> : null}
    </Button>
  );
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

/** 0 = label starts with the query, 1 = a word starts with it, 2 = contains, 3 = keyword/code match, null = no match. */
function matchScore(command: Command, query: string) {
  const label = normalize(command.label);
  if (label.startsWith(query)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  if (normalize(`${command.keywords ?? ""} ${command.code ?? ""} ${command.description ?? ""}`).includes(query)) return 3;
  return null;
}

function readRecent(): Command[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]") as Command[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.href === "string" && typeof item?.label === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(command: Command) {
  try {
    const entry: Command = { href: command.href, label: command.label, kind: "recent", description: command.kind === "record" ? command.description : command.kind === "action" ? "Acción" : "Módulo" };
    const next = [entry, ...readRecent().filter((item) => item.href !== command.href)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode); recents are a convenience.
  }
}

const kindIcons: Record<CommandKind, ReactNode> = {
  action: <Plus aria-hidden="true" />,
  navigation: <SquaresFour aria-hidden="true" />,
  record: <MagnifyingGlass aria-hidden="true" />,
  recent: <ClockCounterClockwise aria-hidden="true" />,
};

type Section = { id: string; title: string; items: Command[] };

export function GlobalCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<Command[]>([]);
  const [recordResults, setRecordResults] = useState<Array<{ href: string; label: string; description: string; type: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  const closePalette = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActiveIndex(-1);
        setOpen((current) => !current);
        return;
      }
      const target = event.target;
      const isEditable = target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"));
      if (event.key === "/" && !isEditable && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
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
    if (!open) return;
    const timer = window.setTimeout(() => setRecent(readRecent()), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

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

  const sections = useMemo<Section[]>(() => {
    const normalized = normalize(query.trim());
    if (!normalized) {
      return [
        { id: "recent", title: "Recientes", items: recent },
        { id: "actions", title: "Acciones rápidas", items: quickActions.slice(0, 8) },
        { id: "navigation", title: "Ir a", items: navigationCommands },
      ].filter((section) => section.items.length > 0);
    }
    const ranked = [...quickActions, ...navigationCommands]
      .map((command, order) => ({ command, order, score: matchScore(command, normalized) }))
      .filter((entry): entry is { command: Command; order: number; score: number } => entry.score !== null)
      // Modules before actions on equal score, so "inventario" opens Inventario.
      .sort((left, right) => left.score - right.score || (left.command.kind === right.command.kind ? left.order - right.order : left.command.kind === "navigation" ? -1 : 1))
      .map((entry) => entry.command);
    const records: Command[] = recordResults.map((result) => ({ href: result.href, label: result.label, kind: "record", description: `${result.type} · ${result.description}` }));
    return [
      { id: "matches", title: "Coincidencias", items: ranked },
      { id: "records", title: "Registros", items: records },
    ].filter((section) => section.items.length > 0);
  }, [query, recent, recordResults]);

  const flatItems = sections.flatMap((section) => section.items);
  const safeActiveIndex = activeIndex >= flatItems.length ? flatItems.length - 1 : activeIndex;
  const optionId = (index: number) => `global-command-option-${index}`;

  useEffect(() => {
    if (safeActiveIndex < 0) return;
    document.getElementById(optionId(safeActiveIndex))?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex]);

  const execute = (command: Command) => {
    rememberRecent(command);
    closePalette();
    router.push(command.href);
  };

  const sectionOffsets = sections.map((_, sectionIndex) =>
    sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.items.length, 0),
  );

  return (
    <Dialog description="Busca registros, abre un módulo o inicia una operación sin soltar el teclado." initialFocusId="global-command-search" onClose={closePalette} open={open} size="lg" title="COMMAND.EXE — Buscar y ejecutar">
      <label className="sr-only" htmlFor="global-command-search">Buscar módulos, registros o acciones</label>
      <div className="relative">
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-window-muted" />
        <Input
          aria-activedescendant={safeActiveIndex >= 0 ? optionId(safeActiveIndex) : undefined}
          aria-autocomplete="list"
          aria-controls="global-command-results"
          aria-describedby="global-command-help"
          aria-expanded={flatItems.length > 0}
          aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"
          autoComplete="off"
          className="h-9 pl-8 text-sm"
          id="global-command-search"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (flatItems.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((safeActiveIndex + 1) % flatItems.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex(safeActiveIndex <= 0 ? flatItems.length - 1 : safeActiveIndex - 1);
            } else if (event.key === "PageDown" || (event.key === "End" && event.ctrlKey)) {
              event.preventDefault();
              setActiveIndex(flatItems.length - 1);
            } else if (event.key === "PageUp" || (event.key === "Home" && event.ctrlKey)) {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "Enter") {
              event.preventDefault();
              execute(flatItems[Math.max(0, safeActiveIndex)]);
            }
          }}
          placeholder="Cliente, factura, nuevo gasto…"
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </div>
      <p className="mt-1 font-mono text-[0.6rem] text-window-muted" id="global-command-help">
        ↑↓ seleccionar · Enter abrir · Esc cerrar{isSearching ? " · Buscando registros…" : ""}
      </p>
      <p aria-live="polite" className="sr-only">
        {query.trim() ? `${flatItems.length} resultados` : ""}
      </p>
      <div aria-label="Resultados" className="mt-2 max-h-[24rem] space-y-3 overflow-y-auto pr-1" id="global-command-results" role="listbox">
        {sections.map((section, sectionIndex) => (
          <div aria-labelledby={`global-command-group-${section.id}`} key={section.id} role="group">
            <p className="mb-1 border-b border-window-shadow pb-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-window-muted" id={`global-command-group-${section.id}`} role="presentation">
              {section.title}
            </p>
            <div className="grid gap-px border border-window-dark-shadow bg-window-dark-shadow sm:grid-cols-2">
              {section.items.map((item, itemIndex) => {
                const index = sectionOffsets[sectionIndex] + itemIndex;
                const active = index === safeActiveIndex;
                return (
                  <div
                    aria-selected={active}
                    className={cn(
                      "flex min-w-0 cursor-pointer items-center gap-2 bg-window-surface px-2 py-1.5 font-mono text-xs hover:bg-window-highlight",
                      active && "bg-primary text-primary-foreground outline-2 outline-focus hover:bg-primary",
                    )}
                    data-command-item
                    id={optionId(index)}
                    key={`${section.id}-${item.href}-${item.label}`}
                    onClick={() => execute(item)}
                    onMouseMove={() => {
                      if (!active) setActiveIndex(index);
                    }}
                    role="option"
                  >
                    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center border border-window-shadow bg-window-panel text-window-text">
                      {kindIcons[item.kind]}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{item.label}</span>
                      {item.description || item.code ? (
                        <span className="block truncate text-[0.68rem] opacity-75">{item.code ? `Código ${item.code}` : item.description}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {flatItems.length === 0 && !isSearching ? (
          <p className="border border-dashed border-window-dark-shadow p-3 text-center font-mono text-xs text-window-muted" role="presentation">
            Nada coincide con «{query.trim()}». Prueba con el nombre de un cliente, un número de factura o una acción como «nueva factura».
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
