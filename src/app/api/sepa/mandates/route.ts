import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createCustomerMandate, listCustomerMandates } from "@/server/sepa/mandates";

const payloadSchema = z.object({
  customerId: z.string().trim().min(1),
  mandateReference: z.string().trim().max(35).nullable().optional(),
  signatureDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  iban: z.string().trim().min(15).max(42),
  bic: z.string().trim().max(11).nullable().optional(),
  mandateType: z.enum(["RECURRENT", "ONE_OFF"]),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { ctx } = await requirePermission("customer.read");
    const customerId = new URL(request.url).searchParams.get("customerId")?.trim();
    if (!customerId) return NextResponse.json({ message: "Indica el cliente." }, { status: 400 });
    return NextResponse.json(await listCustomerMandates(ctx.company.id, customerId));
  } catch (error) {
    return handleRouteError(error, "sepa.mandates.list");
  }
}

/** Alta de un mandato SEPA firmado por el cliente. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("customer.create", "Tu rol no permite gestionar clientes.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa la fecha de firma, el IBAN y el tipo de mandato." }, { status: 400 });
    const signatureDate = new Date(`${parsed.data.signatureDate}T00:00:00.000Z`);
    if (Number.isNaN(signatureDate.getTime())) return NextResponse.json({ message: "Fecha de firma no válida." }, { status: 400 });
    const created = await createCustomerMandate(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id },
      parsed.data.customerId,
      { ...parsed.data, signatureDate },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "sepa.mandates.create", "No se pudo guardar el mandato.");
  }
}
