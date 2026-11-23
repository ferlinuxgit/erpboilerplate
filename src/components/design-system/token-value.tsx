"use client";

import { useSyncExternalStore } from "react";

/** Se vuelve a leer cuando cambia el tema (atributo data-theme o clase dark de <html>). */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => observer.disconnect();
}

/** Valor real de una variable CSS en el tema activo (p. ej. «#000080»). */
export function TokenValue({ name }: { name: string }) {
  const value = useSyncExternalStore(
    subscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    () => "",
  );
  return <span className="font-mono text-xs tabular-nums text-muted-foreground">{value || "—"}</span>;
}
