"use client";

import { useEffect } from "react";

/** Abre el diálogo de impresión al cargar (ticket abierto desde el TPV con ?print=1). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [enabled]);
  return null;
}
