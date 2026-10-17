/*
 * Service worker del TPV: guarda las pantallas del TPV (/pos…) y los ficheros de la aplicación para
 * que, si se va la conexión, se puedan volver a abrir y seguir tomando nota (lo pedido se guarda en el
 * dispositivo y se envía al volver). No guarda nada de la API ni pantallas fuera del TPV.
 */
const VERSION = "pos-v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const MAX_PAGES = 40;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.endsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trimPages() {
  const cache = await caches.open(PAGE_CACHE);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(key);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Ficheros con huella (no cambian): primero la caché.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  // Pantallas del TPV: primero la red (siempre al día); sin red, la última copia guardada.
  if (request.mode === "navigate" && url.pathname.startsWith("/pos") && !url.pathname.startsWith("/pos/tickets")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected) {
          const cache = await caches.open(PAGE_CACHE);
          await cache.put(request, response.clone());
          void trimPages();
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request, { cacheName: PAGE_CACHE });
        if (cached) return cached;
        throw error;
      }
    })());
  }
});

// Al cerrar sesión la aplicación pide borrar las pantallas guardadas.
self.addEventListener("message", (event) => {
  if (event.data === "clear-pos-cache") event.waitUntil(caches.delete(PAGE_CACHE));
});
