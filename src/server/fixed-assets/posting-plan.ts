import type { PendingPosting } from "@/server/fixed-assets/schedule";

/** Motivo por el que una fecha no admite apuntes (ejercicio cerrado o inexistente, periodo fiscal presentado). */
export type PostingBlock = { code: string; message: string };

export type PlannedPosting = {
  start: string;
  end: string;
  amountCents: number;
  label: string;
  /** Parte del importe que viene de periodos anteriores bloqueados del mismo ejercicio. */
  carriedCents: number;
};

export type AssetPostingPlan = {
  postings: PlannedPosting[];
  /** Lo que no se ha podido contabilizar y por qué; a partir de ahí el bien se deja sin tocar. */
  blocked: { amountCents: number; periodEnd: string; reason: string } | null;
};

type Carry = { amountCents: number; start: string; end: string; fiscalEnd: string; reason: string };

/** Código de error de un periodo con el modelo de IVA presentado (`FiscalPeriodLockedError`). */
export const FISCAL_PERIOD_LOCKED = "FISCAL_PERIOD_LOCKED";

/**
 * Decide qué dotaciones pendientes de un bien se contabilizan respetando los bloqueos:
 * - Ejercicio cerrado o sin abrir: el bien se detiene ahí (nunca se pasa gasto de un ejercicio a otro).
 * - Periodo con el modelo de IVA presentado: su cuota se acumula en el siguiente periodo abierto del
 *   MISMO ejercicio (el gasto anual no cambia); si no lo hay, el bien se detiene.
 */
export async function planAssetPostings(pending: readonly PendingPosting[], checkOpen: (date: string) => Promise<PostingBlock | null>): Promise<AssetPostingPlan> {
  const postings: PlannedPosting[] = [];
  let carry = null as Carry | null;

  for (const period of pending) {
    const previous: Carry | null = carry;
    if (previous && period.fiscalEnd !== previous.fiscalEnd) break;
    const block = await checkOpen(period.end);
    if (block) {
      if (block.code !== FISCAL_PERIOD_LOCKED) {
        return { postings, blocked: { amountCents: period.amountCents + (previous?.amountCents ?? 0), periodEnd: period.end, reason: block.message } };
      }
      carry = {
        amountCents: (previous?.amountCents ?? 0) + period.amountCents,
        start: previous?.start ?? period.start,
        end: period.end,
        fiscalEnd: period.fiscalEnd,
        reason: block.message,
      };
      continue;
    }
    postings.push({
      start: previous?.start ?? period.start,
      end: period.end,
      amountCents: period.amountCents + (previous?.amountCents ?? 0),
      label: period.label,
      carriedCents: previous?.amountCents ?? 0,
    });
    carry = null;
  }

  return { postings, blocked: carry ? { amountCents: carry.amountCents, periodEnd: carry.end, reason: carry.reason } : null };
}
