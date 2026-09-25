"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  invalidateActiveContext,
  loadActiveContext,
  type CompanyOption,
  type FiscalYearOption,
  type TenantOption,
} from "@/lib/active-context-client";
import { getCsrfHeader } from "@/lib/csrf-client";
import { Select } from "@/components/ui/select";

const NEW_FISCAL_YEAR_VALUE = "__new-fiscal-year";
/** El panel de apertura y cierre de ejercicios vive en Contabilidad. */
const FISCAL_YEAR_PANEL_HREF = "/accounting";

function contextValue(companyId: string, fiscalYearId: string) {
  return `${companyId}:${fiscalYearId}`;
}

/**
 * Selector de empresa y ejercicio en un solo menú que se aplica al elegir (sin botón
 * "Aplicar"). Si el usuario pertenece a varios espacios de trabajo aparece otro selector.
 */
export function ActiveContextSwitcher({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [fiscalYearsByCompany, setFiscalYearsByCompany] = useState<Record<string, FiscalYearOption[]>>({});
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadActiveContext().then((payload) => {
      if (cancelled) return;
      if (payload) {
        setTenants(payload.availableTenants ?? []);
        setTenantId(payload.active.tenantId ?? "");
        setCompanies(payload.availableCompanies);
        setFiscalYearsByCompany(payload.availableFiscalYearsByCompany);
        setSelected(contextValue(payload.active.companyId, payload.active.fiscalYearId));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className={compact ? "font-mono text-[0.65rem] text-chrome-active-foreground/75" : "text-xs text-muted-foreground"}>Cargando empresa…</p>;
  }

  async function switchTenant(nextTenantId: string) {
    const previous = tenantId;
    setTenantId(nextTenantId);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/context/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ tenantId: nextTenantId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "No se pudo cambiar de espacio de trabajo.");
      }
      invalidateActiveContext();
      toast.success(`Espacio activo: ${tenants.find((tenant) => tenant.id === nextTenantId)?.name ?? "espacio de trabajo"}`);
      // Recarga completa intencionada: resetea todo el estado cliente del espacio anterior.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard");
    } catch (caught) {
      setTenantId(previous);
      setError(caught instanceof Error ? caught.message : "No se pudo cambiar de espacio de trabajo.");
      setSaving(false);
    }
  }

  async function switchContext(value: string) {
    if (value === NEW_FISCAL_YEAR_VALUE) {
      onChanged?.();
      router.push(FISCAL_YEAR_PANEL_HREF);
      return;
    }
    const [companyId, fiscalYearId] = value.split(":");
    if (!companyId || !fiscalYearId || value === selected) return;
    const previous = selected;
    setSelected(value);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/context/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ companyId, fiscalYearId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "No se pudo cambiar de empresa o ejercicio.");
      }
      invalidateActiveContext();
      const companyName = companies.find((company) => company.id === companyId)?.name;
      const fiscalYearCode = fiscalYearsByCompany[companyId]?.find((year) => year.id === fiscalYearId)?.code;
      toast.success(`Trabajando en ${companyName ?? "la empresa"} · ejercicio ${fiscalYearCode ?? ""}`.trim());
      onChanged?.();
      router.refresh();
    } catch (caught) {
      setSelected(previous);
      setError(caught instanceof Error ? caught.message : "No se pudo cambiar de empresa o ejercicio. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  const showTenantSelector = tenants.length > 1;
  const multipleCompanies = companies.length > 1;
  const optionLabel = (company: CompanyOption, year: FiscalYearOption) => (multipleCompanies ? `${company.name} · ${year.code}` : `Ejercicio ${year.code} · ${company.name}`);

  return (
    <div className={compact ? "flex min-w-0 items-center gap-1" : "space-y-1"}>
      {showTenantSelector ? (
        <Select
          aria-label="Espacio de trabajo activo"
          className={compact ? "h-7 w-28 border-white/50 bg-window-highlight px-1.5 text-[0.7rem] text-window-text xl:w-36" : undefined}
          disabled={saving}
          onChange={(event) => void switchTenant(event.target.value)}
          value={tenantId}
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        aria-busy={saving || undefined}
        aria-label="Empresa y ejercicio activos"
        className={compact ? "h-7 w-44 border-white/50 bg-window-highlight px-1.5 text-[0.7rem] text-window-text xl:w-60" : undefined}
        disabled={saving}
        onChange={(event) => void switchContext(event.target.value)}
        title="Se aplica al elegir"
        value={selected}
      >
        {companies.map((company) => {
          const years = fiscalYearsByCompany[company.id] ?? [];
          const options = years.map((year) => (
            <option key={year.id} value={contextValue(company.id, year.id)}>
              {optionLabel(company, year)}
            </option>
          ));
          return multipleCompanies ? (
            <optgroup key={company.id} label={company.name}>
              {options}
            </optgroup>
          ) : (
            options
          );
        })}
        <option value={NEW_FISCAL_YEAR_VALUE}>Nuevo ejercicio… (abrir en Contabilidad)</option>
      </Select>
      {saving ? <span className="sr-only" role="status">Cambiando de contexto…</span> : null}
      {error ? <p className={compact ? "max-w-40 truncate border border-white/60 bg-destructive px-1 font-mono text-[0.65rem] text-destructive-foreground" : "text-xs text-destructive"} role="alert" title={error}>{error}</p> : null}
    </div>
  );
}
