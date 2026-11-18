"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ActiveContextPayload } from "@/lib/active-context-client";

const TRIAL_WARNING_DAYS = 5;

/**
 * Aviso de cobro en todas las pantallas: la prueba que termina pronto, un pago fallido o la cuenta
 * en solo lectura, con el enlace a Facturación. No se muestra en la propia página de Facturación.
 */
export function BillingBanner({ billing, pathname }: { billing: ActiveContextPayload["billing"]; pathname: string }) {
  if (!billing || pathname.startsWith("/billing")) return null;
  const daysLeft = billing.trialDaysLeft;
  const trialEnding = billing.state === "trial" && daysLeft !== null && daysLeft <= TRIAL_WARNING_DAYS;
  const urgent = billing.readOnly || billing.state === "grace";
  if (!urgent && !trialEnding) return null;
  const text = trialEnding
    ? `Tu prueba gratuita termina ${daysLeft! <= 1 ? "mañana" : `en ${daysLeft} días`}. Elige tu plan para seguir trabajando sin interrupciones.`
    : billing.message ?? "Revisa tu suscripción.";
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 font-mono text-xs", urgent ? "border-destructive bg-destructive/10 text-danger-text" : "border-info bg-info/10 text-info-text")}
      data-testid="billing-banner"
      role={urgent ? "alert" : "status"}
    >
      <span>{text}</span>
      <Link className="font-bold underline underline-offset-2" href="/billing">{billing.state === "suspended" ? "Ver detalles" : "Ir a Plan y facturación"}</Link>
    </div>
  );
}
