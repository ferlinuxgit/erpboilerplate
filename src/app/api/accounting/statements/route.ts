import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { getFinancialStatements } from "@/server/accounting/statements";

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Estados financieros: balance de situación, cuenta de pérdidas y ganancias y balance de sumas
 * y saldos. Consulta: `fiscalYearId` (por defecto el activo) y opcionalmente `from` / `to`
 * (AAAA-MM-DD, ambos incluidos) dentro del ejercicio.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("accounting.read");
    const params = new URL(request.url).searchParams;
    const years = await listFiscalYears(ctx.company.id);
    const year = years.find((entry) => entry.id === params.get("fiscalYearId")) ?? years.find((entry) => entry.id === ctx.fiscalYear.id) ?? years[years.length - 1];
    if (!year) return NextResponse.json({ message: "No hay ejercicios contables." }, { status: 404 });
    const from = parseDay(params.get("from")) ?? year.startsAt;
    const to = parseDay(params.get("to"));
    const toExclusive = to ? new Date(to.getTime() + 86_400_000) : new Date(year.endsAt.getTime() + 86_400_000);
    const statements = await getFinancialStatements(ctx.company.id, ctx.company.countryCode, { yearStart: year.startsAt, from, toExclusive });
    return NextResponse.json({ fiscalYear: { id: year.id, code: year.code }, from: from.toISOString().slice(0, 10), to: new Date(toExclusive.getTime() - 86_400_000).toISOString().slice(0, 10), ...statements });
  } catch (error) {
    return handleRouteError(error, "accounting.statements");
  }
}
