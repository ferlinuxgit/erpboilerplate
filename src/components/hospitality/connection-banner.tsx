"use client";

import { ArrowsClockwise, WifiSlash } from "@phosphor-icons/react";
import { useEffect } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { usePosConnection, type FlushResult } from "./offline-queue";

/** Avisa de un corte: lo pedido queda guardado en este dispositivo y se enviará solo. */
export function ConnectionBanner({ onSynced }: { onSynced?: () => void }) {
  const { online, pending, flush } = usePosConnection((result: FlushResult) => {
    if (result.sent > 0) toast.success(result.sent === 1 ? "Enviado lo que estaba pendiente." : `Enviadas ${result.sent} operaciones pendientes.`);
    for (const failure of result.failed) toast.error(`${failure.label}: ${failure.message}`);
    onSynced?.();
  });
  usePosServiceWorker();
  if (online && pending === 0) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-semibold", online ? "bg-warning/30 text-warning-text" : "bg-destructive text-destructive-foreground")} data-testid="pos-connection-banner" role="status">
      {online ? <ArrowsClockwise aria-hidden="true" className="size-5 shrink-0 animate-spin" /> : <WifiSlash aria-hidden="true" className="size-5 shrink-0" />}
      <span className="min-w-0 flex-1">
        {online
          ? `Enviando ${pending} ${pending === 1 ? "operación guardada" : "operaciones guardadas"}…`
          : `Sin conexión.${pending > 0 ? ` ${pending} ${pending === 1 ? "operación guardada" : "operaciones guardadas"} en este dispositivo.` : ""} Sigue tomando nota: se enviará solo al volver. Para cobrar hace falta conexión.`}
      </span>
      {online && pending > 0 ? <button className="h-9 shrink-0 border border-current px-2 text-xs" onClick={() => void flush()} type="button">Reintentar</button> : null}
    </div>
  );
}

/** Registra el service worker que guarda las pantallas del TPV para abrirlas sin conexión. */
function usePosServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
}
