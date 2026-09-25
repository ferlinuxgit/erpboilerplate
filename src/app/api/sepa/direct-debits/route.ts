import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { createDirectDebitRemittance, listDirectDebitRemittances } from "@/server/sepa/direct-debits";

const payloadSchema = z.object({
  bankAccountId: z.string().trim().min(1),
  collectionDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    invoiceId: z.string().trim().min(1),
    amount: z.number().positive(),
  })).min(1).max(500),
});

export async function GET() {
  try {
    const { ctx } = await requirePermission("treasury.read");
    return NextResponse.json(await listDirectDebitRemittances(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.list");
  }
}

/** Genera el fichero de adeudos SEPA (pain.008.001.02) y guarda la remesa pendiente de cobro. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite generar remesas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Revisa la cuenta de abono, la fecha de cobro y los importes." }, { status: 400 });
    const collectionDate = new Date(`${parsed.data.collectionDate}T00:00:00.000Z`);
    if (Number.isNaN(collectionDate.getTime())) return NextResponse.json({ message: "Fecha de cobro no válida." }, { status: 400 });
    const created = await createDirectDebitRemittance(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id },
      { bankAccountId: parsed.data.bankAccountId, collectionDate, items: parsed.data.items },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "sepa.direct_debits.create", "No se pudo generar la remesa de cobros.");
  }
}
