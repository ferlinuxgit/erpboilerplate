import { and, eq, ne } from "drizzle-orm";

import { documentSeries } from "@/db/schema";
import { db, type AppDbTransaction } from "@/lib/db";
import { defaultSeriesFormat } from "@/lib/document-series-format";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { effectiveNextNumber, type SeriesRow } from "@/server/documents/series";

type SeriesType = SeriesRow["type"];

export type SeriesActor = { tenantId: string; companyId: string; actorUserId: string; fiscalYearId: string };

type GapConfirmation = {
  /** Confirmación explícita para saltar números (dejar huecos en la numeración). */
  confirmGap?: boolean;
  gapReason?: string;
};

export type UpsertSeriesInput = GapConfirmation & {
  type: SeriesType;
  prefix: string;
  format?: string;
  nextNumber?: number;
};

export type CreateSeriesInput = GapConfirmation & {
  type: SeriesType;
  /** Código corto único por tipo y ejercicio ("T", "EXP"…). */
  code: string;
  name: string;
  prefix: string;
  format?: string;
  nextNumber?: number;
  isDefault?: boolean;
};

export type UpdateSeriesInput = GapConfirmation & {
  name?: string;
  prefix?: string;
  format?: string;
  nextNumber?: number;
  isDefault?: boolean;
  isActive?: boolean;
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
 * La reserva usa el máximo `nextNumber` de la misma serie (tipo + código) en todos los ejercicios
 * (`effective`), así que:
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

/** Código de serie normalizado: mayúsculas, letras, números y guiones (1–10 caracteres). */
export function normalizeSeriesCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,10}$/.test(normalized)) {
    throw new HttpError(400, "El código de la serie solo admite letras, números y guiones (máximo 10 caracteres), p. ej. T o EXP.");
  }
  return normalized;
}

async function lockSameType(tx: AppDbTransaction, companyId: string, type: SeriesType): Promise<SeriesRow[]> {
  return tx
    .select()
    .from(documentSeries)
    .where(and(eq(documentSeries.companyId, companyId), eq(documentSeries.type, type)))
    .for("update");
}

/** Aplica la regla de integridad de numeración: lanza si retrocede o si deja huecos sin confirmar. */
function checkNextNumber(input: GapConfirmation & { nextNumber?: number }, current: number, effective: number) {
  const decision = decideNextNumber({ requested: input.nextNumber, current, effective });
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
  return decision;
}

function changesNumber(decision: NextNumberDecision) {
  return decision.kind === "sync" || decision.kind === "gap";
}

async function auditGap(
  tx: AppDbTransaction,
  actor: SeriesActor,
  seriesId: string,
  type: SeriesType,
  decision: NextNumberDecision,
  input: GapConfirmation & { nextNumber?: number },
) {
  if (decision.kind !== "gap") return;
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "documentSeries.gap",
    entityName: "documentSeries",
    entityId: seriesId,
    payload: { type, from: decision.effective, to: input.nextNumber, skipped: decision.skipped, reason: input.gapReason?.trim() },
  }, tx);
}

/**
 * Quita la marca de "por defecto" al resto de series del mismo tipo y ejercicio. Se hace antes de
 * marcar la nueva: el índice único parcial solo admite una serie por defecto.
 */
async function clearOtherDefaults(tx: AppDbTransaction, companyId: string, fiscalYearId: string, type: SeriesType, keepId: string | null) {
  await tx
    .update(documentSeries)
    .set({ isDefault: false })
    .where(and(
      eq(documentSeries.companyId, companyId),
      eq(documentSeries.fiscalYearId, fiscalYearId),
      eq(documentSeries.type, type),
      eq(documentSeries.isDefault, true),
      ...(keepId ? [ne(documentSeries.id, keepId)] : []),
    ));
}

/**
 * Actualiza (o crea) la serie POR DEFECTO de un tipo en el ejercicio activo. Compatibilidad con
 * integraciones y formularios que no conocen las series múltiples.
 */
export async function upsertDocumentSeries(actor: SeriesActor, input: UpsertSeriesInput) {
  return db.transaction(async (tx) => {
    const sameType = await lockSameType(tx, actor.companyId, input.type);
    const inYear = sameType.filter((series) => series.fiscalYearId === actor.fiscalYearId);
    const existing = inYear.find((series) => series.isDefault !== false) ?? inYear[0] ?? null;
    const effective = existing
      ? effectiveNextNumber(sameType, existing)
      : Math.max(1, ...sameType.filter((series) => (series.code ?? "GEN") === "GEN").map((series) => series.nextNumber));
    const decision = checkNextNumber(input, existing?.nextNumber ?? effective, effective);

    const values = {
      prefix: input.prefix,
      format: input.format ?? defaultSeriesFormat,
      ...(changesNumber(decision) ? { nextNumber: input.nextNumber! } : {}),
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
    await auditGap(tx, actor, saved.id, input.type, decision, input);
    return { series: saved, created: !existing };
  });
}

/**
 * Crea una serie adicional (tickets, exportación…) en el ejercicio activo. Si la misma serie (código)
 * existió en otros ejercicios, continúa su numeración. La primera serie del tipo queda por defecto.
 */
export async function createDocumentSeries(actor: SeriesActor, input: CreateSeriesInput) {
  const code = normalizeSeriesCode(input.code);
  return db.transaction(async (tx) => {
    const sameType = await lockSameType(tx, actor.companyId, input.type);
    const inYear = sameType.filter((series) => series.fiscalYearId === actor.fiscalYearId);
    if (inYear.some((series) => series.code === code)) {
      throw new HttpError(409, `Ya existe una serie con el código ${code} para este tipo de documento en el ejercicio activo.`);
    }
    const sameCode = sameType.filter((series) => series.code === code);
    const effective = sameCode.length > 0 ? Math.max(...sameCode.map((series) => series.nextNumber)) : 1;
    const decision = checkNextNumber(input, effective, effective);
    const isDefault = Boolean(input.isDefault) || !inYear.some((series) => series.isDefault);
    if (isDefault) await clearOtherDefaults(tx, actor.companyId, actor.fiscalYearId, input.type, null);
    const [saved] = await tx
      .insert(documentSeries)
      .values({
        companyId: actor.companyId,
        fiscalYearId: actor.fiscalYearId,
        type: input.type,
        code,
        name: input.name.trim(),
        prefix: input.prefix,
        format: input.format ?? defaultSeriesFormat,
        nextNumber: changesNumber(decision) ? input.nextNumber! : effective,
        isDefault,
        isActive: true,
      })
      .returning();
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "documentSeries.create",
      entityName: "documentSeries",
      entityId: saved.id,
      payload: { type: input.type, code, name: saved.name, prefix: saved.prefix, format: saved.format, nextNumber: saved.nextNumber, isDefault },
    }, tx);
    await auditGap(tx, actor, saved.id, input.type, decision, input);
    return saved;
  });
}

/**
 * Edita una serie: nombre, prefijo, formato, siguiente número (con la regla de huecos), marcarla por
 * defecto o (des)activarla. El código no cambia: identifica la serie entre ejercicios.
 */
export async function updateDocumentSeries(actor: SeriesActor, seriesId: string, input: UpdateSeriesInput) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ type: documentSeries.type })
      .from(documentSeries)
      .where(and(eq(documentSeries.id, seriesId), eq(documentSeries.companyId, actor.companyId)))
      .limit(1);
    if (!target) return null;
    const sameType = await lockSameType(tx, actor.companyId, target.type);
    const existing = sameType.find((series) => series.id === seriesId);
    if (!existing) return null;

    const willBeActive = input.isActive ?? existing.isActive;
    const willBeDefault = input.isDefault ?? existing.isDefault;
    if (existing.isDefault && input.isDefault === false) {
      throw new HttpError(409, "Siempre debe haber una serie por defecto: marca otra serie como predeterminada y esta dejará de serlo.");
    }
    if (willBeDefault && !willBeActive) {
      throw new HttpError(409, "No puedes desactivar la serie por defecto. Marca antes otra serie como predeterminada.");
    }
    const decision = checkNextNumber(input, existing.nextNumber, effectiveNextNumber(sameType, existing));
    if (willBeDefault && !existing.isDefault) await clearOtherDefaults(tx, actor.companyId, existing.fiscalYearId, existing.type, existing.id);

    const [saved] = await tx
      .update(documentSeries)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(changesNumber(decision) ? { nextNumber: input.nextNumber! } : {}),
        isDefault: willBeDefault,
        isActive: willBeActive,
      })
      .where(and(eq(documentSeries.id, existing.id), eq(documentSeries.companyId, actor.companyId)))
      .returning();
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "documentSeries.update",
      entityName: "documentSeries",
      entityId: existing.id,
      payload: {
        type: existing.type,
        code: existing.code,
        previous: { name: existing.name, prefix: existing.prefix, format: existing.format, nextNumber: existing.nextNumber, isDefault: existing.isDefault, isActive: existing.isActive },
        next: { name: saved.name, prefix: saved.prefix, format: saved.format, nextNumber: saved.nextNumber, isDefault: saved.isDefault, isActive: saved.isActive },
      },
    }, tx);
    await auditGap(tx, actor, existing.id, existing.type, decision, input);
    return saved;
  });
}
