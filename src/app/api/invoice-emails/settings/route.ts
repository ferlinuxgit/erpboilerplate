import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { getInvoiceEmailSettings, saveInvoiceEmailSettings } from "@/server/invoice-email/service";
import { firstIssueMessage, invoiceEmailSettingsSchema } from "@/server/invoice-email/schemas";

export async function GET() {
  try {
    const ctx = await requireContext("invoice.read");
    return NextResponse.json(await getInvoiceEmailSettings(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "invoiceEmailSetting.get");
  }
}

/** Plantillas de email y calendario de recordatorios automáticos de la empresa. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("invoice.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = invoiceEmailSettingsSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssueMessage(parsed.error, "Revisa las plantillas."));
    const saved = await saveInvoiceEmailSettings({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id }, parsed.data);
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error, "invoiceEmailSetting.update", "No se pudieron guardar las plantillas.");
  }
}
