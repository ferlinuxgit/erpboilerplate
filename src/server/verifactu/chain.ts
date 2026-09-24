import { eq } from "drizzle-orm";

import { verifactuChainHead, verifactuEvent, verifactuRecord } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { formatAeatDateTime } from "@/server/verifactu/format";
import { computeAltaHash, computeAnulacionHash, computeEventHash } from "@/server/verifactu/hash";
import type { VerifactuAltaContent } from "@/server/verifactu/mapping";
import type { VerifactuSystemInfo } from "@/server/verifactu/config";

/**
 * Encadenamiento de registros VeriFactu.
 *
 * Todo ocurre dentro de la transacción de emisión: se bloquea la cabeza de la cadena de la empresa
 * (`verifactu_chain_head` … FOR UPDATE), se lee el registro anterior, se calcula la huella y se
 * inserta el registro con la secuencia siguiente. Dos emisiones concurrentes se serializan en el
 * bloqueo; además, los índices únicos (empresa, secuencia) y (empresa, registro anterior) impiden
 * una bifurcación aunque alguien escribiera sin pasar por aquí.
 */

export type VerifactuRecordRow = typeof verifactuRecord.$inferSelect;
export type VerifactuMode = "VERIFACTU" | "NO_VERIFACTU";

type ChainHead = typeof verifactuChainHead.$inferSelect;

export async function lockChainHead(tx: DbClient, companyId: string): Promise<ChainHead> {
  await tx.insert(verifactuChainHead).values({ companyId }).onConflictDoNothing();
  const [head] = await tx
    .select()
    .from(verifactuChainHead)
    .where(eq(verifactuChainHead.companyId, companyId))
    .for("update")
    .limit(1);
  if (!head) throw new Error("No se pudo bloquear la cadena VeriFactu de la empresa.");
  return head;
}

async function loadPrevious(tx: DbClient, head: ChainHead) {
  if (!head.lastRecordId) return null;
  const [previous] = await tx
    .select({
      id: verifactuRecord.id,
      issuerTaxId: verifactuRecord.issuerTaxId,
      invoiceNumber: verifactuRecord.invoiceNumber,
      invoiceIssueDate: verifactuRecord.invoiceIssueDate,
      hash: verifactuRecord.hash,
      generatedAt: verifactuRecord.generatedAt,
      sequence: verifactuRecord.sequence,
    })
    .from(verifactuRecord)
    .where(eq(verifactuRecord.id, head.lastRecordId))
    .limit(1);
  if (!previous || previous.sequence !== head.lastSequence || previous.hash !== head.lastHash) {
    throw new Error("La cabeza de la cadena VeriFactu no coincide con el último registro. Ejecuta la verificación de integridad.");
  }
  return previous;
}

/** La fecha de generación nunca retrocede respecto al registro anterior (relojes desajustados). */
function monotonicNow(now: Date, previous: Date | null | undefined) {
  if (previous && now.getTime() < previous.getTime() + 1000) return new Date(Math.floor(previous.getTime() / 1000) * 1000 + 1000);
  return new Date(Math.floor(now.getTime() / 1000) * 1000);
}

type BaseDraft = {
  companyId: string;
  invoiceId: string;
  mode: VerifactuMode;
  issuerTaxId: string;
  issuerName: string;
  invoiceNumber: string;
  invoiceIssueDate: string;
  systemInfo: VerifactuSystemInfo;
};

export type AltaDraft = BaseDraft & { content: VerifactuAltaContent };

function initialStatus(mode: VerifactuMode, now: Date) {
  return mode === "VERIFACTU"
    ? { status: "PENDING_SEND", nextAttemptAt: now }
    : { status: "NOT_REQUIRED", nextAttemptAt: null };
}

async function insertChained(
  tx: DbClient,
  draft: BaseDraft,
  build: (chain: { previousHash: string | null; generatedAtText: string }) => { hash: string; values: Partial<typeof verifactuRecord.$inferInsert> },
  now: Date,
): Promise<VerifactuRecordRow> {
  const head = await lockChainHead(tx, draft.companyId);
  const previous = await loadPrevious(tx, head);
  const generatedAt = monotonicNow(now, previous?.generatedAt);
  const generatedAtText = formatAeatDateTime(generatedAt);
  const { hash, values } = build({ previousHash: previous?.hash ?? null, generatedAtText });
  const sequence = head.lastSequence + 1;

  const [created] = await tx
    .insert(verifactuRecord)
    .values({
      companyId: draft.companyId,
      invoiceId: draft.invoiceId,
      mode: draft.mode,
      recordType: "ALTA",
      sequence,
      issuerTaxId: draft.issuerTaxId,
      issuerName: draft.issuerName,
      invoiceNumber: draft.invoiceNumber,
      invoiceIssueDate: draft.invoiceIssueDate,
      previousRecordId: previous?.id ?? null,
      previousIssuerTaxId: previous?.issuerTaxId ?? null,
      previousInvoiceNumber: previous?.invoiceNumber ?? null,
      previousInvoiceIssueDate: previous?.invoiceIssueDate ?? null,
      previousHash: previous?.hash ?? null,
      hash,
      generatedAt,
      generatedAtText,
      systemInfo: draft.systemInfo,
      ...initialStatus(draft.mode, generatedAt),
      ...values,
    })
    .returning();

  await tx
    .update(verifactuChainHead)
    .set({ lastRecordId: created.id, lastSequence: sequence, lastHash: hash, updatedAt: generatedAt })
    .where(eq(verifactuChainHead.companyId, draft.companyId));

  return created;
}

/** Registro de facturación de alta (factura o rectificativa emitida). */
export function appendAltaRecord(tx: DbClient, draft: AltaDraft, now = new Date()) {
  return insertChained(tx, draft, (chain) => {
    const hash = computeAltaHash({
      issuerTaxId: draft.issuerTaxId,
      invoiceNumber: draft.invoiceNumber,
      invoiceIssueDate: draft.invoiceIssueDate,
      invoiceTypeCode: draft.content.invoiceTypeCode,
      taxAmount: draft.content.taxAmount,
      totalAmount: draft.content.totalAmount,
      previousHash: chain.previousHash,
      generatedAtText: chain.generatedAtText,
    });
    return {
      hash,
      values: {
        recordType: "ALTA",
        invoiceTypeCode: draft.content.invoiceTypeCode,
        rectificationKind: draft.content.rectificationKind,
        rectifiedInvoices: draft.content.rectifiedInvoices,
        description: draft.content.description,
        recipient: draft.content.recipient,
        breakdown: draft.content.breakdown,
        taxAmount: draft.content.taxAmount,
        totalAmount: draft.content.totalAmount,
      },
    };
  }, now);
}

/** Registro de facturación de anulación de un alta anterior. */
export function appendAnulacionRecord(tx: DbClient, draft: BaseDraft, now = new Date()) {
  return insertChained(tx, draft, (chain) => ({
    hash: computeAnulacionHash({
      issuerTaxId: draft.issuerTaxId,
      invoiceNumber: draft.invoiceNumber,
      invoiceIssueDate: draft.invoiceIssueDate,
      previousHash: chain.previousHash,
      generatedAtText: chain.generatedAtText,
    }),
    values: { recordType: "ANULACION" },
  }), now);
}

export type VerifactuEventType =
  | "SYSTEM_START"
  | "MODE_CHANGED"
  | "CHAIN_VERIFIED"
  | "ANOMALY_DETECTED"
  | "EXPORT"
  | "SUBMISSION"
  | "SUBMISSION_ERROR";

/** Registro de eventos encadenado (misma cabeza de cadena, secuencia propia). */
export async function appendEvent(
  tx: DbClient,
  input: { companyId: string; eventType: VerifactuEventType; description: string; payload?: Record<string, unknown>; actorUserId?: string | null },
  now = new Date(),
) {
  const head = await lockChainHead(tx, input.companyId);
  const sequence = head.lastEventSequence + 1;
  const generatedAtText = formatAeatDateTime(now);
  const payload = input.payload ?? {};
  const hash = computeEventHash({
    companyId: input.companyId,
    sequence,
    eventType: input.eventType,
    description: input.description,
    payload,
    previousHash: head.lastEventHash,
    generatedAtText,
  });
  const [created] = await tx
    .insert(verifactuEvent)
    .values({
      companyId: input.companyId,
      sequence,
      eventType: input.eventType,
      description: input.description,
      payload,
      actorUserId: input.actorUserId ?? null,
      previousHash: head.lastEventHash,
      hash,
      generatedAtText,
      createdAt: now,
    })
    .returning();
  await tx
    .update(verifactuChainHead)
    .set({ lastEventSequence: sequence, lastEventHash: hash, updatedAt: now })
    .where(eq(verifactuChainHead.companyId, input.companyId));
  return created;
}
