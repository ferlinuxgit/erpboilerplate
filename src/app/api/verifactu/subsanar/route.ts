import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { subsanarInvoiceRecord } from "@/server/verifactu/subsanacion";

const payloadSchema = z.object({ invoiceId: z.string().trim().min(1).max(80) });

/** Genera el alta de subsanación de una factura cuyo registro fue rechazado o aceptado con errores. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica la factura cuyo registro quieres subsanar." }, { status: 400 });
    const result = await subsanarInvoiceRecord({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data.invoiceId);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "verifactu.subsanar", "No se pudo subsanar el registro.");
  }
}
