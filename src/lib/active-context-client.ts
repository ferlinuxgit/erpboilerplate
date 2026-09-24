"use client";

export type CompanyOption = {
  id: string;
  name: string;
  baseCurrencyCode: string;
};

export type FiscalYearOption = {
  id: string;
  code: string;
};

export type ActiveContextPayload = {
  active: {
    companyId: string;
    fiscalYearId: string;
  };
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

export function invalidateActiveContext() {
  pending = null;
}
