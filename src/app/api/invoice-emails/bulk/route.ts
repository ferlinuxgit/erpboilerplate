import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { sendInvoiceEmailsBulk } from "@/server/invoice-email/service";
import { bulkInvoiceEmailSchema, firstIssueMessage } from "@/server/invoice-email/schemas";

/** Envío en bloque: cada factura al email de su cliente con la plantilla de la empresa. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("invoice.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = bulkInvoiceEmailSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssueMessage(parsed.error, "Selecciona las facturas a enviar."));
    const results = await sendInvoiceEmailsBulk(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, trigger: "MANUAL", actorEmail: ctx.user.email },
      parsed.data.invoiceIds,
      { copyToSelf: parsed.data.copyToSelf },
    );
    return NextResponse.json({ results, sent: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length });
  } catch (error) {
    return handleRouteError(error, "invoiceEmail.bulk", "No se pudieron enviar las facturas.");
  }
}
