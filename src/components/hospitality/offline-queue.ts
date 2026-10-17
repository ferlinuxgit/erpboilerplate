"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Cola del TPV para cortes de conexión: lo que el camarero pide sin red se guarda en el dispositivo y
 * se envía solo, en orden, al volver. Cada operación lleva una clave para que el servidor no la
 * aplique dos veces si la respuesta se perdió por el camino. Cobrar no entra en la cola: necesita red.
 */

export type QueuedRequest = { id: string; url: string; method: string; body: unknown; label: string; createdAt: number };
export type FlushResult = { sent: number; failed: Array<{ label: string; message: string }> };

const KEY = "erp:pos:offline-queue";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedList: QueuedRequest[] = [];
let flushing: Promise<FlushResult> | null = null;

class HttpStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readQueue(): QueuedRequest[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    cachedList = raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  } catch {
    cachedList = [];
  }
  return cachedList;
}

function writeQueue(list: QueuedRequest[]) {
  if (list.length === 0) window.localStorage.removeItem(KEY);
  else window.localStorage.setItem(KEY, JSON.stringify(list));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Fallo de red (sin conexión, servidor inalcanzable o reiniciándose), no un error de la operación. */
export function isConnectionError(error: unknown) {
  if (error instanceof HttpStatusError) return error.status === 502 || error.status === 503 || error.status === 504;
  return error instanceof TypeError;
}

async function send<T>(request: { id: string; url: string; method: string; body: unknown }): Promise<T> {
  const { getCsrfHeader } = await import("@/lib/csrf-client");
  const { readApiError } = await import("@/components/ui/form");
  const response = await fetch(request.url, { method: request.method, headers: { "Content-Type": "application/json", "x-request-key": request.id, ...getCsrfHeader() }, body: JSON.stringify(request.body) });
  if (!response.ok) throw new HttpStatusError(await readApiError(response, "No se pudo completar la operación."), response.status);
  return (response.status === 204 ? null : await response.json()) as T;
}

/**
 * Envía una operación del TPV; si no hay conexión la guarda para más tarde. Si ya hay operaciones en
 * cola, esta va detrás para respetar el orden (añadir y luego enviar a cocina).
 */
export async function sendOrQueue<T>(url: string, body: unknown, method = "POST", label = "Operación"): Promise<{ queued: true } | { queued: false; result: T }> {
  const request = { id: crypto.randomUUID(), url, method, body, label, createdAt: Date.now() };
  const pending = readQueue();
  if (!navigator.onLine || pending.length > 0) {
    writeQueue([...pending, request]);
    if (navigator.onLine) void flushQueue();
    return { queued: true };
  }
  try {
    return { queued: false, result: await send<T>(request) };
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    writeQueue([...readQueue(), request]);
    return { queued: true };
  }
}

/** Envía la cola en orden. Para al primer fallo de red; descarta (y avisa) lo que el servidor rechace. */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const result: FlushResult = { sent: 0, failed: [] };
    for (;;) {
      const [next] = readQueue();
      if (!next) break;
      try {
        await send(next);
        result.sent += 1;
      } catch (error) {
        if (isConnectionError(error)) break;
        result.failed.push({ label: next.label, message: error instanceof Error ? error.message : "Rechazado por el servidor." });
      }
      writeQueue(readQueue().filter((entry) => entry.id !== next.id));
    }
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

const getServerSnapshot = () => 0;
const getOnlineServer = () => true;

/** Solo el estado (conexión y operaciones guardadas), sin reenviar. */
export function usePosConnectionState() {
  const pending = useSyncExternalStore(subscribe, () => readQueue().length, getServerSnapshot);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, getOnlineServer);
  return { online, pending };
}

/**
 * Estado y reenvío: al recuperar la red y cada 15 s mientras quede algo. Úsalo en un solo sitio por
 * pantalla (el aviso de conexión); el resto, usePosConnectionState.
 */
export function usePosConnection(onFlushed?: (result: FlushResult) => void) {
  const { online, pending } = usePosConnectionState();
  const callback = useRef(onFlushed);
  useEffect(() => {
    callback.current = onFlushed;
  }, [onFlushed]);

  const flush = useCallback(async () => {
    // Si ya hay un envío en marcha, avisa quien lo empezó (no se repite el mensaje).
    if (readQueue().length === 0 || flushing) return;
    const result = await flushQueue();
    if (result.sent > 0 || result.failed.length > 0) callback.current?.(result);
  }, []);

  useEffect(() => {
    if (online && pending > 0) void flush();
    if (pending === 0) return;
    const timer = window.setInterval(() => void flush(), 15_000);
    return () => window.clearInterval(timer);
  }, [flush, online, pending]);

  return { online, pending, flush };
}
