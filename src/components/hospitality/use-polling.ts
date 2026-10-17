"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Datos que comparten varios dispositivos (mesas, cuenta, cocina): se recargan cada pocos segundos
 * mientras la pantalla está visible y al volver a ella. `pause` evita pisar cambios locales en curso.
 */
export function usePolling<T>(url: string, initial: T, intervalMs = 4000, pause = false) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const pauseRef = useRef(pause);
  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json() as T);
      setError(null);
    } catch {
      setError("Sin conexión: se reintentará.");
    }
  }, [url]);

  useEffect(() => {
    const tick = () => {
      if (!pauseRef.current && document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, refresh]);

  return { data, setData, refresh, error };
}
