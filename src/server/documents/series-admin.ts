import { and, eq } from "drizzle-orm";

import { documentSeries } from "@/db/schema";
import { db } from "@/lib/db";
import { defaultSeriesFormat } from "@/lib/document-series-format";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";

type SeriesType = (typeof documentSeries.$inferSelect)["type"];

export type SeriesActor = { tenantId: string; companyId: string; actorUserId: string; fiscalYearId: string };

export type UpsertSeriesInput = {
  type: SeriesType;
  prefix: string;
  format?: string;
  nextNumber?: number;
  /** Confirmación explícita para saltar números (dejar huecos en la numeración). */
  confirmGap?: boolean;
  gapReason?: string;
};

/** Details of a numbering gap that needs explicit confirmation (returned by the API as `code: "SERIES_GAP"`). */
export type SeriesGapDetails = { from: number; to: number; skipped: number; reasonRequired: boolean };

/** 409 raised when a new next number would skip numbers and the gap was not confirmed with a reason. */
export class SeriesGapError extends HttpError {
  readonly code = "SERIES_GAP";
  readonly gap: SeriesGapDetails;

  constructor(message: string, gap: SeriesGapDetails) {
    super(409, message);
    this.name = "SeriesGapError";
    this.gap = gap;
  }
}

export type NextNumberDecision =
  | { kind: "unchanged" }
  | { kind: "sync"; nextNumber: number }
  | { kind: "backwards"; effective: number }
  | { kind: "gap"; effective: number; skipped: number };

/**
 * Regla de integridad de numeración (función pura).
 *
 * La reserva usa el máximo `nextNumber` de todas las series del tipo (`effective`), así que:
 * - no se permite fijar un número por debajo de `effective` (reutilizaría números ya emitidos);
 * - fijarlo por encima deja huecos: solo con confirmación explícita y motivo (auditado);
 * - repetir el valor actual de la serie o igualarlo a `effective` no cambia nada relevante.
 */
export function decideNextNumber(input: { requested?: number; current: number; effective: number }): NextNumberDecision {
  if (input.requested === undefined || input.requested === input.current) return { kind: "unchanged" };
  if (input.requested < input.effective) return { kind: "backwards", effective: input.effective };
  if (input.requested === input.effective) return { kind: "sync", nextNumber: input.requested };
  return { kind: "gap", effective: input.effective, skipped: input.requested - input.effective };
}

export async function upsertDocumentSeries(actor: SeriesActor, input: UpsertSeriesInput) {
  return db.transaction(async (tx) => {
    const sameType = await tx
      .select()
      .from(documentSeries)
      .where(and(eq(documentSeries.companyId, actor.companyId), eq(documentSeries.type, input.type)))
      .for("update");
    const existing = sameType.find((series) => series.fiscalYearId === actor.fiscalYearId) ?? null;
    const effective = sameType.length > 0 ? Math.max(...sameType.map((series) => series.nextNumber)) : 1;
    const decision = decideNextNumber({ requested: input.nextNumber, current: existing?.nextNumber ?? effective, effective });

    if (decision.kind === "backwards") {
      throw new HttpError(
        409,
        `El siguiente número no puede ser menor que ${decision.effective}: esos números ya se han usado o reservado y la numeración debe ser correlativa y sin duplicados.`,
      );
    }
    if (decision.kind === "gap") {
      const reason = input.gapReason?.trim() ?? "";
      if (!input.confirmGap || reason.length < 5) {
        throw new SeriesGapError(
          input.confirmGap
            ? "Indica el motivo del salto de numeración (al menos 5 caracteres): quedará registrado en la auditoría."
            : `Pasar del ${decision.effective} al ${input.nextNumber} dejaría ${decision.skipped} número(s) sin usar en la serie. Si es intencionado (p. ej. migración desde otro programa), confirma el salto e indica el motivo.`,
          { from: decision.effective, to: input.nextNumber!, skipped: decision.skipped, reasonRequired: Boolean(input.confirmGap) },
        );
      }
    }

    const values = {
      prefix: input.prefix,
      format: input.format ?? defaultSeriesFormat,
      ...(decision.kind === "sync" || decision.kind === "gap" ? { nextNumber: input.nextNumber! } : {}),
    };
    const [saved] = existing
      ? await tx
          .update(documentSeries)
          .set(values)
          .where(and(eq(documentSeries.id, existing.id), eq(documentSeries.companyId, actor.companyId)))
          .returning()
      : await tx
          .insert(documentSeries)
          .values({ companyId: actor.companyId, fiscalYearId: actor.fiscalYearId, type: input.type, ...values, nextNumber: values.nextNumber ?? effective })
          .returning();

    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: existing ? "documentSeries.update" : "documentSeries.create",
      entityName: "documentSeries",
      entityId: saved.id,
      payload: {
        type: input.type,
        prefix: input.prefix,
        format: values.format,
        previousPrefix: existing?.prefix ?? null,
        previousFormat: existing?.format ?? null,
        previousNextNumber: existing?.nextNumber ?? null,
        nextNumber: saved.nextNumber,
      },
    }, tx);
    if (decision.kind === "gap") {
      await recordAudit({
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        action: "documentSeries.gap",
        entityName: "documentSeries",
        entityId: saved.id,
        payload: { type: input.type, from: decision.effective, to: input.nextNumber, skipped: decision.skipped, reason: input.gapReason?.trim() },
      }, tx);
    }
    return { series: saved, created: !existing };
  });
}
