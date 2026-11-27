import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { isPayrollPeriod } from "@/server/payroll/model";
import { payrollSlipSchema } from "@/server/payroll/schemas";
import { createSlip, getPeriodSummary, listSlips } from "@/server/payroll/service";

/** Nóminas de un mes (`?period=AAAA-MM`, con sus totales y pagos) o de un año (`?year=AAAA`). */
export async function GET(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.read");
    const actor = payrollActor(ctx, user);
    const search = new URL(request.url).searchParams;
    const period = search.get("period");
    const year = Number(search.get("year"));
    if (period !== null && !isPayrollPeriod(period)) return NextResponse.json({ message: "Indica el mes como AAAA-MM." }, { status: 400 });
    if (period) {
      const [slips, summary] = await Promise.all([listSlips(actor.companyId, { period }), getPeriodSummary(actor.companyId, period)]);
      return NextResponse.json({ slips, summary });
    }
    return NextResponse.json({ slips: await listSlips(actor.companyId, Number.isInteger(year) && year > 1999 ? { year } : {}) });
  } catch (error) {
    return handleRouteError(error, "payroll.slips.list", "No se pudieron cargar las nóminas.");
  }
}

/**
 * Registra la nómina de un trabajador con los importes de la gestoría. Comprueba que cuadra
 * (líquido = bruto − IRPF − ingreso a cuenta − Seguridad Social del trabajador − anticipos) y, con
 * `post: true`, la contabiliza.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollSlipSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await createSlip(actor, body.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "payroll.slips.create", "No se pudo guardar la nómina. Inténtalo de nuevo.");
  }
}
