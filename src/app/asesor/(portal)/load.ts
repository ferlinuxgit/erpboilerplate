import type { AdvisorScope } from "@/lib/advisor-scopes";
import { requireAdvisorPage } from "@/server/advisor/auth";
import { loadAdvisorPeriod } from "@/server/advisor/data";

export type PortalSearchParams = Promise<Record<string, string | string[] | undefined>>;

export const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Sesión del asesor (con la sección exigida) y periodo de la URL. */
export async function loadPortalPage(searchParams: PortalSearchParams, scope?: AdvisorScope) {
  const context = await requireAdvisorPage(scope);
  const query = await searchParams;
  const { years, period } = await loadAdvisorPeriod(context.company.id, { year: first(query.year), period: first(query.period) });
  const page = Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1);
  const q = (first(query.q) ?? "").slice(0, 200);
  return { context, years, period, page, q };
}
