"use client";

import { UserSwitch } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";

import { KioskAction } from "../pos/kiosk-bar";
import { Keypad } from "../pos/keypad";

export type Waiter = { userId: string; name: string };

const KEY = "erp:pos:waiter";

/** Camarero activo en este dispositivo (tablet compartida): se cambia con su PIN. */
export function useWaiter() {
  const [waiter, setWaiterState] = useState<Waiter | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(KEY);
        setWaiterState(stored ? JSON.parse(stored) as Waiter : null);
      } catch {
        setWaiterState(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const setWaiter = (next: Waiter | null) => {
    setWaiterState(next);
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  };
  return { waiter, setWaiter };
}

/** Botón de la barra con el camarero activo; al tocarlo pide el PIN del que va a atender. */
export function WaiterButton({ onChange, waiter }: { onChange: (waiter: Waiter | null) => void; waiter: Waiter | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <KioskAction data-testid="pos-waiter-button" icon={<UserSwitch aria-hidden="true" className="size-5" />} label={waiter ? `Camarero: ${waiter.name}` : "Identificarse con PIN"} onClick={() => setOpen(true)}>
        {waiter ? waiter.name.split(" ")[0] : "Camarero"}
      </KioskAction>
      {open ? <PinDialog onClose={() => setOpen(false)} onVerified={(next) => { onChange(next); setOpen(false); }} onLogout={waiter ? () => { onChange(null); setOpen(false); } : undefined} /> : null}
    </>
  );
}

function PinDialog({ onClose, onLogout, onVerified }: { onClose: () => void; onLogout?: () => void; onVerified: (waiter: Waiter) => void }) {
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);

  async function verify(value: string) {
    setPending(true);
    try {
      const response = await fetch("/api/pos/hospitality/staff/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ pin: value }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "PIN incorrecto."));
      const staff = await response.json() as Waiter;
      toast.success(`Hola, ${staff.name.split(" ")[0]}.`);
      onVerified(staff);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PIN incorrecto.");
      setPin("");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog description="Cada camarero tiene su PIN (se configura en las cajas del TPV)." onClose={onClose} open title="¿Quién atiende?">
      <div className="mx-auto max-w-xs space-y-3" data-testid="pos-pin-dialog">
        <p aria-label="PIN" className="flex h-14 items-center justify-center gap-3 border-2 border-window-dark-shadow bg-white font-mono text-3xl tracking-[0.5em]" data-testid="pos-pin-display">
          {pin.replace(/\d/g, "•") || <span className="text-base tracking-normal text-muted-foreground">PIN</span>}
        </p>
        <Keypad
          disabled={pending}
          onKey={(key) => {
            if (key === "⌫") return setPin((current) => current.slice(0, -1));
            if (key === ",") return;
            const next = `${pin}${key}`.slice(0, 6);
            setPin(next);
          }}
        />
        <Button className="h-14 w-full text-lg" data-testid="pos-pin-confirm" disabled={pending || pin.length < 4} onClick={() => void verify(pin)} type="button">Entrar</Button>
        {onLogout ? <Button className="h-12 w-full" onClick={onLogout} type="button" variant="outline">Salir (sin camarero)</Button> : null}
      </div>
    </Dialog>
  );
}
