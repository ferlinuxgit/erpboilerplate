"use client";

import { ArrowsOut, Barcode, CashRegister, Minus, Plus, Printer, Receipt, Trash, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartTotals, exceedsSimplifiedLimit, grossPrice, netFromGross, type CartLine } from "@/modules/pos/model";

import { CashMovementDialog } from "./cash-movement-dialog";
import { PaymentDialog, type PaymentChoice } from "./payment-dialog";
import { TicketsDialog } from "./tickets-dialog";
import { openTicketPrint, type PosCatalogItem, type PosCustomer, type PosRegisterView, type PosSessionView, type PosTicketView } from "./types";

const VAT_RATES = [21, 10, 4, 0];
const AUTO_PRINT_KEY = "erp:pos:auto-print";

type LastSale = { invoiceId: string; number: string; total: number; change: number; warnings: string[] };

const priceText = (value: number) => value.toFixed(2).replace(".", ",");

/**
 * Pantalla de venta: catálogo con buscador (también lector de códigos: escribe la referencia y pulsa
 * Intro), carrito con precios IVA incluido y cobro. F2 busca, F9 cobra.
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
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<PosCustomer[]>([]);
  const [showCustomer, setShowCustomer] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [freeLine, setFreeLine] = useState({ description: "", price: "", taxRate: "21" });
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setAutoPrint(window.localStorage.getItem(AUTO_PRINT_KEY) === "1"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const categories = useMemo(() => [...new Set(catalog.map((entry) => entry.categoryName).filter((name): name is string => Boolean(name)))], [catalog]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-ES");
    return catalog
      .filter((entry) => !category || entry.categoryName === category)
      .filter((entry) => !normalized || entry.name.toLocaleLowerCase("es-ES").includes(normalized) || entry.sku.toLocaleLowerCase("es-ES").includes(normalized))
      .slice(0, 120);
  }, [catalog, category, query]);
  const totals = useMemo(() => cartTotals(lines), [lines]);
  const overLimit = !customer && exceedsSimplifiedLimit(totals.total, register.simplifiedLimit);
  const saleCount = tickets.filter((ticket) => ticket.kind === "SALE").length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "F9" && lines.length > 0 && !payOpen) {
        event.preventDefault();
        if (!overLimit) setPayOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines.length, overLimit, payOpen]);

  useEffect(() => {
    const term = customerQuery.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/pos/customers?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() as Promise<PosCustomer[]> : []))
        .then(setCustomerResults)
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerQuery]);

  function addItem(entry: PosCatalogItem) {
    setLastSale(null);
    setLines((current) => {
      const existing = current.find((line) => line.itemId === entry.id && line.unitPrice === entry.unitPrice);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, { key: crypto.randomUUID(), itemId: entry.id, description: entry.name, quantity: 1, unitPrice: entry.unitPrice, taxRate: entry.taxRate, taxId: entry.taxId }];
    });
  }

  function addFreeLine(event: React.FormEvent) {
    event.preventDefault();
    const gross = parseDecimalInput(freeLine.price, { maximumFractionDigits: 2 });
    if (!freeLine.description.trim() || gross === null || gross <= 0) {
      toast.error("Escribe el concepto y su precio (IVA incluido).");
      return;
    }
    const taxRate = Number(freeLine.taxRate);
    const { net } = netFromGross(gross, taxRate);
    setLastSale(null);
    setLines((current) => [...current, { key: crypto.randomUUID(), itemId: null, description: freeLine.description.trim(), quantity: 1, unitPrice: net, taxRate, taxId: null }]);
    setFreeLine({ description: "", price: "", taxRate: freeLine.taxRate });
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

  function setQuantity(key: string, quantity: number) {
    setLines((current) => current.flatMap((line) => (line.key !== key ? [line] : quantity <= 0 ? [] : [{ ...line, quantity: Math.round(quantity * 1000) / 1000 }])));
  }

  function setGross(key: string, raw: string) {
    const gross = parseDecimalInput(raw, { maximumFractionDigits: 2 });
    if (gross === null || gross < 0) return;
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const result = netFromGross(gross, line.taxRate);
      if (!result.exact) toast.info(`Con IVA del ${line.taxRate} % el precio queda en ${formatMoney(result.gross, currencyCode)}.`);
      return { ...line, unitPrice: result.net };
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
      setPayOpen(false);
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
    searchRef.current?.focus();
  }

  return (
    <div className="space-y-2" data-testid="pos-terminal">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-window-shadow bg-window-panel px-2 py-1.5">
        <p className="flex items-center gap-2 font-mono text-xs font-bold">
          <CashRegister aria-hidden="true" className="size-4 text-link" /> {register.name}
          <span className="font-normal text-muted-foreground">· abierta {new Date(session.openedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {saleCount} {saleCount === 1 ? "ticket" : "tickets"}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          <Button data-testid="pos-open-tickets" onClick={() => setTicketsOpen(true)} size="sm" type="button" variant="outline"><Receipt aria-hidden="true" /> Tickets</Button>
          <Button onClick={() => setCashOpen(true)} size="sm" type="button" variant="outline">Entrada/salida de efectivo</Button>
          <Link className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="pos-close-link" href={`/pos/${register.id}/close`}>Cerrar caja</Link>
          {canManage ? <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/pos/settings">Configurar</Link> : null}
          <Button aria-label="Pantalla completa" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} size="icon-sm" title="Pantalla completa" type="button" variant="ghost"><ArrowsOut aria-hidden="true" /></Button>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,5fr)]">
        {/* Catálogo */}
        <section aria-label="Catálogo" className="space-y-2 border border-window-shadow bg-card p-2">
          <div className="relative">
            <Barcode aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar artículo o leer código"
              autoFocus
              className="pl-8"
              data-testid="pos-search"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchEnter}
              placeholder="Buscar artículo o leer código (F2)"
              ref={searchRef}
              value={query}
            />
          </div>
          {categories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              <Button onClick={() => setCategory(null)} size="sm" type="button" variant={category === null ? "default" : "outline"}>Todo</Button>
              {categories.map((name) => <Button key={name} onClick={() => setCategory(name)} size="sm" type="button" variant={category === name ? "default" : "outline"}>{name}</Button>)}
            </div>
          ) : null}
          {visibleItems.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{catalog.length === 0 ? "No hay artículos en el catálogo: añade conceptos libres abajo o da de alta artículos." : "Sin resultados."}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4" data-testid="pos-catalog">
              {visibleItems.map((entry) => (
                <li key={entry.id}>
                  <button
                    className="flex h-full min-h-20 w-full flex-col justify-between border border-window-dark-shadow bg-window-panel p-2 text-left shadow-raised hover:bg-window-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:translate-y-px"
                    data-testid={`pos-item-${entry.sku}`}
                    onClick={() => addItem(entry)}
                    type="button"
                  >
                    <span className="line-clamp-2 text-xs font-semibold">{entry.name}</span>
                    <span className="mt-1 flex items-end justify-between gap-1">
                      <span className="font-mono text-sm font-bold tabular-nums">{formatMoney(grossPrice(entry.unitPrice, entry.taxRate), currencyCode)}</span>
                      {entry.stock !== null ? <span className={cn("font-mono text-[10px]", entry.stock <= 0 ? "font-bold text-destructive" : "text-muted-foreground")}>{entry.stock.toLocaleString("es-ES")} ud</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="grid grid-cols-[minmax(0,1fr)_6rem_5rem_auto] items-end gap-1 border-t border-window-shadow pt-2" data-testid="pos-free-line" onSubmit={addFreeLine}>
            <label className="grid gap-0.5 text-[11px] font-medium">Concepto libre<Input onChange={(event) => setFreeLine((current) => ({ ...current, description: event.target.value }))} placeholder="Varios, servicio…" value={freeLine.description} /></label>
            <label className="grid gap-0.5 text-[11px] font-medium">PVP<Input inputMode="decimal" onChange={(event) => setFreeLine((current) => ({ ...current, price: event.target.value }))} placeholder="0,00" value={freeLine.price} /></label>
            <label className="grid gap-0.5 text-[11px] font-medium">IVA
              <Select onChange={(event) => setFreeLine((current) => ({ ...current, taxRate: event.target.value }))} value={freeLine.taxRate}>
                {VAT_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}
              </Select>
            </label>
            <Button aria-label="Añadir concepto" type="submit" variant="outline"><Plus aria-hidden="true" /></Button>
          </form>
        </section>

        {/* Ticket */}
        <section aria-label="Ticket" className="flex flex-col border border-window-shadow bg-card lg:sticky lg:top-12 lg:max-h-[calc(100dvh-4rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-window-shadow p-2">
            <button className="flex min-w-0 items-center gap-1 text-left text-xs" data-testid="pos-customer-button" onClick={() => setShowCustomer((current) => !current)} type="button">
              <User aria-hidden="true" className="size-4 shrink-0 text-link" />
              <span className="truncate">{customer ? <><strong>{customer.name}</strong>{customer.taxId ? ` · ${customer.taxId}` : ""}</> : "Cliente: sin identificar (ticket)"}</span>
            </button>
            {customer ? <Button aria-label="Quitar cliente" onClick={() => setCustomer(null)} size="icon-xs" type="button" variant="ghost"><X aria-hidden="true" /></Button> : null}
          </div>
          {showCustomer ? (
            <div className="space-y-1 border-b border-window-shadow p-2">
              <Input aria-label="Buscar cliente" autoFocus onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nombre o NIF del cliente (factura completa)" value={customerQuery} />
              <ul className="max-h-40 overflow-y-auto">
                {customerQuery.trim().length >= 2 ? customerResults.map((entry) => (
                  <li key={entry.id}><button className="w-full px-1 py-1 text-left text-xs hover:bg-window-highlight" onClick={() => { setCustomer(entry); setShowCustomer(false); setCustomerQuery(""); }} type="button">{entry.name}{entry.taxId ? <span className="text-muted-foreground"> · {entry.taxId}</span> : null}</button></li>
                )) : null}
              </ul>
            </div>
          ) : null}
          <ol className="min-h-40 flex-1 divide-y divide-window-shadow overflow-y-auto" data-testid="pos-cart">
            {lines.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {lastSale ? null : "Toca un artículo o lee su código para empezar."}
              </li>
            ) : null}
            {lines.map((line) => {
              const lineTotal = totals.lines.find((entry) => entry.key === line.key)?.total ?? 0;
              return (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 p-2 text-xs" data-testid="pos-cart-line" key={line.key}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{line.description}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <Button aria-label={`Quitar una unidad de ${line.description}`} onClick={() => setQuantity(line.key, line.quantity - 1)} size="icon-xs" type="button" variant="outline"><Minus aria-hidden="true" /></Button>
                      <input aria-label={`Cantidad de ${line.description}`} className="h-6 w-12 border border-window-dark-shadow bg-window-panel text-center font-mono" inputMode="decimal" onChange={(event) => { const value = parseDecimalInput(event.target.value); if (value !== null) setQuantity(line.key, value); }} value={line.quantity.toLocaleString("es-ES")} />
                      <Button aria-label={`Añadir una unidad de ${line.description}`} onClick={() => setQuantity(line.key, line.quantity + 1)} size="icon-xs" type="button" variant="outline"><Plus aria-hidden="true" /></Button>
                      <span className="text-muted-foreground">×</span>
                      <input
                        aria-label={`Precio con IVA de ${line.description}`}
                        className="h-6 w-16 border border-window-dark-shadow bg-window-panel text-right font-mono"
                        defaultValue={priceText(grossPrice(line.unitPrice, line.taxRate))}
                        inputMode="decimal"
                        key={`${line.key}-${line.unitPrice}`}
                        onBlur={(event) => setGross(line.key, event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                      />
                      <span className="text-[10px] text-muted-foreground">IVA {line.taxRate} %</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <span className="font-mono font-bold tabular-nums">{formatMoney(lineTotal, currencyCode)}</span>
                    <Button aria-label={`Quitar ${line.description}`} onClick={() => setQuantity(line.key, 0)} size="icon-xs" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                  </div>
                </li>
              );
            })}
          </ol>
          {lastSale && lines.length === 0 ? (
            <div className="space-y-2 border-t border-success/60 bg-success/10 p-3 text-center" data-testid="pos-last-sale" role="status">
              <p className="font-mono text-xs font-bold">Ticket {lastSale.number} cobrado · {formatMoney(lastSale.total, currencyCode)}</p>
              {lastSale.change > 0 ? <p className="font-mono text-2xl font-black">Cambio {formatMoney(lastSale.change, currencyCode)}</p> : null}
              <div className="flex justify-center gap-2">
                <Button data-testid="pos-print-last" onClick={() => openTicketPrint(lastSale.invoiceId)} type="button" variant="outline"><Printer aria-hidden="true" /> Imprimir ticket</Button>
                <Button onClick={newSale} type="button">Nueva venta</Button>
              </div>
            </div>
          ) : null}
          <div className="space-y-1 border-t border-window-shadow p-2">
            {totals.taxBreakdown.length > 1 || totals.tax > 0 ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 font-mono text-[11px] text-muted-foreground">
                {totals.taxBreakdown.map((bucket) => (
                  <div className="contents" key={bucket.rate}><dt>Base {bucket.rate} % {formatMoney(bucket.base, currencyCode)}</dt><dd className="text-right">IVA {formatMoney(bucket.tax, currencyCode)}</dd></div>
                ))}
              </dl>
            ) : null}
            {overLimit ? <p className="text-xs font-bold text-destructive">Supera {formatMoney(register.simplifiedLimit, currencyCode)}: identifica al cliente (con NIF) para hacer factura completa.</p> : null}
            <Button className="h-14 w-full text-lg" data-testid="pos-charge" disabled={lines.length === 0 || overLimit} onClick={() => setPayOpen(true)} type="button">
              Cobrar {formatMoney(totals.total, currencyCode)} <span className="ml-1 text-xs font-normal opacity-80">(F9)</span>
            </Button>
            <label className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <input checked={autoPrint} onChange={(event) => { setAutoPrint(event.target.checked); window.localStorage.setItem(AUTO_PRINT_KEY, event.target.checked ? "1" : "0"); }} type="checkbox" /> Imprimir el ticket al cobrar
            </label>
          </div>
        </section>
      </div>

      <PaymentDialog
        cardEnabled={register.cardEnabled}
        currencyCode={currencyCode}
        key={requestId + String(payOpen)}
        onClose={() => setPayOpen(false)}
        onConfirm={(choice) => void pay(choice)}
        open={payOpen}
        pending={paying}
        total={totals.total}
      />
      <TicketsDialog currencyCode={currencyCode} onClose={() => setTicketsOpen(false)} open={ticketsOpen} registerId={register.id} tickets={tickets} />
      <CashMovementDialog bankAccounts={bankAccounts} onClose={() => setCashOpen(false)} open={cashOpen} sessionId={session.id} />
    </div>
  );
}
