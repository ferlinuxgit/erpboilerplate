import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollPostPeriodSchema } from "@/server/payroll/schemas";
import { postPeriod } from "@/server/payroll/service";

/** Contabiliza todas las nóminas en borrador de un mes (un asiento por nómina). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollPostPeriodSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await postPeriod(actor, body.data.period));
  } catch (error) {
    return handleRouteError(error, "payroll.periods.post", "No se pudieron contabilizar las nóminas. Inténtalo de nuevo.");
  }
}
