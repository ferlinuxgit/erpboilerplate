import { NextResponse } from "next/server";
import { z } from "zod";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { sendPaymentReminder, sendPaymentRemindersBulk } from "@/server/dunning/service";
import { firstIssueMessage, sendReminderSchema } from "@/server/invoice-email/schemas";

const bulkSchema = z.object({
  invoiceIds: z.array(z.string().trim().min(1)).min(1, "Selecciona al menos una factura.").max(200, "Como máximo 200 facturas por envío."),
});

/**
 * Recordatorio de cobro. Con `invoiceIds` envía en bloque (siguiente nivel de cada factura, omite
 * excluidos y no vencidas); con `invoiceId` envía uno con el texto editado en el diálogo.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("invoice.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const actor = { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, trigger: "MANUAL" as const };
    if (typeof payload === "object" && payload !== null && "invoiceIds" in payload) {
      const parsed = bulkSchema.safeParse(payload);
      if (!parsed.success) return jsonError(400, firstIssueMessage(parsed.error, "Selecciona las facturas."));
      const results = await sendPaymentRemindersBulk(actor, parsed.data.invoiceIds, { timeZone: ctx.company.timezone || undefined });
      return NextResponse.json({ results, sent: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length });
    }
    const parsed = sendReminderSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssueMessage(parsed.error, "Revisa los datos del recordatorio."));
    const result = await sendPaymentReminder(actor, {
      invoiceId: parsed.data.invoiceId,
      reminderLevel: parsed.data.reminderLevel ?? null,
      to: parsed.data.to ?? [],
      cc: parsed.data.cc,
      subject: parsed.data.subject,
      body: parsed.data.body,
      copyToSelfEmail: parsed.data.copyToSelf ? ctx.user.email : null,
    });
    if (result.status === "FAILED") {
      return jsonError(502, `El servidor de correo no aceptó el envío: ${result.error ?? "error desconocido"}. Queda registrado en el historial de la factura.`);
    }
    return NextResponse.json({ status: result.status, number: result.number, to: result.to, logId: result.logId });
  } catch (error) {
    return handleRouteError(error, "invoice.remind", "No se pudo enviar el recordatorio.");
  }
}
