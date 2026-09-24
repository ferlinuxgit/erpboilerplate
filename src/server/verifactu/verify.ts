import { asc, eq } from "drizzle-orm";

import { verifactuChainHead, verifactuEvent, verifactuRecord } from "@/db/schema";
import { db } from "@/lib/db";
import { appendEvent } from "@/server/verifactu/chain";
import { computeEventHash, recomputeRecordHash, type StoredRecordForHash } from "@/server/verifactu/hash";

export type ChainAnomaly = { sequence: number | null; code: string; message: string };

export type ChainVerification = {
  ok: boolean;
  recordCount: number;
  eventCount: number;
  lastSequence: number;
  lastHash: string | null;
  anomalies: ChainAnomaly[];
  checkedAt: string;
};

export type VerifiableRecord = StoredRecordForHash & {
  id: string;
  sequence: number;
  hash: string;
  previousRecordId: string | null;
  previousIssuerTaxId: string | null;
  previousInvoiceNumber: string | null;
  previousInvoiceIssueDate: string | null;
};

export type VerifiableEvent = {
  companyId: string;
  sequence: number;
  eventType: string;
  description: string;
  payload: unknown;
  previousHash: string | null;
  hash: string;
  generatedAtText: string;
};

/** Verificación pura de la cadena (ordenada por secuencia): huellas, enlaces y continuidad. */
export function verifyRecordChain(
  records: VerifiableRecord[],
  head: { lastRecordId: string | null; lastSequence: number; lastHash: string | null } | null,
  events: VerifiableEvent[] = [],
): Omit<ChainVerification, "checkedAt" | "eventCount"> {
  const anomalies: ChainAnomaly[] = [];
  let previous: VerifiableRecord | null = null;
  records.forEach((record, index) => {
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence) {
      anomalies.push({ sequence: record.sequence, code: "SEQUENCE_GAP", message: `Se esperaba el registro n.º ${expectedSequence} y aparece el ${record.sequence}.` });
    }
    const recomputed = recomputeRecordHash(record);
    if (recomputed !== record.hash) {
      anomalies.push({ sequence: record.sequence, code: "HASH_MISMATCH", message: `La huella guardada del registro ${record.sequence} (${record.invoiceNumber}) no coincide con la recalculada.` });
    }
    if (previous === null) {
      if (record.previousRecordId || record.previousHash) {
        anomalies.push({ sequence: record.sequence, code: "FIRST_HAS_PREVIOUS", message: "El primer registro no debería tener registro anterior." });
      }
    } else {
      const linked = record.previousRecordId === previous.id
        && record.previousHash === previous.hash
        && record.previousIssuerTaxId === previous.issuerTaxId
        && record.previousInvoiceNumber === previous.invoiceNumber
        && record.previousInvoiceIssueDate === previous.invoiceIssueDate;
      if (!linked) {
        anomalies.push({ sequence: record.sequence, code: "BROKEN_LINK", message: `El registro ${record.sequence} no enlaza con el registro ${previous.sequence}.` });
      }
    }
    previous = record;
  });

  const last = records.at(-1) ?? null;
  if (head && (head.lastSequence !== (last?.sequence ?? 0) || head.lastHash !== (last?.hash ?? null) || head.lastRecordId !== (last?.id ?? null))) {
    anomalies.push({ sequence: null, code: "HEAD_MISMATCH", message: "La cabeza de la cadena no apunta al último registro." });
  }

  let previousEventHash: string | null = null;
  events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      anomalies.push({ sequence: null, code: "EVENT_SEQUENCE_GAP", message: `Falta el evento n.º ${index + 1} del registro de eventos.` });
    }
    const recomputed = computeEventHash(event);
    if (recomputed !== event.hash || event.previousHash !== previousEventHash) {
      anomalies.push({ sequence: null, code: "EVENT_HASH_MISMATCH", message: `El evento n.º ${event.sequence} del registro de eventos está alterado o desencadenado.` });
    }
    previousEventHash = event.hash;
  });

  return { ok: anomalies.length === 0, recordCount: records.length, lastSequence: last?.sequence ?? 0, lastHash: last?.hash ?? null, anomalies };
}

/** Recalcula toda la cadena de la empresa y deja constancia en el registro de eventos. */
export async function verifyCompanyChain(companyId: string, actorUserId: string | null): Promise<ChainVerification> {
  const [records, [head], events] = await Promise.all([
    db.select().from(verifactuRecord).where(eq(verifactuRecord.companyId, companyId)).orderBy(asc(verifactuRecord.sequence)),
    db.select().from(verifactuChainHead).where(eq(verifactuChainHead.companyId, companyId)).limit(1),
    db.select().from(verifactuEvent).where(eq(verifactuEvent.companyId, companyId)).orderBy(asc(verifactuEvent.sequence)),
  ]);
  const result = verifyRecordChain(records, head ?? null, events);
  const checkedAt = new Date();
  await db.transaction((tx) => appendEvent(tx, {
    companyId,
    eventType: result.ok ? "CHAIN_VERIFIED" : "ANOMALY_DETECTED",
    description: result.ok
      ? `Verificación de integridad correcta: ${result.recordCount} registro(s) y ${events.length} evento(s).`
      : `Verificación de integridad con ${result.anomalies.length} anomalía(s).`,
    payload: { recordCount: result.recordCount, anomalies: result.anomalies.slice(0, 50) },
    actorUserId,
  }, checkedAt));
  return { ...result, eventCount: events.length, checkedAt: checkedAt.toISOString() };
}
