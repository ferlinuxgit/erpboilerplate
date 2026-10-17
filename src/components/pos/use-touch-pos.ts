"use client";

import { useEffect } from "react";

/** Mantiene la pantalla encendida mientras la caja está abierta (tablet o móvil en el mostrador). */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      } catch {
        lock = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}

/** Pequeña vibración al tocar (Android); en el resto no hace nada. */
export function tapFeedback() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(12);
}
