import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { parsePayrollBody, payrollActor } from "@/server/payroll/http";
import { payrollPaymentSchema } from "@/server/payroll/schemas";
import { createPayrollPayment } from "@/server/payroll/service";

/**
 * Registra el pago de las nóminas de un mes (465 a banco) o de sus seguros sociales (476 a banco).
 * Con `postEntry: false` solo anota la fecha de pago, sin asiento.
 */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    const actor = payrollActor(ctx, user);
    const body = await parsePayrollBody(request, payrollPaymentSchema);
    if ("response" in body) return body.response;
    return NextResponse.json(await createPayrollPayment(actor, body.data), { status: 201 });
  } catch (error) {
    return handleRouteError(error, "payroll.payments.create", "No se pudo registrar el pago. Inténtalo de nuevo.");
  }
}
