import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { deleteMailInboxSettings, getMailInboxSettings, saveMailInboxSettings } from "@/server/ocr/mail-inbox";

import { mailInboxPayloadSchema } from "./schema";

/** Buzón de correo al que se reenvían las facturas recibidas. La contraseña nunca se devuelve. */
export async function GET() {
  try {
    const { ctx } = await requirePermission("settings.manage");
    return NextResponse.json(await getMailInboxSettings(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "expense.mailInbox.read");
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, user } = await requirePermission("settings.manage", "Solo un administrador puede configurar el buzón de facturas.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = mailInboxPayloadSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, "Revisa los datos del buzón de correo.");
    const saved = await saveMailInboxSettings({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, {
      ...parsed.data,
      password: parsed.data.password || undefined,
      processedMailbox: parsed.data.processedMailbox || undefined,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error, "expense.mailInbox.update", "No se pudo guardar el buzón de facturas.");
  }
}

export async function DELETE() {
  try {
    const { ctx, user } = await requirePermission("settings.manage", "Solo un administrador puede quitar el buzón de facturas.");
    await deleteMailInboxSettings({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "expense.mailInbox.delete", "No se pudo quitar el buzón de facturas.");
  }
}
