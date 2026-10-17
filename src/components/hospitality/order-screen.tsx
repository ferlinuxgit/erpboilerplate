"use client";

import { ArrowsLeftRight, BellRinging, CheckCircle, DotsThreeVertical, PaperPlaneTilt, Printer, Receipt, SquaresFour, Users, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatElapsed, lineStatusLabels, minutesSince, type BillPart, type LineStatus } from "@/modules/hospitality/model";
import { grossPrice, netFromGross } from "@/modules/pos/model";

import { FreeAmountSheet } from "../pos/free-amount-sheet";
import { KioskAction, KioskBar } from "../pos/kiosk-bar";
import { PaymentDialog, type PaymentChoice } from "../pos/payment-dialog";
import { PosCatalogPanel } from "../pos/pos-catalog-panel";
import { openTicketPrint, type PosCatalogItem } from "../pos/types";
import { tapFeedback, useWakeLock } from "../pos/use-touch-pos";
import { MoveDialog, type MoveAction } from "./move-dialog";
import { OrderLineSheet } from "./order-line-sheet";
import { SplitDialog } from "./split-dialog";
import { postJson, type OrderData, type OrderLineView } from "./types";
import { usePolling } from "./use-polling";
import { useWaiter, WaiterButton } from "./waiter";

const PRINT_KITCHEN_KEY = "erp:pos:print-kitchen";

const statusTone: Record<LineStatus, string> = {
  PENDING: "border-destructive text-destructive",
  SENT: "border-info text-info-text",
  READY: "border-success bg-success text-white",
  SERVED: "border-window-dark-shadow text-muted-foreground",
  CANCELLED: "border-window-dark-shadow text-muted-foreground line-through",
};

type Paid = { invoiceId: string; number: string; total: number; change: number; closed: boolean; pending: number };

/**
 * Cuenta de una mesa: se añaden productos por rondas (varios camareros a la vez, se sincroniza sola),
 * se envían a cocina y barra, se pide la cuenta y se cobra entera, a partes iguales o por productos.
 */
export function OrderScreen({ cardEnabled, catalog, currencyCode, initial }: { cardEnabled: boolean; catalog: PosCatalogItem[]; currencyCode: string; initial: OrderData }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const { data: order, setData: setOrder, refresh } = usePolling<OrderData>(`/api/pos/hospitality/orders/${initial.id}`, initial, 5000, busy > 0);
  const { waiter, setWaiter } = useWaiter();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [view, setView] = useState<"catalog" | "order">("catalog");
  const [sheet, setSheet] = useState<null | "free" | "split" | "pay" | "move" | "more">(null);
  const [editing, setEditing] = useState<OrderLineView | null>(null);
  const [part, setPart] = useState<{ part: BillPart; amount: number } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [printKitchen, setPrintKitchen] = useState(false);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  useWakeLock(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setPrintKitchen(window.localStorage.getItem(PRINT_KITCHEN_KEY) === "1"), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const closed = order.status === "PAID" || order.status === "CANCELLED";
  const activeLines = order.lines.filter((line) => line.status !== "CANCELLED");
  const unsent = order.lines.filter((line) => line.status === "PENDING");
  const sent = order.lines.filter((line) => line.status !== "PENDING");
  const ready = order.lines.filter((line) => line.status === "READY");
  const inCart = useMemo(() => {
    const byItem = new Map<string, number>();
    for (const line of activeLines) if (line.itemId) byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.quantity);
    return byItem;
  }, [activeLines]);

  /** Operaciones en serie (los toques rápidos no se pisan) y recarga al terminar. */
  function run<T>(work: () => Promise<T>, success?: (result: T) => void) {
    setBusy((count) => count + 1);
    chain.current = chain.current.then(async () => {
      try {
        const result = await work();
        success?.(result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo completar la operación.");
      } finally {
        await refresh();
        setBusy((count) => count - 1);
      }
    });
  }

  function addProduct(input: { itemId: string | null; description: string; unitPrice: number; taxRate: number; taxId: string | null }) {
    if (closed) return;
    tapFeedback();
    // Optimista: la línea aparece al instante; el servidor la agrupa con la misma sin enviar.
    setOrder((current) => {
      const same = current.lines.find((line) => line.status === "PENDING" && line.itemId === input.itemId && line.unitPrice === input.unitPrice && !line.note && line.description === input.description);
      const lines = same
        ? current.lines.map((line) => (line === same ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current.lines, { id: `tmp-${crypto.randomUUID()}`, orderId: current.id, itemId: input.itemId, description: input.description, quantity: 1, unitPrice: input.unitPrice, taxRate: input.taxRate, taxId: input.taxId, note: null, station: "NONE" as const, status: "PENDING" as const, paidQuantity: 0, sentAt: null, createdAt: new Date().toISOString(), addedByName: waiter?.name ?? null }];
      return { ...current, lines, status: "OPEN" };
    });
    setFlash({ id: Date.now(), text: `+1 ${input.description}` });
    run(() => postJson(`/api/pos/hospitality/orders/${order.id}/lines`, { waiterUserId: waiter?.userId ?? null, lines: [{ ...input, quantity: 1 }] }));
  }

  function send() {
    if (unsent.length === 0) return;
    run(() => postJson<{ batches: Array<{ id: string; station: string }> }>(`/api/pos/hospitality/orders/${order.id}/send`, {}), (result) => {
      toast.success(result.batches.length > 0 ? `Enviado a ${result.batches.map((batch) => (batch.station === "KITCHEN" ? "cocina" : "barra")).join(" y ")}.` : "Marcado como servido.");
      if (printKitchen) for (const batch of result.batches) window.open(`/pos/tickets/kitchen/${batch.id}?print=1`, "_blank", "noopener,width=420,height=600");
    });
  }

  function requestBill() {
    run(() => postJson(`/api/pos/hospitality/orders/${order.id}/bill`, {}), () => {
      window.open(`/pos/tickets/order/${order.id}?print=1`, "_blank", "noopener,width=420,height=720");
    });
  }

  async function pay(choice: PaymentChoice) {
    if (!part) return;
    setPaying(true);
    try {
      const result = await postJson<Paid>(`/api/pos/hospitality/orders/${order.id}/pay`, {
        clientRequestId: requestId,
        part: part.part,
        payment: { cash: choice.cash, card: choice.card, cashReceived: choice.cashReceived },
        tipAmount: choice.tipAmount ?? 0,
        waiterUserId: waiter?.userId ?? null,
      });
      setPaid(result);
      setSheet(null);
      setPart(null);
      setRequestId(crypto.randomUUID());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cobrar.");
    } finally {
      setPaying(false);
    }
  }

  function move(action: MoveAction) {
    setSheet(null);
    const url = action.kind === "move" ? "move" : action.kind === "merge" ? "merge" : "transfer";
    run(() => postJson<{ id: string }>(`/api/pos/hospitality/orders/${order.id}/${url}`, action.kind === "move" ? { tableId: action.tableId } : action.kind === "merge" ? { targetOrderId: action.targetOrderId } : { tableId: action.tableId, lines: action.lines }), (result) => {
      toast.success(action.kind === "move" ? "Cuenta movida." : action.kind === "merge" ? "Mesas juntadas." : "Productos traspasados.");
      if (action.kind === "merge") router.replace(`/pos/${order.registerId}/orders/${result.id}`);
    });
  }

  const opened = minutesSince(order.openedAt);
  const status = `${order.guests} ${order.guests === 1 ? "comensal" : "comensales"} · ${formatElapsed(opened)}${order.waiterName ? ` · ${order.waiterName}` : ""}`;

  return (
    <div className="flex h-dvh flex-col bg-background [touch-action:manipulation]" data-testid="pos-order-screen">
      <KioskBar backHref={`/pos/${order.registerId}`} backLabel="Mesas" status={status} title={order.name}>
        <WaiterButton onChange={setWaiter} waiter={waiter} />
        {!closed ? (
          <>
            <KioskAction data-testid="pos-order-bill" icon={<Printer aria-hidden="true" className="size-5" />} label="Pedir la cuenta (pre-cuenta)" onClick={requestBill}>Pre-cuenta</KioskAction>
            <KioskAction data-testid="pos-order-move" icon={<ArrowsLeftRight aria-hidden="true" className="size-5" />} label="Mover o juntar" onClick={() => setSheet("move")}>Mover</KioskAction>
            <KioskAction icon={<DotsThreeVertical aria-hidden="true" className="size-5" />} label="Más opciones" onClick={() => setSheet("more")}>Más</KioskAction>
          </>
        ) : null}
      </KioskBar>

      {paid || closed ? (
        <div className="m-auto w-full max-w-md space-y-4 p-6 text-center" data-testid="pos-order-closed" role="status">
          <CheckCircle aria-hidden="true" className="mx-auto size-14 text-success" />
          <p className="font-mono text-lg font-bold">{order.status === "CANCELLED" ? "Cuenta cerrada sin cobrar" : paid && !paid.closed ? `Cobrado ${formatMoney(paid.total, currencyCode)}` : `${order.name} cobrada`}</p>
          {paid?.change ? <p className="font-mono text-4xl font-black">Cambio {formatMoney(paid.change, currencyCode)}</p> : null}
          {paid && !paid.closed ? <p className="font-mono text-base">Queda por cobrar <strong data-testid="pos-order-remaining">{formatMoney(paid.pending, currencyCode)}</strong></p> : null}
          <div className="grid grid-cols-2 gap-2">
            {paid ? <Button className="h-14" data-testid="pos-order-print-ticket" onClick={() => openTicketPrint(paid.invoiceId)} type="button" variant="outline"><Printer aria-hidden="true" /> Ticket</Button> : <span />}
            {paid && !paid.closed ? (
              <Button className="h-14" data-testid="pos-order-continue" onClick={() => setPaid(null)} type="button">Siguiente cobro</Button>
            ) : (
              <Link className="flex h-14 items-center justify-center border-2 border-primary bg-primary font-mono font-bold text-primary-foreground" data-testid="pos-order-back" href={`/pos/${order.registerId}`}>Volver a mesas</Link>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_22rem] lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
          <PosCatalogPanel catalog={catalog} className={cn("md:flex", view === "catalog" ? "flex" : "hidden")} currencyCode={currencyCode} inCart={inCart} onAdd={(entry) => addProduct({ itemId: entry.id, description: entry.name, unitPrice: entry.unitPrice, taxRate: entry.taxRate, taxId: entry.taxId })} onFreeAmount={() => setSheet("free")} ref={searchRef} />

          <section aria-label="Cuenta" className={cn("min-h-0 flex-col border-window-shadow md:flex md:border-l", view === "order" ? "flex" : "hidden")}>
            <ol className="min-h-0 flex-1 divide-y divide-window-shadow overflow-y-auto overscroll-contain pb-24 md:pb-0" data-testid="pos-order-lines">
              {activeLines.length === 0 && order.lines.length === 0 ? <li className="p-8 text-center text-sm text-muted-foreground">Toca productos para añadirlos a la cuenta.</li> : null}
              {unsent.length > 0 ? <li className="bg-destructive/10 px-3 py-1 font-mono text-[11px] font-bold uppercase text-destructive">Sin enviar ({unsent.length})</li> : null}
              {unsent.map((line) => <LineRow currencyCode={currencyCode} key={line.id} line={line} onEdit={() => !line.id.startsWith("tmp-") && setEditing(line)} />)}
              {sent.length > 0 ? <li className="bg-window-panel px-3 py-1 font-mono text-[11px] font-bold uppercase text-muted-foreground">Pedido</li> : null}
              {sent.map((line) => <LineRow currencyCode={currencyCode} key={line.id} line={line} onEdit={() => line.status !== "CANCELLED" && setEditing(line)} />)}
            </ol>
            <div className="space-y-2 border-t border-window-shadow p-3">
              {ready.length > 0 ? <p className="flex items-center gap-1 text-sm font-bold text-success-text"><BellRinging aria-hidden="true" className="size-4" />{ready.length} {ready.length === 1 ? "plato listo" : "platos listos"} para servir</p> : null}
              <div className="flex items-baseline justify-between font-mono">
                <span className="text-sm">{order.amounts.paid > 0 ? `Cobrado ${formatMoney(order.amounts.paid, currencyCode)} · pendiente` : "Total"}</span>
                <span className="text-3xl font-black tabular-nums" data-testid="pos-order-pending">{formatMoney(order.amounts.pending, currencyCode)}</span>
              </div>
              {order.equalSplit ? <p className="text-xs text-muted-foreground">Pagando a partes iguales: parte {order.equalSplit.paid + 1} de {order.equalSplit.parts}.</p> : null}
              <div className="hidden grid-cols-2 gap-2 md:grid">
                <Button className="h-16 text-lg" data-testid="pos-order-send" disabled={unsent.length === 0 || busy > 0} onClick={send} type="button" variant={unsent.length > 0 ? "default" : "outline"}><PaperPlaneTilt aria-hidden="true" /> Enviar{unsent.length > 0 ? ` (${unsent.length})` : ""}</Button>
                <Button className="h-16 text-lg" data-testid="pos-order-charge" disabled={order.amounts.pending <= 0 || busy > 0} onClick={() => setSheet("split")} type="button" variant={unsent.length > 0 ? "outline" : "default"}>Cobrar</Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {flash ? <p aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto w-fit max-w-[90vw] truncate bg-black/80 px-3 py-1.5 font-mono text-sm text-white md:hidden" key={flash.id}>{flash.text}</p> : null}

      {!paid && !closed ? (
        <nav aria-label="Cuenta" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-t border-window-dark-shadow bg-window-surface p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden" data-testid="pos-order-mobile-bar">
          <button aria-label={view === "catalog" ? "Ver cuenta" : "Ver productos"} className="relative flex h-14 w-16 flex-col items-center justify-center border border-window-dark-shadow bg-window-panel font-mono text-[11px] font-bold" data-testid="pos-order-toggle-view" onClick={() => setView(view === "catalog" ? "order" : "catalog")} type="button">
            {view === "catalog" ? <Receipt aria-hidden="true" className="size-6" /> : <SquaresFour aria-hidden="true" className="size-6" />}
            {view === "catalog" ? "Cuenta" : "Productos"}
            {view === "catalog" && unsent.length > 0 ? <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-destructive px-1 text-center text-xs text-white">{unsent.length}</span> : null}
          </button>
          <button className="min-w-0 text-left" onClick={() => setView("order")} type="button">
            <span className="block font-mono text-[11px] uppercase text-muted-foreground">{order.name}</span>
            <span className="block truncate font-mono text-xl font-black tabular-nums">{formatMoney(order.amounts.pending, currencyCode)}</span>
          </button>
          <Button aria-label="Enviar a cocina" className="h-14 px-3" data-testid="pos-order-send-mobile" disabled={unsent.length === 0 || busy > 0} onClick={send} type="button" variant={unsent.length > 0 ? "default" : "outline"}><PaperPlaneTilt aria-hidden="true" className="size-5" /></Button>
          <Button className="h-14 px-4" data-testid="pos-order-charge-mobile" disabled={order.amounts.pending <= 0 || busy > 0} onClick={() => setSheet("split")} type="button">Cobrar</Button>
        </nav>
      ) : null}

      <FreeAmountSheet onAdd={({ description, gross, taxRate }) => { setSheet(null); addProduct({ itemId: null, description, unitPrice: netFromGross(gross, taxRate).net, taxRate, taxId: null }); }} onClose={() => setSheet(null)} open={sheet === "free"} />
      {sheet === "split" ? <SplitDialog currencyCode={currencyCode} onClose={() => setSheet(null)} onContinue={(nextPart, amount) => { setPart({ part: nextPart, amount }); setSheet("pay"); }} order={order} /> : null}
      <PaymentDialog
        allowTip
        cardEnabled={cardEnabled}
        currencyCode={currencyCode}
        key={requestId + String(sheet === "pay")}
        onClose={() => setSheet(null)}
        onConfirm={(choice) => void pay(choice)}
        open={sheet === "pay" && part !== null}
        pending={paying}
        title={`Cobrar ${order.name}`}
        total={part?.amount ?? 0}
      />
      {sheet === "move" ? <MoveDialog onClose={() => setSheet(null)} onConfirm={move} order={order} registerId={order.registerId} /> : null}
      {editing ? (
        <OrderLineSheet
          currencyCode={currencyCode}
          key={editing.id}
          line={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const lineId = editing.id;
            setEditing(null);
            run(() => postJson(`/api/pos/hospitality/lines/${lineId}`, patch, "PATCH"));
          }}
        />
      ) : null}
      {sheet === "more" ? <MoreDialog onCancel={(reason) => { setSheet(null); run(() => postJson(`/api/pos/hospitality/orders/${order.id}/cancel`, { reason }), () => toast.success("Cuenta cerrada sin cobrar.")); }} onClose={() => setSheet(null)} onGuests={(guests) => { setSheet(null); run(() => postJson(`/api/pos/hospitality/orders/${order.id}`, { guests }, "PATCH")); }} order={order} printKitchen={printKitchen} setPrintKitchen={(value) => { setPrintKitchen(value); window.localStorage.setItem(PRINT_KITCHEN_KEY, value ? "1" : "0"); }} /> : null}
    </div>
  );
}

function LineRow({ currencyCode, line, onEdit }: { currencyCode: string; line: OrderLineView; onEdit: () => void }) {
  const total = Math.round(grossPrice(line.unitPrice, line.taxRate) * line.quantity * 100) / 100;
  return (
    <li data-testid="pos-order-line">
      <button aria-label={`Editar ${line.description}`} className={cn("flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left hover:bg-window-highlight", line.status === "CANCELLED" && "opacity-60")} onClick={onEdit} type="button">
        <span className={cn("min-w-8 font-mono text-base font-black", line.status === "CANCELLED" && "line-through")}>{line.quantity.toLocaleString("es-ES")}×</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-semibold", line.status === "CANCELLED" && "line-through")}>{line.description}</span>
          {line.note ? <span className="block truncate text-xs italic text-link">{line.note}</span> : null}
          <span className="mt-0.5 flex items-center gap-1">
            <span className={cn("border px-1 font-mono text-[10px] font-bold uppercase", statusTone[line.status])}>{lineStatusLabels[line.status]}</span>
            {line.paidQuantity > 0 ? <span className="font-mono text-[10px] text-success-text">cobrado {line.paidQuantity.toLocaleString("es-ES")}</span> : null}
          </span>
        </span>
        <span className="font-mono text-base font-bold tabular-nums">{formatMoney(total, currencyCode)}</span>
      </button>
    </li>
  );
}

function MoreDialog({ onCancel, onClose, onGuests, order, printKitchen, setPrintKitchen }: { onCancel: (reason: string) => void; onClose: () => void; onGuests: (guests: number) => void; order: OrderData; printKitchen: boolean; setPrintKitchen: (value: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [guests, setGuests] = useState(order.guests);
  const canCancel = order.amounts.paid === 0;
  return (
    <Dialog onClose={onClose} open title={order.name}>
      <div className="space-y-4" data-testid="pos-order-more">
        <div className="space-y-1">
          <p className="font-mono text-xs font-bold uppercase text-muted-foreground">Comensales</p>
          <div className="flex items-center gap-2">
            <Button aria-label="Un comensal menos" className="size-12" disabled={guests <= 1} onClick={() => setGuests((current) => current - 1)} type="button" variant="outline">−</Button>
            <span className="flex w-16 items-center justify-center gap-1 font-mono text-2xl font-black"><Users aria-hidden="true" className="size-5" />{guests}</span>
            <Button aria-label="Un comensal más" className="size-12" onClick={() => setGuests((current) => current + 1)} type="button" variant="outline">+</Button>
            <Button className="h-12 flex-1" disabled={guests === order.guests} onClick={() => onGuests(guests)} type="button">Guardar</Button>
          </div>
        </div>
        <label className="flex min-h-12 items-center gap-3 border border-window-shadow px-3 text-sm">
          <input checked={printKitchen} className="size-5" onChange={(event) => setPrintKitchen(event.target.checked)} type="checkbox" />
          Imprimir las comandas al enviar (en este dispositivo)
        </label>
        {canCancel ? (
          <div className="space-y-1 border-t border-window-shadow pt-3">
            <p className="font-mono text-xs font-bold uppercase text-destructive">Cerrar sin cobrar</p>
            <Input className="h-12 text-base" maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Motivo (se equivocaron de mesa, invitación…)" value={reason} />
            <Button className="h-12 w-full" data-testid="pos-order-cancel" onClick={() => onCancel(reason)} type="button" variant="outline"><X aria-hidden="true" /> Cerrar la cuenta sin cobrar</Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
