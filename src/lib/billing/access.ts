import { PAST_DUE_GRACE_DAYS, TENANT_DELETION_GRACE_DAYS, isPaidModule } from "@/lib/billing/catalog";
import { MODULE_IDS, type ModuleId } from "@/modules/registry";

/**
 * Qué puede hacer un espacio según su prueba, su suscripción y su estado en la plataforma (código
 * puro y probado; lo aplica la guarda de cada petición).
 *
 * - Prueba en curso, cortesía o cobro desactivado → todo.
 * - Suscripción activa (o impagada dentro del periodo de gracia) → el plan base y los módulos
 *   contratados.
 * - Prueba terminada, suscripción cancelada o impagada pasada la gracia → solo lectura: se puede
 *   consultar y exportar (los libros son del cliente) pero no crear ni modificar.
 * - Suspendido por la plataforma → nada.
 */

export type BillingState = "disabled" | "exempt" | "trial" | "active" | "grace" | "past_due" | "trial_expired" | "canceled" | "suspended" | "closing";

export type BillingAccessInput = {
  /** El cobro está activo en esta instalación (Stripe configurado). */
  enforced: boolean;
  trialEndsAt: Date | null;
  billingExempt: boolean;
  suspendedAt: Date | null;
  suspendedReason?: string | null;
  /** Baja solicitada: solo lectura durante el periodo de gracia (se puede anular). */
  deletionRequestedAt?: Date | null;
  subscription: { status: string; addons: readonly string[]; pastDueSince: Date | null; currentPeriodEndsAt: Date | null } | null;
};

export type BillingAccess = {
  state: BillingState;
  /** Se puede consultar pero no crear ni modificar. */
  readOnly: boolean;
  /** No se puede usar nada (suspendido). */
  blocked: boolean;
  /** Módulos opcionales que puede usar. */
  modules: ReadonlySet<ModuleId>;
  trialEndsAt: Date | null;
  /** Fin de la gracia de un pago fallido. */
  graceEndsAt: Date | null;
  message: string | null;
};

const ALL_MODULES: ReadonlySet<ModuleId> = new Set(MODULE_IDS);
const NO_MODULES: ReadonlySet<ModuleId> = new Set();
const PAYING = new Set(["ACTIVE", "TRIALING"]);
/** Suscripción terminada (las demás sin pagar —NONE, INCOMPLETE, PAUSED— cuentan como no contratada). */
const ENDED = new Set(["CANCELED", "UNPAID", "INCOMPLETE_EXPIRED"]);

function access(state: BillingState, modules: ReadonlySet<ModuleId>, extra: Partial<BillingAccess> = {}): BillingAccess {
  return { state, readOnly: false, blocked: false, modules, trialEndsAt: null, graceEndsAt: null, message: null, ...extra };
}

export function computeBillingAccess(input: BillingAccessInput, now = new Date()): BillingAccess {
  const trialEndsAt = input.trialEndsAt;
  if (input.suspendedAt) {
    return access("suspended", NO_MODULES, { readOnly: true, blocked: true, message: `Esta cuenta está suspendida${input.suspendedReason ? `: ${input.suspendedReason}` : ""}. Escríbenos para resolverlo.` });
  }
  if (input.deletionRequestedAt) {
    const purgeAt = new Date(input.deletionRequestedAt.getTime() + TENANT_DELETION_GRACE_DAYS * 86_400_000);
    return access("closing", ALL_MODULES, {
      readOnly: true,
      trialEndsAt,
      message: `Has solicitado la baja: los datos se borrarán a partir del ${purgeAt.toLocaleDateString("es-ES")}. Descárgalos antes o anula la baja en Configuración › Cuenta y datos.`,
    });
  }
  if (!input.enforced) return access("disabled", ALL_MODULES, { trialEndsAt });
  if (input.billingExempt) return access("exempt", ALL_MODULES, { trialEndsAt });

  const subscription = input.subscription;
  const status = subscription?.status.toUpperCase() ?? null;
  const paidModules: ReadonlySet<ModuleId> = new Set((subscription?.addons ?? []).filter(isPaidModule));
  if (status && PAYING.has(status)) return access("active", paidModules, { trialEndsAt });
  if (status === "PAST_DUE") {
    const since = subscription?.pastDueSince ?? now;
    const graceEndsAt = new Date(since.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000);
    if (graceEndsAt > now) {
      return access("grace", paidModules, { trialEndsAt, graceEndsAt, message: "No hemos podido cobrar tu suscripción. Actualiza el método de pago para no perder el acceso." });
    }
    return access("past_due", NO_MODULES, { readOnly: true, trialEndsAt, graceEndsAt, message: "Tu suscripción está impagada: puedes consultar y exportar, pero no crear ni modificar. Actualiza el método de pago en Facturación." });
  }

  // Sin suscripción que pague (o a medio contratar): vale la prueba mientras dure.
  if (trialEndsAt && trialEndsAt > now) return access("trial", ALL_MODULES, { trialEndsAt });
  const canceled = Boolean(status && ENDED.has(status));
  return access(canceled ? "canceled" : "trial_expired", NO_MODULES, {
    readOnly: true,
    trialEndsAt,
    message: canceled
      ? "Tu suscripción ha terminado: puedes consultar y exportar tus datos, pero no crear ni modificar. Reactívala en Facturación."
      : "Tu prueba gratuita ha terminado: puedes consultar y exportar tus datos. Elige tu plan en Facturación para seguir trabajando.",
  });
}

/** Rutas que se pueden usar aunque la cuenta esté en solo lectura (cobro, sesión, exportar…). */
const READ_ONLY_ALLOWED = [/^\/api\/tenant\/deletion$/, /^\/api\/billing(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/context(\/|$)/, /^\/api\/oauth(\/|$)/, /^\/api\/mcp$/, /\/export(\/|$)/, /^\/api\/account(\/|$)/, /^\/api\/tenant\/export(\/|$)/];

export function isUnsafeMethod(method: string | null | undefined) {
  return Boolean(method) && !["GET", "HEAD", "OPTIONS"].includes(method!.toUpperCase());
}

/** Una petición que la cuenta no puede hacer en su estado actual (null si puede). */
export function billingDenial(billing: BillingAccess, path: string | null, method: string | null): { status: number; message: string } | null {
  if (billing.blocked) return { status: 403, message: billing.message ?? "Esta cuenta está suspendida." };
  if (!billing.readOnly || !path || !path.startsWith("/api/") || !isUnsafeMethod(method)) return null;
  if (READ_ONLY_ALLOWED.some((pattern) => pattern.test(path))) return null;
  return { status: 402, message: billing.message ?? "Tu cuenta está en modo solo lectura." };
}
