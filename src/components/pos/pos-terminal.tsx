"use client";

import { ArrowsOut, Barcode, Calculator, DotsThreeVertical, GearSix, LockKey, Minus, Money, Plus, Printer, Receipt, ShoppingCart, SquaresFour, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartTotals, exceedsSimplifiedLimit, grossPrice, netFromGross, type CartLine } from "@/modules/pos/model";

import { CashMovementDialog } from "./cash-movement-dialog";
import { CustomerSheet } from "./customer-sheet";
import { FreeAmountSheet } from "./free-amount-sheet";
import { KioskAction, KioskBar } from "./kiosk-bar";
import { LineEditorSheet } from "./line-editor-sheet";
import { PaymentDialog, type PaymentChoice } from "./payment-dialog";
import { TicketsDialog } from "./tickets-dialog";
import { openTicketPrint, type PosCatalogItem, type PosCustomer, type PosRegisterView, type PosSessionView, type PosTicketView } from "./types";
import { tapFeedback, useWakeLock } from "./use-touch-pos";

const AUTO_PRINT_KEY = "erp:pos:auto-print";

type LastSale = { invoiceId: string; number: string; total: number; change: number; warnings: string[] };

/**
 * TPV táctil a pantalla completa (sin el menú del ERP).
 * - Tablet y ordenador: catálogo y ticket lado a lado.
 * - Móvil: dos pantallas («Productos» y «Ticket») con una barra fija abajo con el total y «Cobrar».
 * Buscar también sirve para lector de códigos (referencia + Intro). Con teclado: F2 busca, F9 cobra.
 */
export function PosTerminal({ bankAccounts, canManage, catalog, currencyCode, register, session, tickets }: {
  bankAccounts: Array<{ id: string; name: string }>;
  canManage: boolean;
  catalog: PosCatalogItem[];
  currencyCode: string;
  register: PosRegisterView;
  session: PosSessionView;
  tickets: PosTicketView[];
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [view, setView] = useState<"catalog" | "ticket">("catalog");
  const [sheet, setSheet] = useState<null | "pay" | "tickets" | "cash" | "free" | "customer" | "menu">(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);

  useWakeLock(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setAutoPrint(window.localStorage.getItem(AUTO_PRINT_KEY) === "1"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const categories = useMemo(() => [...new Set(catalog.map((entry) => entry.categoryName).filter((name): name is string => Boolean(name)))], [catalog]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-ES");
    return catalog
      .filter((entry) => !category || entry.categoryName === category)
      .filter((entry) => !normalized || entry.name.toLocaleLowerCase("es-ES").includes(normalized) || entry.sku.toLocaleLowerCase("es-ES").includes(normalized))
      .slice(0, 200);
  }, [catalog, category, query]);
  const totals = useMemo(() => cartTotals(lines), [lines]);
  const units = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const inCart = useMemo(() => {
    const byItem = new Map<string, number>();
    for (const line of lines) if (line.itemId) byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.quantity);
    return byItem;
  }, [lines]);
  const overLimit = !customer && exceedsSimplifiedLimit(totals.total, register.simplifiedLimit);
  const saleCount = tickets.filter((ticket) => ticket.kind === "SALE").length;
  const canCharge = lines.length > 0 && !overLimit;
  const editingLine = lines.find((line) => line.key === editingKey) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        setView("catalog");
        searchRef.current?.focus();
      }
      if (event.key === "F9" && canCharge && sheet === null) {
        event.preventDefault();
        setSheet("pay");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCharge, sheet]);

  function addItem(entry: PosCatalogItem) {
    tapFeedback();
    setLastSale(null);
    setLines((current) => {
      const existing = current.find((line) => line.itemId === entry.id && line.unitPrice === entry.unitPrice);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, { key: crypto.randomUUID(), itemId: entry.id, description: entry.name, quantity: 1, unitPrice: entry.unitPrice, taxRate: entry.taxRate, taxId: entry.taxId }];
    });
    setFlash({ id: Date.now(), text: `+1 ${entry.name}` });
  }

  function addFree(input: { description: string; gross: number; taxRate: number }) {
    const { net } = netFromGross(input.gross, input.taxRate);
    setLastSale(null);
    setLines((current) => [...current, { key: crypto.randomUUID(), itemId: null, description: input.description, quantity: 1, unitPrice: net, taxRate: input.taxRate, taxId: null }]);
    setSheet(null);
    setFlash({ id: Date.now(), text: `+ ${input.description}` });
  }

  function onSearchEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = query.trim().toLocaleLowerCase("es-ES");
    if (!term) return;
    // Lector de códigos o referencia exacta: añade directamente.
    const exact = catalog.find((entry) => entry.sku.toLocaleLowerCase("es-ES") === term) ?? (visibleItems.length === 1 ? visibleItems[0] : undefined);
    if (exact) {
      addItem(exact);
      setQuery("");
    }
  }

  function changeQuantity(key: string, delta: number) {
    tapFeedback();
    setLines((current) => current.flatMap((line) => {
      if (line.key !== key) return [line];
      const quantity = Math.round((line.quantity + delta) * 1000) / 1000;
      return quantity <= 0 ? [] : [{ ...line, quantity }];
    }));
  }

  async function pay(choice: PaymentChoice) {
    setPaying(true);
    try {
      const response = await fetch("/api/pos/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          registerId: register.id,
          clientRequestId: requestId,
          customerId: customer?.id ?? null,
          lines: lines.map((line) => ({ itemId: line.itemId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, taxId: line.taxId ?? null })),
          payment: choice,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cobrar el ticket."));
      const sale = await response.json() as LastSale;
      setLastSale(sale);
      setLines([]);
      setCustomer(null);
      setSheet(null);
      setView("ticket");
      setRequestId(crypto.randomUUID());
      for (const warning of sale.warnings) toast.warning(warning);
      if (autoPrint) openTicketPrint(sale.invoiceId);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo cobrar el ticket."));
    } finally {
      setPaying(false);
    }
  }

  function newSale() {
    setLastSale(null);
    setView("catalog");
    searchRef.current?.focus();
  }

  const openedAt = new Date(session.openedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-terminal">
      <KioskBar status={`Abierta ${openedAt} · ${saleCount} ${saleCount === 1 ? "ticket" : "tickets"}`} title={register.name}>
        <KioskAction data-testid="pos-open-tickets" icon={<Receipt aria-hidden="true" className="size-5" />} label="Tickets" onClick={() => setSheet("tickets")} />
        <KioskAction icon={<Money aria-hidden="true" className="size-5" />} label="Entrada/salida de efectivo" onClick={() => setSheet("cash")}>Efectivo</KioskAction>
        <Link aria-label="Cerrar caja" className="flex h-11 min-w-11 items-center justify-center gap-1.5 border border-white/30 px-2.5 font-mono text-xs font-bold hover:bg-white/10" data-testid="pos-close-link" href={`/pos/${register.id}/close`}>
          <LockKey aria-hidden="true" className="size-5" /><span className="hidden md:inline">Cerrar caja</span>
        </Link>
        <KioskAction icon={<DotsThreeVertical aria-hidden="true" className="size-5" />} label="Más opciones" onClick={() => setSheet("menu")}>Más</KioskAction>
      </KioskBar>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_22rem] lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        {/* Productos */}
        <section aria-label="Productos" className={cn("min-h-0 flex-col md:flex", view === "catalog" ? "flex" : "hidden")}>
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
                <button className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-window-dark-shadow bg-window-panel p-2 text-center font-mono text-sm font-bold active:translate-y-px" data-testid="pos-free-amount-tile" onClick={() => setSheet("free")} type="button">
                  <Calculator aria-hidden="true" className="size-7 text-link" />Importe libre
                </button>
              </li>
              {visibleItems.map((entry) => {
                const count = inCart.get(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      className={cn("relative flex h-full min-h-24 w-full select-none flex-col justify-between border-2 bg-window-panel p-2 text-left shadow-raised active:translate-y-px active:bg-window-highlight", count ? "border-primary" : "border-window-dark-shadow")}
                      data-testid={`pos-item-${entry.sku}`}
                      onClick={() => addItem(entry)}
                      type="button"
                    >
                      {count ? <span className="absolute right-1 top-1 min-w-6 bg-primary px-1 text-center font-mono text-xs font-bold text-primary-foreground">×{count.toLocaleString("es-ES")}</span> : null}
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

        {/* Ticket */}
        <section aria-label="Ticket" className={cn("min-h-0 flex-col border-window-shadow md:flex md:border-l", view === "ticket" ? "flex" : "hidden")}>
          <button className="flex min-h-12 items-center gap-2 border-b border-window-shadow px-3 text-left text-sm" data-testid="pos-customer-button" onClick={() => setSheet("customer")} type="button">
            <User aria-hidden="true" className="size-5 shrink-0 text-link" />
            <span className="min-w-0 flex-1 truncate">{customer ? <><strong>{customer.name}</strong>{customer.taxId ? ` · ${customer.taxId}` : ""}</> : "Cliente: sin identificar (ticket)"}</span>
            <span className="font-mono text-xs text-link">{customer ? "Cambiar" : "Añadir"}</span>
          </button>
          <ol className="min-h-0 flex-1 divide-y divide-window-shadow overflow-y-auto overscroll-contain pb-24 md:pb-0" data-testid="pos-cart">
            {lines.length === 0 && !lastSale ? (
              <li className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <ShoppingCart aria-hidden="true" className="size-10 opacity-40" />Toca un artículo o lee su código para empezar.
              </li>
            ) : null}
            {lines.map((line) => {
              const lineTotal = totals.lines.find((entry) => entry.key === line.key)?.total ?? 0;
              return (
                <li className="flex items-stretch" data-testid="pos-cart-line" key={line.key}>
                  <button aria-label={`Editar ${line.description}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-window-highlight" onClick={() => setEditingKey(line.key)} type="button">
                    <span className="min-w-8 font-mono text-base font-black">{line.quantity.toLocaleString("es-ES")}×</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{line.description}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{formatMoney(grossPrice(line.unitPrice, line.taxRate), currencyCode)} · IVA {line.taxRate} %</span>
                    </span>
                    <span className="font-mono text-base font-bold tabular-nums">{formatMoney(lineTotal, currencyCode)}</span>
                  </button>
                  <div className="flex items-center gap-1 pr-2">
                    <button aria-label={`Quitar una unidad de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel active:translate-y-px" onClick={() => changeQuantity(line.key, -1)} type="button"><Minus aria-hidden="true" className="size-5" /></button>
                    <button aria-label={`Añadir una unidad de ${line.description}`} className="flex size-11 items-center justify-center border border-window-dark-shadow bg-window-panel active:translate-y-px" onClick={() => changeQuantity(line.key, 1)} type="button"><Plus aria-hidden="true" className="size-5" /></button>
                  </div>
                </li>
              );
            })}
            {lastSale && lines.length === 0 ? (
              <li className="space-y-3 bg-success/10 p-5 text-center" data-testid="pos-last-sale" role="status">
                <p className="font-mono text-sm font-bold">Ticket {lastSale.number} cobrado · {formatMoney(lastSale.total, currencyCode)}</p>
                {lastSale.change > 0 ? <p className="font-mono text-4xl font-black">Cambio {formatMoney(lastSale.change, currencyCode)}</p> : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-14" data-testid="pos-print-last" onClick={() => openTicketPrint(lastSale.invoiceId)} type="button" variant="outline"><Printer aria-hidden="true" /> Imprimir</Button>
                  <Button className="h-14" onClick={newSale} type="button">Nueva venta</Button>
                </div>
              </li>
            ) : null}
          </ol>
          <div className="space-y-2 border-t border-window-shadow p-3">
            {totals.taxBreakdown.length > 0 && lines.length > 0 ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 font-mono text-xs text-muted-foreground">
                {totals.taxBreakdown.map((bucket) => (
                  <div className="contents" key={bucket.rate}><dt>Base {bucket.rate} % {formatMoney(bucket.base, currencyCode)}</dt><dd className="text-right">IVA {formatMoney(bucket.tax, currencyCode)}</dd></div>
                ))}
              </dl>
            ) : null}
            {totals.rounding !== 0 && lines.length > 0 ? (
              <p className="flex justify-between font-mono text-xs text-muted-foreground" data-testid="pos-rounding"><span>Redondeo IVA</span><span>{formatMoney(totals.rounding, currencyCode)}</span></p>
            ) : null}
            {overLimit ? <p className="text-sm font-bold text-destructive">Supera {formatMoney(register.simplifiedLimit, currencyCode)}: identifica al cliente (con NIF) para hacer factura completa.</p> : null}
            {/* En tablet el botón de cobrar vive aquí; en el móvil, en la barra inferior. */}
            <Button className="hidden h-16 w-full text-xl md:flex" data-testid="pos-charge" disabled={!canCharge} onClick={() => setSheet("pay")} type="button">
              Cobrar {formatMoney(totals.total, currencyCode)}
            </Button>
          </div>
        </section>
      </div>

      {flash ? (
        <p aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto w-fit max-w-[90vw] truncate bg-black/80 px-3 py-1.5 font-mono text-sm text-white md:hidden" key={flash.id}>{flash.text}</p>
      ) : null}

      {/* Barra inferior del móvil: pantallas y cobro siempre a mano. */}
      <nav aria-label="TPV" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-window-dark-shadow bg-window-surface p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden" data-testid="pos-mobile-bar">
        <button aria-label={view === "catalog" ? "Ver ticket" : "Ver productos"} className="relative flex h-14 w-16 flex-col items-center justify-center border border-window-dark-shadow bg-window-panel font-mono text-[11px] font-bold" data-testid="pos-toggle-view" onClick={() => setView(view === "catalog" ? "ticket" : "catalog")} type="button">
          {view === "catalog" ? <Receipt aria-hidden="true" className="size-6" /> : <SquaresFour aria-hidden="true" className="size-6" />}
          {view === "catalog" ? "Ticket" : "Productos"}
          {view === "catalog" && units > 0 ? <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-primary px-1 text-center text-xs text-primary-foreground" data-testid="pos-units-badge">{units.toLocaleString("es-ES")}</span> : null}
        </button>
        <button className="min-w-0 text-left" onClick={() => setView("ticket")} type="button">
          <span className="block font-mono text-[11px] uppercase text-muted-foreground">{lines.length} {lines.length === 1 ? "línea" : "líneas"}</span>
          <span className="block truncate font-mono text-2xl font-black tabular-nums" data-testid="pos-mobile-total">{formatMoney(totals.total, currencyCode)}</span>
        </button>
        <Button className="h-14 px-5 text-lg" data-testid="pos-charge-mobile" disabled={!canCharge} onClick={() => setSheet("pay")} type="button">Cobrar</Button>
      </nav>

      <PaymentDialog
        cardEnabled={register.cardEnabled}
        currencyCode={currencyCode}
        key={requestId + String(sheet === "pay")}
        onClose={() => setSheet(null)}
        onConfirm={(choice) => void pay(choice)}
        open={sheet === "pay"}
        pending={paying}
        total={totals.total}
      />
      <FreeAmountSheet onAdd={addFree} onClose={() => setSheet(null)} open={sheet === "free"} />
      <CustomerSheet current={customer} onClose={() => setSheet(null)} onSelect={(selected) => { setCustomer(selected); setSheet(null); }} open={sheet === "customer"} />
      <TicketsDialog currencyCode={currencyCode} onClose={() => setSheet(null)} open={sheet === "tickets"} registerId={register.id} tickets={tickets} />
      <CashMovementDialog bankAccounts={bankAccounts} onClose={() => setSheet(null)} open={sheet === "cash"} sessionId={session.id} />
      {editingLine ? (
        <LineEditorSheet
          currencyCode={currencyCode}
          key={editingLine.key}
          line={editingLine}
          onClose={() => setEditingKey(null)}
          onRemove={(key) => { setLines((current) => current.filter((line) => line.key !== key)); setEditingKey(null); }}
          onSave={(key, patch, adjustedGross) => {
            setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
            if (adjustedGross !== null) toast.info(`Con este IVA el precio queda en ${formatMoney(adjustedGross, currencyCode)}.`);
            setEditingKey(null);
          }}
        />
      ) : null}
      <Dialog onClose={() => setSheet(null)} open={sheet === "menu"} title="Más opciones">
        <div className="grid gap-2" data-testid="pos-menu">
          <label className="flex min-h-12 items-center gap-3 border border-window-shadow px-3 text-sm">
            <input checked={autoPrint} className="size-5" onChange={(event) => { setAutoPrint(event.target.checked); window.localStorage.setItem(AUTO_PRINT_KEY, event.target.checked ? "1" : "0"); }} type="checkbox" />
            Imprimir el ticket al cobrar
          </label>
          <Button className="h-12 justify-start" onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => undefined); setSheet(null); }} type="button" variant="outline"><ArrowsOut aria-hidden="true" /> Pantalla completa</Button>
          <Link className={buttonVariants({ className: "h-12 justify-start", variant: "outline" })} href="/pos/sessions"><Receipt aria-hidden="true" /> Cierres de caja anteriores</Link>
          {canManage ? <Link className={buttonVariants({ className: "h-12 justify-start", variant: "outline" })} href="/pos/settings"><GearSix aria-hidden="true" /> Configurar cajas</Link> : null}
          <Link className={buttonVariants({ className: "h-12 justify-start", variant: "outline" })} href="/pos?choose=1">Cambiar de caja</Link>
          <p className="text-xs text-muted-foreground">Con teclado: F2 busca y F9 cobra. Consejo: en la tablet, «Añadir a pantalla de inicio» abre el TPV como una aplicación.</p>
        </div>
      </Dialog>
    </div>
  );
}

function CategoryChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={cn("h-11 shrink-0 snap-start border-2 px-4 font-mono text-sm font-bold", active ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} onClick={onClick} type="button">
      {label}
    </button>
  );
}
