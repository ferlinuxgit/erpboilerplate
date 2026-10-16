import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { testMailInboxConnection } from "@/server/ocr/mail-inbox";

import { mailInboxPayloadSchema } from "../schema";

/** Prueba la conexión IMAP con los datos del formulario (sin guardarlos). */
export async function POST(request: Request) {
  try {
    const { ctx } = await requirePermission("settings.manage");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = mailInboxPayloadSchema.partial({ enabled: true, allowedSenders: true }).safeParse(payload);
    if (!parsed.success) return jsonError(400, "Revisa los datos del buzón de correo.");
    const result = await testMailInboxConnection(ctx.company.id, {
      host: parsed.data.host ?? "",
      port: parsed.data.port ?? 993,
      secure: parsed.data.secure ?? true,
      username: parsed.data.username ?? "",
      password: parsed.data.password || undefined,
      mailbox: parsed.data.mailbox ?? "INBOX",
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "expense.mailInbox.test", "No se pudo conectar con el buzón.");
  }
}
