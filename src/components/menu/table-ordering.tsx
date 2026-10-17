"use client";

import { BellRinging, CheckCircle, Minus, Plus, Receipt, ShoppingBag, Warning, X } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MENU_TEXT, type MenuLang } from "@/modules/hospitality/menu";

type CartLine = { dishId: string; name: string; price: number; quantity: number; note: string };
type Status = { id: string; token: string; state: "PENDING" | "ACCEPTED" | "REJECTED" | "DONE" } | null;
type Ctx = { lines: CartLine[]; add: (dish: { id: string; name: string; price: number }) => void; change: (dishId: string, delta: number) => void };

const CartContext = createContext<Ctx | null>(null);

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? "No se pudo enviar.";
  } catch {
    return "No se pudo enviar.";
  }
}

/**
 * Servicio en mesa desde el QR: llamar al camarero, pedir la cuenta y pedir platos. El pedido lo
 * confirma el camarero (salvo que el local lo mande directo a cocina).
 */
export function TableOrderProvider({ children, currency, lang, ordering, service, slug, tableId }: { children: ReactNode; currency: string; lang: MenuLang; ordering: boolean; service: boolean; slug: string; tableId: string }) {
  const text = MENU_TEXT[lang];
  const storageKey = `menu-cart:${slug}:${tableId}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setLines(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as CartLine[]);
      } catch {
        setLines([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  // Mientras el pedido está pendiente, se consulta si el camarero lo ha confirmado.
  useEffect(() => {
    if (!status || status.state !== "PENDING") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/public/menu/requests/${status.id}?token=${encodeURIComponent(status.token)}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as { status: "PENDING" | "ACCEPTED" | "REJECTED" | "DONE" };
      if (body.status !== "PENDING") {
        setStatus({ ...status, state: body.status });
        setMessage(body.status === "REJECTED" ? { tone: "error", text: text.orderRejected } : { tone: "ok", text: text.orderAccepted });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status, text.orderAccepted, text.orderRejected]);

  function save(next: CartLine[]) {
    setLines(next);
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
  }
  const add = (dish: { id: string; name: string; price: number }) => {
    const current = lines.find((line) => line.dishId === dish.id);
    save(current ? lines.map((line) => (line.dishId === dish.id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line)) : [...lines, { dishId: dish.id, name: dish.name, price: dish.price, quantity: 1, note: "" }]);
  };
  const change = (dishId: string, delta: number) => save(lines.flatMap((line) => (line.dishId !== dishId ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: Math.min(20, line.quantity + delta) }])));

  async function send(kind: "ORDER" | "CALL" | "BILL") {
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/public/menu/${slug}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId, kind, items: kind === "ORDER" ? lines.map((line) => ({ dishId: line.dishId, quantity: line.quantity, note: line.note || null })) : [] }) });
      if (!response.ok) {
        setMessage({ tone: "error", text: await readError(response) });
        return;
      }
      const body = (await response.json()) as { id: string; token: string | null; status: "PENDING" | "ACCEPTED" };
      if (kind === "ORDER") {
        save([]);
        setOpen(false);
        if (body.token) setStatus({ id: body.id, token: body.token, state: body.status });
        setMessage({ tone: "ok", text: body.status === "ACCEPTED" ? text.orderDirect : text.orderSent });
      } else {
        setMessage({ tone: "ok", text: kind === "CALL" ? text.waiterCalled : text.billRequested });
      }
    } catch {
      setMessage({ tone: "error", text: "Sin conexión. Inténtalo de nuevo." });
    } finally {
      setSending(false);
    }
  }

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = Math.round(lines.reduce((sum, line) => sum + line.price * line.quantity, 0) * 100) / 100;
  const money = (value: number) => formatMoney(value, currency, lang === "en" ? "en-IE" : "es-ES");

  return (
    <CartContext.Provider value={{ lines, add, change }}>
      <div className="space-y-3">
      {service ? (
        <div className="grid grid-cols-2 gap-2" data-testid="table-service">
          <Button className="h-12" data-testid="table-call-waiter" disabled={sending} onClick={() => void send("CALL")} type="button" variant="outline"><BellRinging aria-hidden="true" className="size-5" /> {text.callWaiter}</Button>
          <Button className="h-12" data-testid="table-ask-bill" disabled={sending} onClick={() => void send("BILL")} type="button" variant="outline"><Receipt aria-hidden="true" className="size-5" /> {text.askBill}</Button>
        </div>
      ) : null}
      {message ? (
        <p className={cn("flex items-center gap-2 border-2 p-2 text-sm font-semibold", message.tone === "ok" ? "border-success bg-success/10" : "border-destructive bg-destructive/10 text-destructive")} data-testid="table-message" role="status">
          {message.tone === "ok" ? <CheckCircle aria-hidden="true" className="size-5 shrink-0" weight="fill" /> : <Warning aria-hidden="true" className="size-5 shrink-0" />}{message.text}
        </p>
      ) : null}
      {children}
      {ordering && count > 0 ? (
        <div className="sticky bottom-0 z-20 -mx-3 border-t-2 border-window-dark-shadow bg-window-surface px-3 py-2 sm:-mx-5 sm:px-5" data-testid="table-cart">
          {open ? (
            <div className="mb-2 max-h-[50dvh] space-y-2 overflow-y-auto">
              <p className="flex items-center justify-between font-mono text-sm font-black">{text.yourOrder}<button aria-label="Cerrar" className="grid size-9 place-items-center" onClick={() => setOpen(false)} type="button"><X aria-hidden="true" className="size-5" /></button></p>
              {lines.map((line) => (
                <div className="space-y-1 border-b border-window-shadow pb-2" key={line.dishId}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{line.name}</span>
                    <button aria-label={`${text.remove} 1`} className="grid size-9 place-items-center border-2 border-window-dark-shadow" onClick={() => change(line.dishId, -1)} type="button"><Minus aria-hidden="true" className="size-4" /></button>
                    <span className="w-6 text-center font-mono font-black">{line.quantity}</span>
                    <button aria-label={`${text.add} 1`} className="grid size-9 place-items-center border-2 border-window-dark-shadow" onClick={() => change(line.dishId, 1)} type="button"><Plus aria-hidden="true" className="size-4" /></button>
                    <span className="w-16 text-right font-mono text-sm tabular-nums">{money(line.price * line.quantity)}</span>
                  </div>
                  <Input aria-label={`${text.noteFor} · ${line.name}`} className="h-9 text-sm" maxLength={120} onChange={(event) => save(lines.map((entry) => (entry.dishId === line.dishId ? { ...entry, note: event.target.value } : entry)))} placeholder={text.noteFor} value={line.note} />
                </div>
              ))}
            </div>
          ) : null}
          {open ? (
            <Button className="h-14 w-full text-lg" data-testid="table-send-order" disabled={sending} onClick={() => void send("ORDER")} type="button">{text.sendOrder} · {money(total)}</Button>
          ) : (
            <Button className="h-14 w-full text-lg" data-testid="table-view-order" onClick={() => setOpen(true)} type="button"><ShoppingBag aria-hidden="true" className="size-5" /> {text.viewOrder} ({count}) · {money(total)}</Button>
          )}
        </div>
      ) : null}
      </div>
    </CartContext.Provider>
  );
}

/** Botón «Añadir» de un plato (o cuántos lleva ya en el pedido). */
export function AddToOrder({ dish, lang }: { dish: { id: string; name: string; price: number }; lang: MenuLang }) {
  const cart = useContext(CartContext);
  if (!cart) return null;
  const quantity = cart.lines.find((line) => line.dishId === dish.id)?.quantity ?? 0;
  if (quantity === 0) return <Button className="h-10 shrink-0" data-testid="table-add" onClick={() => cart.add(dish)} size="sm" type="button" variant="outline"><Plus aria-hidden="true" /> {MENU_TEXT[lang].add}</Button>;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button aria-label={`${MENU_TEXT[lang].remove} 1`} className="grid size-9 place-items-center border-2 border-window-dark-shadow" onClick={() => cart.change(dish.id, -1)} type="button"><Minus aria-hidden="true" className="size-4" /></button>
      <span className="w-6 text-center font-mono font-black" data-testid="table-qty">{quantity}</span>
      <button aria-label={`${MENU_TEXT[lang].add} 1`} className="grid size-9 place-items-center border-2 border-primary bg-primary text-primary-foreground" onClick={() => cart.add(dish)} type="button"><Plus aria-hidden="true" className="size-4" /></button>
    </span>
  );
}
