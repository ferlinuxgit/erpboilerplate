"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";

type CompanyOption = {
  id: string;
  name: string;
  baseCurrencyCode: string;
};

type FiscalYearOption = {
  id: string;
  code: string;
};

type ActiveContextPayload = {
  active: {
    companyId: string;
    fiscalYearId: string;
  };
  availableCompanies: CompanyOption[];
  availableFiscalYears: FiscalYearOption[];
};

export function ActiveContextSwitcher() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearOption[]>([]);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/context/active");
      if (!response.ok) {
        setLoading(false);
        return;
      }
      const payload = (await response.json()) as ActiveContextPayload;
      setCompanies(payload.availableCompanies);
      setFiscalYears(payload.availableFiscalYears);
      setCompanyId(payload.active.companyId);
      setFiscalYearId(payload.active.fiscalYearId);
      setLoading(false);
    };
    void load();
  }, []);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Contexto...</p>;
  }

  return (
    <div className="space-y-1">
      <select
        aria-label="Empresa activa"
        className="h-8 w-full rounded-md border px-2 text-sm"
        onChange={(event) => setCompanyId(event.target.value)}
        value={companyId}
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Ejercicio fiscal activo"
        className="h-8 w-full rounded-md border px-2 text-sm"
        onChange={(event) => setFiscalYearId(event.target.value)}
        value={fiscalYearId}
      >
        {fiscalYears.map((fiscalYear) => (
          <option key={fiscalYear.id} value={fiscalYear.id}>
            {fiscalYear.code}
          </option>
        ))}
      </select>
      <button
        className="w-full rounded-md border px-2 py-1 text-xs hover:bg-muted"
        onClick={async () => {
          const response = await fetch("/api/context/active", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ companyId, fiscalYearId }),
          });
          if (response.ok) {
            router.refresh();
          }
        }}
        type="button"
      >
        Aplicar
      </button>
    </div>
  );
}
