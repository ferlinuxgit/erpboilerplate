"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  invalidateActiveContext,
  loadActiveContext,
  type CompanyOption,
  type FiscalYearOption,
} from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function ActiveContextSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [appliedContext, setAppliedContext] = useState({ companyId: "", fiscalYearId: "" });
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearOption[]>([]);
  const [fiscalYearsByCompany, setFiscalYearsByCompany] = useState<Record<string, FiscalYearOption[]>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadActiveContext().then((payload) => {
      if (cancelled) return;
      if (payload) {
        setCompanies(payload.availableCompanies);
        setFiscalYears(payload.availableFiscalYears);
        setFiscalYearsByCompany(payload.availableFiscalYearsByCompany);
        setCompanyId(payload.active.companyId);
        setFiscalYearId(payload.active.fiscalYearId);
        setAppliedContext(payload.active);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className={compact ? "font-mono text-[0.65rem] text-chrome-active-foreground/75" : "text-xs text-muted-foreground"}>Cargando contexto…</p>;
  }

  const hasPendingChange = companyId !== appliedContext.companyId || fiscalYearId !== appliedContext.fiscalYearId;

  return (
    <div className={compact ? "flex min-w-0 items-center gap-1" : "space-y-1"}>
      <Select
        aria-label="Empresa activa"
        className={compact ? "h-7 w-32 border-white/50 bg-window-highlight px-1.5 text-[0.7rem] text-window-text xl:w-44" : undefined}
        disabled={saving}
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
        className={compact ? "h-7 w-16 border-white/50 bg-window-highlight px-1.5 text-[0.7rem] text-window-text" : undefined}
        disabled={saving}
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
        aria-busy={saving || undefined}
        className={compact ? "h-7 border-white/60 bg-window-highlight px-2 text-window-text hover:bg-window-surface" : "w-full"}
        disabled={saving || !hasPendingChange || !fiscalYearId}
        onClick={async () => {
          setError("");
          setSaving(true);
          try {
            const response = await fetch("/api/context/active", {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...getCsrfHeader() },
              body: JSON.stringify({ companyId, fiscalYearId }),
            });
            if (response.ok) {
              invalidateActiveContext();
              setAppliedContext({ companyId, fiscalYearId });
              const companyName = companies.find((company) => company.id === companyId)?.name;
              const fiscalYearCode = fiscalYears.find((fiscalYear) => fiscalYear.id === fiscalYearId)?.code;
              toast.success(`Contexto activo: ${companyName ?? "empresa"} · ${fiscalYearCode ?? "ejercicio"}`);
              router.refresh();
            } else {
              const payload = await response.json().catch(() => null);
              setError(payload?.message ?? "No se pudo cambiar el contexto.");
            }
          } catch {
            setError("No se pudo cambiar el contexto. Revisa tu conexión.");
          } finally {
            setSaving(false);
          }
        }}
        size={compact ? "xs" : "sm"}
        title={hasPendingChange ? "Aplicar empresa y ejercicio seleccionados" : "Selecciona otra empresa o ejercicio para aplicar"}
        type="button"
        variant={compact ? "ghost" : "outline"}
      >
        {saving ? "Aplicando…" : "Aplicar"}
      </Button>
      {error ? <p className={compact ? "max-w-40 truncate border border-white/60 bg-destructive px-1 font-mono text-[0.65rem] text-destructive-foreground" : "text-xs text-destructive"} role="alert" title={error}>{error}</p> : null}
    </div>
  );
}
