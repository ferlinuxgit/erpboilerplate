"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

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
  availableFiscalYearsByCompany: Record<string, FiscalYearOption[]>;
};

export function ActiveContextSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearOption[]>([]);
  const [fiscalYearsByCompany, setFiscalYearsByCompany] = useState<Record<string, FiscalYearOption[]>>({});
  const [error, setError] = useState("");

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
      setFiscalYearsByCompany(payload.availableFiscalYearsByCompany);
      setCompanyId(payload.active.companyId);
      setFiscalYearId(payload.active.fiscalYearId);
      setLoading(false);
    };
    void load();
  }, []);

  if (loading) {
    return <p className={compact ? "font-mono text-[0.58rem] text-white/70" : "text-xs text-muted-foreground"}>Cargando contexto…</p>;
  }

  return (
    <div className={compact ? "flex min-w-0 items-center gap-1" : "space-y-1"}>
      <Select
        aria-label="Empresa activa"
        className={compact ? "h-7 w-32 border-white/50 bg-white px-1.5 text-[0.65rem] xl:w-44" : undefined}
        onChange={(event) => {
          const nextCompanyId = event.target.value;
          const nextYears = fiscalYearsByCompany[nextCompanyId] ?? [];
          setCompanyId(nextCompanyId);
          setFiscalYears(nextYears);
          setFiscalYearId(nextYears[0]?.id ?? "");
          setError("");
        }}
        value={companyId}
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Ejercicio fiscal activo"
        className={compact ? "h-7 w-16 border-white/50 bg-white px-1.5 text-[0.65rem]" : undefined}
        onChange={(event) => setFiscalYearId(event.target.value)}
        value={fiscalYearId}
      >
        {fiscalYears.map((fiscalYear) => (
          <option key={fiscalYear.id} value={fiscalYear.id}>
            {fiscalYear.code}
          </option>
        ))}
      </Select>
      <Button
        className={compact ? "h-7 border-white/60 bg-white px-2 text-primary hover:bg-white/90" : "w-full"}
        onClick={async () => {
          setError("");
          const response = await fetch("/api/context/active", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getCsrfHeader() },
            body: JSON.stringify({ companyId, fiscalYearId }),
          });
          if (response.ok) {
            router.refresh();
          } else {
            const payload = await response.json().catch(() => null);
            setError(payload?.message ?? "No se pudo cambiar el contexto.");
          }
        }}
        size={compact ? "xs" : "sm"}
        type="button"
        variant={compact ? "ghost" : "outline"}
      >
        Aplicar
      </Button>
      {error ? <p className={compact ? "max-w-40 truncate font-mono text-[0.58rem] text-warning" : "text-xs text-destructive"} role="alert">{error}</p> : null}
    </div>
  );
}
