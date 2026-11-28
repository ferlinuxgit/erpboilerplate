import { and, eq, isNull, lt, or } from "drizzle-orm";

import { einvoiceDocument, einvoiceStatusEvent } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import {
  anularFacturaBody,
  buildFaceEnvelope,
  consultarFacturaBody,
  createFaceHttpsTransport,
  enviarFacturaBody,
  faceEnvironmentLabels,
  parseAnularFacturaResponse,
  parseConsultarFacturaResponse,
  parseEnviarFacturaResponse,
  requireFaceEnvironment,
  type FaceEnvironment,
  type FaceOperation,
  type FaceSigningMaterial,
  type FaceTransport,
} from "@/server/einvoice/face";
import { missingDir3 } from "@/server/einvoice/model";
import { extractSigningMaterial, Pkcs12Error } from "@/server/einvoice/pkcs12";
import { faceInfo, generateEInvoice, listEInvoiceStatuses, loadEInvoice, type EInvoiceActor, type FaceSubmissionInfo } from "@/server/einvoice/service";
import { einvoiceStatusProblem } from "@/server/einvoice/status";
import { civilDateKey } from "@/server/invoices/issue-checks";
import { readPrivateFile } from "@/server/storage/files";
import { certificateValidity, loadCompanyCredentials } from "@/server/verifactu/certificates";

/**
 * Remisión a FACe del Facturae firmado, consulta de su estado y solicitud de anulación (ver
 * `face.ts` para el protocolo y lo que queda sin verificar). Solo con FACE_TRANSPORT=face y
 * FACE_ENVIRONMENT declarado; cada envío guarda el entorno en el que se hizo y las consultas y
 * anulaciones solo se hacen en ese mismo entorno.
 */

export type FaceServiceOptions = { transport?: FaceTransport; env?: Record<string, string | undefined>; now?: Date };

/** Margen tras el que un intento de envío sin respuesta deja de bloquear otro (p. ej. si el proceso cayó). */
const SENDING_LOCK_MS = 3 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function signingMaterial(companyId: string, now: Date): Promise<FaceSigningMaterial> {
  const credentials = await loadCompanyCredentials(db, companyId);
  if (!credentials) throw new HttpError(409, "La empresa no ha subido su certificado electrónico (Fiscalidad › VERI*FACTU): sin él no se puede firmar ni remitir a FACe.");
  if (certificateValidity(credentials.validTo, now).expired) throw new HttpError(409, "El certificado electrónico de la empresa está caducado: sube uno vigente para remitir a FACe.");
  try {
    return extractSigningMaterial(credentials.pfx, credentials.passphrase);
  } catch (error) {
    if (error instanceof Pkcs12Error) throw new HttpError(422, error.message);
    throw error;
  }
}

async function call(transport: FaceTransport, environment: FaceEnvironment, operation: FaceOperation, envelope: string) {
  try {
    return await transport.send({ environment, operation, envelope });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { httpStatus: 0, body: "", networkError: `No se pudo conectar con FACe (${detail}).` };
  }
}

async function signedDocument(companyId: string, invoiceId: string) {
  const [row] = await db.select().from(einvoiceDocument)
    .where(and(eq(einvoiceDocument.companyId, companyId), eq(einvoiceDocument.invoiceId, invoiceId), eq(einvoiceDocument.format, "FACTURAE"), eq(einvoiceDocument.signed, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Remite a FACe el Facturae firmado de una factura emitida. Exige los tres DIR3 y el certificado
 * de la empresa (que debe estar dado de alta en face.gob.es como certificado de proveedor).
 */
export async function sendEInvoiceToFace(actor: EInvoiceActor, invoiceId: string, input: { email: string }, options: FaceServiceOptions = {}): Promise<FaceSubmissionInfo | null> {
  const environment = requireFaceEnvironment(options.env);
  const now = options.now ?? new Date();
  const email = input.email.trim();
  if (!EMAIL.test(email)) throw new HttpError(400, "Indica un correo electrónico válido: FACe envía a él los avisos de la factura.");
  const loaded = await loadEInvoice(actor.companyId, invoiceId);
  if (!loaded) return null;
  if (!loaded.availability.facturae) throw new HttpError(404, "FACe no está disponible para esta empresa.");
  const missing = missingDir3(loaded.data.dir3);
  if (!loaded.data.dir3 || missing.length > 0) {
    throw new HttpError(422, `FACe exige los códigos DIR3 de oficina contable, órgano gestor y unidad tramitadora. Faltan en la ficha del cliente: ${missing.join(", ") || "todos"}.`);
  }

  const existing = await signedDocument(actor.companyId, invoiceId);
  if (existing?.faceRegistryNumber) throw new HttpError(409, `Esta factura ya se remitió a FACe (registro ${existing.faceRegistryNumber}).`);
  // Genera (o reutiliza) y conserva el .xsig firmado: lo que se remite es exactamente la copia guardada.
  const file = await generateEInvoice(actor, invoiceId, { format: "FACTURAE", signed: true }, now);
  if (!file) return null;
  const row = await signedDocument(actor.companyId, invoiceId);
  if (!row) throw new HttpError(500, "No se encontró la copia firmada conservada.");
  const material = await signingMaterial(actor.companyId, now);

  // Reserva del envío: evita remitir dos veces la misma factura (dos registros en FACe) si se pulsa dos veces.
  const claimed = await db.update(einvoiceDocument)
    .set({ faceSubmittedAt: now, faceEnvironment: environment, faceContactEmail: email })
    .where(and(eq(einvoiceDocument.id, row.id), isNull(einvoiceDocument.faceRegistryNumber), or(isNull(einvoiceDocument.faceSubmittedAt), lt(einvoiceDocument.faceSubmittedAt, new Date(now.getTime() - SENDING_LOCK_MS)))))
    .returning({ id: einvoiceDocument.id });
  if (claimed.length === 0) throw new HttpError(409, "La factura se está remitiendo a FACe en este momento. Espera unos minutos y consulta su estado.");

  const bytes = await readPrivateFile(row.storageKey);
  const envelope = buildFaceEnvelope(enviarFacturaBody({ email, fileName: row.fileName, xsigBase64: bytes.toString("base64") }), material, { now });
  const response = await call(options.transport ?? createFaceHttpsTransport(), environment, "enviarFactura", envelope);
  const parsed = "networkError" in response ? null : parseEnviarFacturaResponse(response.body, response.httpStatus);

  if (!parsed?.ok) {
    const error = parsed ? parsed.error : (response as { networkError: string }).networkError;
    await db.update(einvoiceDocument).set({ status: "FAILED", faceSubmittedAt: null, faceLastError: error.slice(0, 2000), faceCheckedAt: now }).where(eq(einvoiceDocument.id, row.id));
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "einvoice.face.send_failed", entityName: "invoice", entityId: invoiceId, payload: { environment, error } });
    throw new HttpError(502, `FACe no ha registrado la factura. ${error}`);
  }

  const history = await listEInvoiceStatuses(actor.companyId, invoiceId);
  const sentEvent = { status: "SENT" as const, effectiveDate: civilDateKey(now) };
  const addSent = !history.some((entry) => entry.status === "SENT") && !einvoiceStatusProblem(sentEvent, { history, issueDate: loaded.issueDate, today: civilDateKey(now) });
  await db.transaction(async (tx) => {
    await tx.update(einvoiceDocument).set({
      status: "SENT",
      faceEnvironment: environment,
      faceRegistryNumber: parsed.data.registryNumber,
      faceContactEmail: email,
      faceSubmittedAt: now,
      faceLastError: null,
      faceCheckedAt: now,
    }).where(eq(einvoiceDocument.id, row.id));
    if (addSent) {
      await tx.insert(einvoiceStatusEvent).values({ companyId: actor.companyId, invoiceId, ...sentEvent, source: "FACE", createdByUserId: actor.actorUserId, createdAt: now });
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "einvoice.face.send",
      entityName: "invoice",
      entityId: invoiceId,
      payload: { environment, registryNumber: parsed.data.registryNumber, sha256: row.sha256, receivedAt: parsed.data.receivedAt, dir3: { accountingOffice: parsed.data.accountingOffice, managingBody: parsed.data.managingBody, processingUnit: parsed.data.processingUnit } },
    }, tx);
  });
  const [updated] = await db.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, row.id));
  return faceInfo(updated);
}

/** Documento remitido y comprobación de que el servidor trabaja en el mismo entorno de FACe. */
async function submitted(actor: EInvoiceActor, invoiceId: string, env: FaceServiceOptions["env"]) {
  const environment = requireFaceEnvironment(env);
  const row = await signedDocument(actor.companyId, invoiceId);
  if (!row?.faceRegistryNumber) throw new HttpError(409, "Esta factura no se ha remitido a FACe desde la aplicación.");
  if (row.faceEnvironment !== environment) {
    const sentIn = row.faceEnvironment === "production" || row.faceEnvironment === "staging" ? faceEnvironmentLabels[row.faceEnvironment] : "otro entorno";
    throw new HttpError(409, `La factura se remitió al entorno de ${sentIn} de FACe y este servidor está configurado para ${faceEnvironmentLabels[environment]}: no se consulta ni se anula desde aquí.`);
  }
  return { row, environment, registryNumber: row.faceRegistryNumber };
}

/** Consulta en FACe el estado de tramitación y de anulación de la factura remitida y lo guarda. */
export async function refreshFaceStatus(actor: EInvoiceActor, invoiceId: string, options: FaceServiceOptions = {}): Promise<FaceSubmissionInfo | null> {
  const now = options.now ?? new Date();
  const { row, environment, registryNumber } = await submitted(actor, invoiceId, options.env);
  const material = await signingMaterial(actor.companyId, now);
  const response = await call(options.transport ?? createFaceHttpsTransport(), environment, "consultarFactura", buildFaceEnvelope(consultarFacturaBody(registryNumber), material, { now }));
  const parsed = "networkError" in response ? null : parseConsultarFacturaResponse(response.body, response.httpStatus);
  if (!parsed?.ok) {
    const error = parsed ? parsed.error : (response as { networkError: string }).networkError;
    await db.update(einvoiceDocument).set({ faceLastError: error.slice(0, 2000), faceCheckedAt: now }).where(eq(einvoiceDocument.id, row.id));
    throw new HttpError(502, `No se pudo consultar el estado en FACe. ${error}`);
  }
  const { processing, cancellation } = parsed.data;
  await db.update(einvoiceDocument).set({
    faceProcessingCode: processing?.code ?? row.faceProcessingCode,
    faceProcessingDescription: processing ? processing.description : row.faceProcessingDescription,
    faceProcessingReason: processing ? processing.reason : row.faceProcessingReason,
    faceCancellationCode: cancellation?.code ?? row.faceCancellationCode,
    faceCancellationDescription: cancellation ? cancellation.description : row.faceCancellationDescription,
    faceCancellationReason: cancellation ? cancellation.reason : row.faceCancellationReason,
    faceCheckedAt: now,
    faceLastError: null,
  }).where(eq(einvoiceDocument.id, row.id));
  const [updated] = await db.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, row.id));
  return faceInfo(updated);
}

/** Solicita a FACe la anulación de la factura remitida (la decide el órgano destinatario). */
export async function requestFaceCancellation(actor: EInvoiceActor, invoiceId: string, input: { reason: string }, options: FaceServiceOptions = {}): Promise<FaceSubmissionInfo | null> {
  const now = options.now ?? new Date();
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Indica el motivo de la anulación: lo verá el órgano destinatario.");
  const { row, environment, registryNumber } = await submitted(actor, invoiceId, options.env);
  const material = await signingMaterial(actor.companyId, now);
  const transport = options.transport ?? createFaceHttpsTransport();
  const response = await call(transport, environment, "anularFactura", buildFaceEnvelope(anularFacturaBody(registryNumber, reason.slice(0, 1000)), material, { now }));
  const parsed = "networkError" in response ? null : parseAnularFacturaResponse(response.body, response.httpStatus);
  if (!parsed?.ok) {
    const error = parsed ? parsed.error : (response as { networkError: string }).networkError;
    await db.update(einvoiceDocument).set({ faceLastError: error.slice(0, 2000), faceCheckedAt: now }).where(eq(einvoiceDocument.id, row.id));
    throw new HttpError(502, `FACe no ha aceptado la solicitud de anulación. ${error}`);
  }
  await db.update(einvoiceDocument).set({ faceCancellationDescription: parsed.data.message, faceLastError: null, faceCheckedAt: now }).where(eq(einvoiceDocument.id, row.id));
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "einvoice.face.cancel", entityName: "invoice", entityId: invoiceId, payload: { environment, registryNumber, reason, message: parsed.data.message } });
  // El estado de anulación definitivo lo da la consulta; si falla, queda la respuesta de la solicitud.
  try {
    return await refreshFaceStatus(actor, invoiceId, { ...options, transport, now });
  } catch {
    const [updated] = await db.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, row.id));
    return faceInfo(updated);
  }
}
