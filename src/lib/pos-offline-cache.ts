/** Al cerrar sesión: borra las pantallas del TPV guardadas para abrirlas sin conexión y la cola pendiente. */
export function clearPosOfflineData() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("erp:pos:offline-queue");
  navigator.serviceWorker?.controller?.postMessage("clear-pos-cache");
  if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("pages-")).map((key) => caches.delete(key))));
}
