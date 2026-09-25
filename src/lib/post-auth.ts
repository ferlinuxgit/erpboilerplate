import type { AppRole } from "@/lib/rbac";
import { safeNextPath } from "@/lib/auth-client";

export const ONBOARDING_PATH = "/onboarding";
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";

export type PostAuthMembershipState = {
  role: AppRole;
  /** El asistente se completó o el usuario lo pospuso: nunca volvemos a redirigir. */
  onboardingSettled: boolean;
  /** La empresa ya tiene los datos fiscales mínimos para facturar. */
  companyReady: boolean;
} | null;

/**
 * Destino tras iniciar sesión, registrarse o verificar el correo.
 *
 * - Un `next` seguro (p. ej. `/invitations/…`) siempre gana.
 * - Un usuario sin espacio de trabajo es un alta nueva: al asistente de puesta en marcha.
 * - Un propietario cuya empresa no está configurada y que no ha completado ni pospuesto
 *   el asistente va al asistente. Posponerlo lo marca como resuelto: no hay bucles.
 * - El resto, al panel.
 */
export function decidePostAuthDestination(input: { nextPath?: unknown; membership: PostAuthMembershipState }) {
  const next = safeNextPath(input.nextPath);
  if (next && next !== DEFAULT_AUTHENTICATED_PATH) return next;
  const membership = input.membership;
  if (!membership) return ONBOARDING_PATH;
  if (membership.role === "OWNER" && !membership.onboardingSettled && !membership.companyReady) return ONBOARDING_PATH;
  return DEFAULT_AUTHENTICATED_PATH;
}
