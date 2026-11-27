import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { reminderSettingsSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, getReminderSettings, saveReminderSettings } from "@/server/corporate-tax/service";

/** Recordatorios de la sociedad que se muestran en el calendario fiscal (modelo 232, legalización de libros y depósito de cuentas). */
export async function GET() {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    return NextResponse.json(await getReminderSettings(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.settings.get", "No se pudieron cargar los recordatorios.");
  }
}

/** Activa o desactiva los recordatorios informativos de la sociedad en el calendario fiscal. */
export async function PATCH(request: Request) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = reminderSettingsSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await saveReminderSettings({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.settings.update", "No se pudieron guardar los recordatorios.");
  }
}
