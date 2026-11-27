import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { capitalIncomeSchema } from "@/server/payroll/schemas";
import { createCapitalIncome, listCapitalIncome } from "@/server/payroll/service";

/** Dividendos e intereses pagados por la empresa (`?year=AAAA` opcional). */
export async function GET(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.read");
    const actor = payrollActor(ctx, user);
    const year = Number(new URL(request.url).searchParams.get("year"));
    return NextResponse.json(await listCapitalIncome(actor.companyId, Number.isInteger(year) && year > 1999 ? year : undefined));
  } catch (error) {
    return handleRouteError(error, "payroll.capital-income.list", "No se pudieron cargar los rendimientos pagados.");
  }
}

/**
 * Registra un dividendo o un interés pagado con su retención y lo contabiliza: 526 (dividendo) o
 * 662 (intereses) al debe; 4751 y banco al haber. Alimenta los modelos 123 y 193.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, capitalIncomeSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await createCapitalIncome(actor, body.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "payroll.capital-income.create", "No se pudo registrar el rendimiento. Inténtalo de nuevo.");
  }
}
