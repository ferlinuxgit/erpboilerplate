import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createRemittance, listRemittances } from "@/server/sepa/service";

const payloadSchema = z.object({
  bankAccountId: z.string().trim().min(1),
  executionDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    supplierInvoiceId: z.string().trim().min(1),
    amount: z.number().positive(),
    iban: z.string().trim().min(15).max(42),
    bic: z.string().trim().max(11).nullable().optional(),
  })).min(1).max(500),
});

export async function GET() {
  try {
    const { ctx } = await requirePermission("treasury.read");
    return NextResponse.json(await listRemittances(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "sepa.remittances.list");
  }
}

/** Genera el fichero SEPA (pain.001.001.03) y guarda la remesa pendiente de confirmar. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite generar remesas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa la cuenta de cargo, la fecha y el IBAN de cada proveedor." }, { status: 400 });
    const executionDate = new Date(`${parsed.data.executionDate}T00:00:00.000Z`);
    if (Number.isNaN(executionDate.getTime())) return NextResponse.json({ message: "Fecha de ejecución no válida." }, { status: 400 });
    const created = await createRemittance(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id },
      { bankAccountId: parsed.data.bankAccountId, executionDate, items: parsed.data.items },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "sepa.remittances.create", "No se pudo generar la remesa.");
  }
}
