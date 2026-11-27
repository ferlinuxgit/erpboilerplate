"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getCountryFiscalProfile } from "@/lib/country-packs/profile";

type Alert = { problems: string[]; href: string } | null;

/** Cuánto vale una respuesta en el navegador: el aviso no necesita ser instantáneo. */
export const VERIFACTU_ALERT_TTL_MS = 5 * 60_000;

// Una consulta por empresa cada pocos minutos, compartida por todas las pantallas de la sesión.
const cached = new Map<string, { at: number; alert: Promise<Alert> }>();

function loadAlert(companyId: string): Promise<Alert> {
  const hit = cached.get(companyId);
  if (hit && Date.now() - hit.at < VERIFACTU_ALERT_TTL_MS) return hit.alert;
  const alert = fetch("/api/verifactu/health")
    .then((response) => (response.ok ? (response.json() as Promise<{ alert: Alert }>) : null))
    .then((payload) => {
      // Un aviso que no carga no debe estorbar: no se guarda y se reintenta en la siguiente pantalla.
      if (!payload) cached.delete(companyId);
      return payload?.alert ?? null;
    })
    .catch(() => {
      cached.delete(companyId);
      return null;
    });
  cached.set(companyId, { at: Date.now(), alert });
  return alert;
}

/** Texto del aviso: «VERI*FACTU: a, b y c.» */
export function verifactuAlertText(problems: readonly string[]) {
  if (problems.length === 0) return "";
  const list = problems.length === 1 ? problems[0] : `${problems.slice(0, -1).join(", ")} y ${problems.at(-1)}`;
  return `VERI*FACTU: ${list}.`;
}

/**
 * Aviso discreto en todas las pantallas cuando VERI*FACTU tiene un problema grave (facturas sin
 * enviar desde hace más de una hora, rechazadas o certificado caducado), con enlace a
 * Fiscalidad › VERI*FACTU. Solo se consulta en empresas de países con facturación verificable.
 */
export function VerifactuHealthBanner({ companyId, countryCode, pathname }: { companyId?: string; countryCode?: string; pathname: string }) {
  const applies = Boolean(companyId) && getCountryFiscalProfile(countryCode).features.eInvoicing === "verifactu";
  const [state, setState] = useState<{ companyId: string; alert: Alert } | null>(null);

  useEffect(() => {
    if (!applies || !companyId) return;
    let cancelled = false;
    void loadAlert(companyId).then((alert) => {
      if (!cancelled) setState({ companyId, alert });
    });
    return () => {
      cancelled = true;
    };
    // `pathname`: al cambiar de pantalla se revisa si la respuesta guardada ha caducado.
  }, [applies, companyId, pathname]);

  const alert = applies && state && state.companyId === companyId ? state.alert : null;
  if (!alert || alert.problems.length === 0 || pathname.startsWith(alert.href)) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive bg-destructive/10 px-3 py-1.5 font-mono text-xs text-danger-text"
      data-testid="verifactu-health-banner"
      role="status"
    >
      <span>{verifactuAlertText(alert.problems)}</span>
      <Link className="font-bold underline underline-offset-2" href={alert.href}>Ver en Fiscalidad › VERI*FACTU</Link>
    </div>
  );
}
