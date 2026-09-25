import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { buildInvoiceEmailDraft, listInvoiceEmailLog, sendInvoiceEmail } from "@/server/invoice-email/service";
import { firstIssueMessage, sendInvoiceEmailSchema } from "@/server/invoice-email/schemas";

/** Propuesta del diálogo (destinatario y plantilla rellenada) e historial de envíos de una factura. */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext("invoice.read");
    const url = new URL(request.url);
    const invoiceId = url.searchParams.get("invoiceId")?.trim();
    if (!invoiceId) return jsonError(400, "Indica la factura.");
    const kind = url.searchParams.get("kind") === "REMINDER" ? "REMINDER" : "INVOICE";
    const level = Number(url.searchParams.get("level") ?? "") || null;
    const draft = await buildInvoiceEmailDraft(ctx.company.id, invoiceId, { kind, reminderLevel: level });
    if (!draft) return jsonError(404, "Factura no encontrada.");
    const log = await listInvoiceEmailLog(ctx.company.id, invoiceId);
    return NextResponse.json({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      copyToSelfDefault: draft.copyToSelfDefault,
      smtpConfigured: draft.smtpConfigured,
      userEmail: ctx.user.email,
      invoice: { id: draft.context.invoiceId, number: draft.context.number, customerName: draft.context.customerName, hasCustomerEmail: Boolean(draft.context.customerEmail) },
      log,
    });
  } catch (error) {
    return handleRouteError(error, "invoiceEmail.draft");
  }
}

/** Envía una factura emitida por email con el PDF adjunto. */
export async function POST(request: Request) {
  try {
    const ctx = await requireContext("invoice.write");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = sendInvoiceEmailSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssueMessage(parsed.error, "Revisa los datos del email."));
    const result = await sendInvoiceEmail(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id, trigger: "MANUAL" },
      {
        invoiceId: parsed.data.invoiceId,
        kind: "INVOICE",
        to: parsed.data.to ?? [],
        cc: parsed.data.cc,
        subject: parsed.data.subject,
        body: parsed.data.body,
        copyToSelfEmail: parsed.data.copyToSelf ? ctx.user.email : null,
      },
    );
    if (result.status === "FAILED") {
      return jsonError(502, `El servidor de correo no aceptó el envío: ${result.error ?? "error desconocido"}. Queda registrado en el historial de la factura.`);
    }
    return NextResponse.json({ status: result.status, number: result.number, to: result.to, logId: result.logId });
  } catch (error) {
    return handleRouteError(error, "invoiceEmail.send", "No se pudo enviar el email.");
  }
}
