import { HttpError } from "@/lib/http";

/**
 * Error de regla contable/fiscal con mensaje en español pensado para el usuario.
 * Extiende `HttpError`, así que `handleRouteError` lo traduce a su estado HTTP
 * sin filtrar mensajes internos.
 *
 * - 409: conflicto con el estado actual (periodo bloqueado, ejercicio cerrado, ya conciliado…).
 * - 422: la operación es válida sintácticamente pero incumple una regla contable (descuadre, cuenta inexistente…).
 * - 404: entidad inexistente o de otra empresa.
 * - 400: dato de entrada incoherente con el estado (p. ej. importe mayor que lo pendiente).
 */
export class AccountingRuleError extends HttpError {
  readonly code: string;

  constructor(status: 400 | 404 | 409 | 422, code: string, message: string) {
    super(status, message);
    this.name = "AccountingRuleError";
    this.code = code;
  }
}

export function isAccountingRuleError(error: unknown): error is AccountingRuleError {
  return error instanceof AccountingRuleError;
}
