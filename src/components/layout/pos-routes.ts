/** Rutas de la caja del TPV en modo mostrador (sin el menú del ERP): /pos/<caja> y /pos/<caja>/close. */
export function isPosKioskRoute(pathname: string) {
  return /^\/pos\/(?!sessions(\/|$)|settings(\/|$)|tickets(\/|$))[^/]+(\/close)?\/?$/.test(pathname);
}
