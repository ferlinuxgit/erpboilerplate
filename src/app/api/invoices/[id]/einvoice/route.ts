import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError, type AuthenticatedApiActor } from "@/lib/integration-auth";
import { generateEInvoice, getEInvoiceOverview, type EInvoiceFormat, type GeneratedEInvoice } from "@/server/einvoice/service";

const formatSchema = z.enum(["facturae", "ubl"]);
const generateSchema = z.object({
  format: formatSchema,
  /** Firma XAdES-EPES con el certificado de la empresa (solo Facturae). */
  signed: z.boolean().optional(),
  /** Vuelve a generar aunque exista una copia conservada (p. ej. para firmar de nuevo). */
  regenerate: z.boolean().optional(),
});

function fileResponse(file: GeneratedEInvoice) {
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Einvoice-Sha256": file.sha256,
      "X-Einvoice-Signed": file.signed ? "1" : "0",
    },
  });
}

const actorOf = (actor: AuthenticatedApiActor) => ({ tenantId: actor.context.tenant.id, companyId: actor.context.company.id, actorUserId: actor.actorUserId });
const toFormat = (value: "facturae" | "ubl"): EInvoiceFormat => (value === "ubl" ? "UBL" : "FACTURAE");

/**
 * Factura electrónica de una factura emitida.
 * - Sin `format`: situación (formatos disponibles, datos que faltan, ficheros generados y estados).
 * - `?format=facturae|ubl`: descarga el fichero SIN firmar (Facturae 3.2.2 o UBL 2.1).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    if (!hasApiActorPermission(actor, "invoice.read")) return jsonError(403, "Sin permisos.");
    const { id } = await params;
    const requested = new URL(request.url).searchParams.get("format");
    if (!requested) {
      const overview = await getEInvoiceOverview(actor.context.company.id, id);
      if (!overview) return jsonError(404, "La factura no existe o no está emitida.");
      return NextResponse.json(overview);
    }
    const format = formatSchema.safeParse(requested);
    if (!format.success) return jsonError(400, "El formato debe ser «facturae» o «ubl».");
    const file = await generateEInvoice(actorOf(actor), id, { format: toFormat(format.data), signed: false });
    if (!file) return jsonError(404, "Factura no encontrada.");
    return fileResponse(file);
  } catch (error) {
    return handleRouteError(error, "einvoice.download", "No se pudo generar la factura electrónica.");
  }
}

/**
 * Genera y descarga la factura electrónica; con `signed: true` firma el Facturae (XAdES-EPES) con
 * el certificado de la empresa. Firmar es actuar en nombre de la empresa: exige permiso de escritura.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateApiActor(request);
    if (isAuthError(actor)) return actor;
    const payload = await readJsonBody(request);
    if (payload === null) return invalidJsonResponse();
    const parsed = generateSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Petición no válida.");
    const needsWrite = Boolean(parsed.data.signed) || Boolean(parsed.data.regenerate);
    if (!hasApiActorPermission(actor, needsWrite ? "invoice.write" : "invoice.read")) {
      return jsonError(403, needsWrite ? "No tienes permisos para firmar facturas en nombre de la empresa." : "Sin permisos.");
    }
    const { id } = await params;
    const file = await generateEInvoice(actorOf(actor), id, { format: toFormat(parsed.data.format), signed: parsed.data.signed, regenerate: parsed.data.regenerate });
    if (!file) return jsonError(404, "Factura no encontrada.");
    return fileResponse(file);
  } catch (error) {
    return handleRouteError(error, "einvoice.generate", "No se pudo generar la factura electrónica.");
  }
}
