"use client";

import { useEffect, useState } from "react";

export type CompanyOption = {
  id: string;
  name: string;
  baseCurrencyCode: string;
};

export type FiscalYearOption = {
  id: string;
  code: string;
};

export type TenantOption = {
  id: string;
  name: string;
  role: string;
};

export type ActiveContextPayload = {
  active: {
    tenantId?: string;
    companyId: string;
    fiscalYearId: string;
  };
  /** Espacios de trabajo (tenants) del usuario. Puede faltar en respuestas antiguas. */
  availableTenants?: TenantOption[];
  /** Qué vende la empresa activa ("products" | "services" | "both"). */
  businessType?: string;
  availableCompanies: CompanyOption[];
  availableFiscalYears: FiscalYearOption[];
  availableFiscalYearsByCompany: Record<string, FiscalYearOption[]>;
  user: {
    name: string;
    email: string;
    role: string;
  };
};

// The shell renders several consumers of the active context (header switcher,
// mobile drawer switcher, sidebar user panel). Share one in-flight request.
let pending: Promise<ActiveContextPayload | null> | null = null;

export function loadActiveContext() {
  pending ??= fetch("/api/context/active")
    .then((response) => (response.ok ? (response.json() as Promise<ActiveContextPayload>) : null))
    .catch(() => null)
    .then((payload) => {
      if (!payload) pending = null;
      return payload;
    });
  return pending;
}

const INVALIDATED_EVENT = "erp:active-context-invalidated";

/** Olvida el contexto cacheado; los componentes montados con `useActiveContext` lo recargan. */
export function invalidateActiveContext() {
  pending = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INVALIDATED_EVENT));
}

/** Contexto activo (empresa, ejercicio, rol, tipo de negocio) compartido por el shell. */
export function useActiveContext(enabled = true) {
  const [payload, setPayload] = useState<ActiveContextPayload | null>(null);
  useEffect(() => {
    // Fuera de la app (login, registro): se descarta la caché para no mezclar usuarios al volver.
    if (!enabled) {
      pending = null;
      return;
    }
    let cancelled = false;
    const load = () => {
      void loadActiveContext().then((next) => {
        if (!cancelled && next) setPayload(next);
      });
    };
    load();
    window.addEventListener(INVALIDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(INVALIDATED_EVENT, load);
    };
  }, [enabled]);
  return payload;
}
