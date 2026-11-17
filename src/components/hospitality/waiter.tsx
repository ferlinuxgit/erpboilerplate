"use client";

import { UserSwitch } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { cn } from "@/lib/utils";

import { KioskAction } from "../pos/kiosk-bar";
import { Keypad } from "../pos/keypad";

export type Waiter = { userId: string; name: string };

const KEY = "erp:pos:waiter";
const LOCK_KEY = "erp:pos:waiter-lock";
const ACTIVE_KEY = "erp:pos:waiter-active";
export const LOCK_OPTIONS = [0, 2, 5, 10] as const;

/** Minutos sin tocar la tablet tras los que se vuelve a pedir el PIN (0 = nunca). Es de cada dispositivo. */
export function readLockMinutes() {
  const value = Number(window.localStorage.getItem(LOCK_KEY));
  return (LOCK_OPTIONS as readonly number[]).includes(value) ? value : 0;
}

function markActive() {
  window.localStorage.setItem(ACTIVE_KEY, String(Date.now()));
}

function expired(lockMinutes: number) {
  const last = Number(window.localStorage.getItem(ACTIVE_KEY)) || 0;
  return lockMinutes > 0 && Date.now() - last > lockMinutes * 60_000;
}

/**
 * Camarero activo en este dispositivo (tablet compartida): se cambia con su PIN. Si el dispositivo
 * tiene bloqueo, tras unos minutos sin usarlo se cierra solo y hay que volver a poner el PIN (nadie
 * cobra ni pide a nombre de otro).
 */
export function useWaiter() {
  const [waiter, setWaiterState] = useState<Waiter | null>(null);
  const [lockMinutes, setLockMinutes] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const minutes = readLockMinutes();
      setLockMinutes(minutes);
      try {
        const stored = window.localStorage.getItem(KEY);
        if (stored && expired(minutes)) window.localStorage.removeItem(KEY);
        else setWaiterState(stored ? JSON.parse(stored) as Waiter : null);
      } catch {
        setWaiterState(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!waiter || lockMinutes === 0) return;
    markActive();
    let last = 0;
    const touch = () => {
      // Como mucho una escritura cada pocos segundos.
      if (Date.now() - last > 5000) {
        last = Date.now();
        markActive();
      }
    };
    const check = window.setInterval(() => {
      if (!expired(lockMinutes)) return;
      window.localStorage.removeItem(KEY);
      setWaiterState(null);
      toast.info("Tablet bloqueada por inactividad: pon tu PIN para seguir.");
    }, 10_000);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.clearInterval(check);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [waiter, lockMinutes]);
  const setWaiter = (next: Waiter | null) => {
    setWaiterState(next);
    if (next) {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      markActive();
    } else window.localStorage.removeItem(KEY);
  };
  const changeLock = (minutes: number) => {
    window.localStorage.setItem(LOCK_KEY, String(minutes));
    setLockMinutes(minutes);
  };
  return { waiter, setWaiter, lockMinutes, setLockMinutes: changeLock };
}

/**
 * Botón de la barra con el camarero activo; al tocarlo pide el PIN del que va a atender. Con bloqueo
 * activo y nadie identificado, el teclado del PIN se abre solo.
 */
export function WaiterButton({ lockMinutes = 0, onChange, onLockChange, waiter }: { lockMinutes?: number; onChange: (waiter: Waiter | null) => void; onLockChange?: (minutes: number) => void; waiter: Waiter | null }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const show = open || (lockMinutes > 0 && !waiter && !dismissed);
  return (
    <>
      <KioskAction data-testid="pos-waiter-button" icon={<UserSwitch aria-hidden="true" className="size-5" />} label={waiter ? `Camarero: ${waiter.name}` : "Identificarse con PIN"} onClick={() => setOpen(true)}>
        {waiter ? waiter.name.split(" ")[0] : "Camarero"}
      </KioskAction>
      {show ? <PinDialog lockMinutes={lockMinutes} onClose={() => { setOpen(false); setDismissed(true); }} onLockChange={onLockChange} onVerified={(next) => { onChange(next); setOpen(false); setDismissed(false); }} onLogout={waiter ? () => { onChange(null); setOpen(false); setDismissed(true); } : undefined} /> : null}
    </>
  );
}

function PinDialog({ lockMinutes, onClose, onLockChange, onLogout, onVerified }: { lockMinutes: number; onClose: () => void; onLockChange?: (minutes: number) => void; onLogout?: () => void; onVerified: (waiter: Waiter) => void }) {
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
        {onLockChange ? (
          <div className="space-y-1 border-t border-window-shadow pt-3">
            <p className="font-mono text-xs font-bold uppercase text-muted-foreground">En este dispositivo, pedir el PIN tras</p>
            <div className="grid grid-cols-4 gap-1" role="radiogroup">
              {LOCK_OPTIONS.map((minutes) => (
                <button aria-checked={lockMinutes === minutes} className={cn("h-11 border-2 font-mono text-sm font-bold", lockMinutes === minutes ? "border-primary bg-primary text-primary-foreground" : "border-window-dark-shadow bg-window-panel")} data-testid={`pos-waiter-lock-${minutes}`} key={minutes} onClick={() => onLockChange(minutes)} role="radio" type="button">{minutes === 0 ? "Nunca" : `${minutes} min`}</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Sin tocar la tablet ese tiempo, se cierra la sesión del camarero.</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** PIN de un encargado para autorizar una anulación (lo comprueba el servidor al hacerla). */
export function ManagerPinDialog({ description, onClose, onConfirm }: { description: string; onClose: () => void; onConfirm: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  return (
    <Dialog description={description} onClose={onClose} open title="Autoriza un encargado">
      <div className="mx-auto max-w-xs space-y-3" data-testid="pos-manager-pin-dialog">
        <p aria-label="PIN del encargado" className="flex h-14 items-center justify-center gap-3 border-2 border-window-dark-shadow bg-white font-mono text-3xl tracking-[0.5em]">
          {pin.replace(/\d/g, "•") || <span className="text-base tracking-normal text-muted-foreground">PIN encargado</span>}
        </p>
        <Keypad
          onKey={(key) => {
            if (key === "⌫") return setPin((current) => current.slice(0, -1));
            if (key === ",") return;
            setPin(`${pin}${key}`.slice(0, 6));
          }}
        />
        <Button className="h-14 w-full text-lg" data-testid="pos-manager-pin-confirm" disabled={pin.length < 4} onClick={() => onConfirm(pin)} type="button">Autorizar</Button>
      </div>
    </Dialog>
  );
}
