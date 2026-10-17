/**
 * Rutas del TPV en modo mostrador (sin el menú del ERP): la caja (/pos/<caja>, /close), la cuenta de
 * una mesa (/pos/<caja>/orders/<cuenta>) y la pantalla de cocina (/pos/kitchen).
 */
export function isPosKioskRoute(pathname: string) {
  return /^\/pos\/(?!sessions(\/|$)|settings(\/|$)|tickets(\/|$))[^/]+(\/close|\/orders\/[^/]+)?\/?$/.test(pathname);
}
