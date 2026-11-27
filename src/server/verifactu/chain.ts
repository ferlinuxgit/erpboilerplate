import { and, eq } from "drizzle-orm";

import { verifactuChainHead, verifactuEvent, verifactuRecord } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { formatAeatDateTime } from "@/server/verifactu/format";
import { computeAltaHash, computeAnulacionHash, computeEventHash } from "@/server/verifactu/hash";
import type { VerifactuAltaContent } from "@/server/verifactu/mapping";
import { requireVerifactuEnvironment, type VerifactuEnvironment, type VerifactuSystemInfo } from "@/server/verifactu/config";

/**
 * Encadenamiento de registros VeriFactu.
 *
 * Todo ocurre dentro de la transacción de emisión: se bloquea la cabeza de la cadena de la empresa
 * (`verifactu_chain_head` … FOR UPDATE), se lee el registro anterior, se calcula la huella y se
 * inserta el registro con la secuencia siguiente. Dos emisiones concurrentes se serializan en el
 * bloqueo; además, los índices únicos (empresa, entorno, secuencia) y (empresa, registro anterior)
 * impiden una bifurcación aunque alguien escribiera sin pasar por aquí.
 *
 * Hay una cadena por empresa Y entorno de la AEAT: los registros de pruebas y los de producción
 * nunca se encadenan entre sí. El entorno se fija al crear el registro y ya no cambia.
 */

export type VerifactuRecordRow = typeof verifactuRecord.$inferSelect;
export type VerifactuMode = "VERIFACTU" | "NO_VERIFACTU";

type ChainHead = typeof verifactuChainHead.$inferSelect;

const headOf = (companyId: string, environment: VerifactuEnvironment) =>
  and(eq(verifactuChainHead.companyId, companyId), eq(verifactuChainHead.environment, environment));

export async function lockChainHead(tx: DbClient, companyId: string, environment: VerifactuEnvironment): Promise<ChainHead> {
  await tx.insert(verifactuChainHead).values({ companyId, environment }).onConflictDoNothing();
  const [head] = await tx
    .select()
    .from(verifactuChainHead)
    .where(headOf(companyId, environment))
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
  /** Entorno de la AEAT en el que nace el registro (el del despliegue que lo genera). */
  environment: VerifactuEnvironment;
  issuerTaxId: string;
  issuerName: string;
  invoiceNumber: string;
  invoiceIssueDate: string;
  systemInfo: VerifactuSystemInfo;
};

export type AltaDraft = BaseDraft & {
  content: VerifactuAltaContent;
  /** Alta que corrige un registro anterior de la misma factura. */
  subsanacion?: "S" | null;
  /** "X": el alta anterior fue rechazada; "S": la subsanación anterior fue rechazada. */
  rechazoPrevio?: "S" | "X" | null;
};

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
  const head = await lockChainHead(tx, draft.companyId, draft.environment);
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
      environment: draft.environment,
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
    .where(headOf(draft.companyId, draft.environment));

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
        subsanacion: draft.subsanacion ?? null,
        rechazoPrevio: draft.rechazoPrevio ?? null,
        operationDate: draft.content.operationDate ?? null,
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
export function appendAnulacionRecord(tx: DbClient, draft: BaseDraft & { rechazoPrevio?: "S" | null }, now = new Date()) {
  return insertChained(tx, draft, (chain) => ({
    hash: computeAnulacionHash({
      issuerTaxId: draft.issuerTaxId,
      invoiceNumber: draft.invoiceNumber,
      invoiceIssueDate: draft.invoiceIssueDate,
      previousHash: chain.previousHash,
      generatedAtText: chain.generatedAtText,
    }),
    values: { recordType: "ANULACION", rechazoPrevio: draft.rechazoPrevio ?? null },
  }), now);
}

export type VerifactuEventType =
  | "SYSTEM_START"
  | "MODE_CHANGED"
  | "CHAIN_VERIFIED"
  | "ANOMALY_DETECTED"
  | "EXPORT"
  | "SUBMISSION"
  | "SUBMISSION_ERROR"
  | "SUBSANACION";

/**
 * Registro de eventos encadenado (misma cabeza de cadena, secuencia propia). Como la cadena, es
 * uno por empresa y entorno: sin `environment` se anota en el del despliegue.
 */
export async function appendEvent(
  tx: DbClient,
  input: { companyId: string; environment?: VerifactuEnvironment; eventType: VerifactuEventType; description: string; payload?: Record<string, unknown>; actorUserId?: string | null },
  now = new Date(),
) {
  const environment = input.environment ?? requireVerifactuEnvironment();
  const head = await lockChainHead(tx, input.companyId, environment);
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
      environment,
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
    .where(headOf(input.companyId, environment));
  return created;
}
