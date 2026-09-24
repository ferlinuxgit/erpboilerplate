export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Convierte el rechazo de una promesa en un valor para poder traducirlo a una
 * respuesta HTTP (p. ej. con `handleRouteError`) sin envolver bloques largos en
 * `try/catch`.
 */
export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}
