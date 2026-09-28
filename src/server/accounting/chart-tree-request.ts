import { chartLevelDepth, parseChartFilters, parseChartLevel, parseDateKey } from "@/lib/chart-of-accounts/query";
import { resolveChartPeriod } from "@/server/accounting/chart-tree";

/**
 * Parámetros comunes de las rutas del plan contable (`?fy=&from=&to=&f=&level=`): ejercicio y
 * periodo (por defecto el ejercicio activo), filtros y nivel.
 */
export async function parseChartRequest(companyId: string, activeFiscalYearId: string, params: URLSearchParams) {
  const period = await resolveChartPeriod(companyId, {
    fy: params.get("fy"),
    from: parseDateKey(params.get("from")),
    to: parseDateKey(params.get("to")),
    activeFiscalYearId,
  });
  const level = parseChartLevel(params.get("level"));
  return {
    period,
    filters: parseChartFilters(params.get("f")),
    level,
    depth: chartLevelDepth(level),
  };
}

/** Código de cuenta de la URL: solo dígitos (se usa en `like 'código%'`). */
export function accountCodeParam(value: string | null) {
  const code = value?.trim() ?? "";
  return /^\d{1,20}$/.test(code) ? code : null;
}
