/**
 * Modelo del CRM (sin servidor): etapas por defecto, etiquetas, previsión ponderada y agenda de
 * actividades. Lo usan las páginas, la API y los tests.
 */

export const CRM_STAGE_KINDS = ["OPEN", "WON", "LOST"] as const;
export type CrmStageKind = (typeof CRM_STAGE_KINDS)[number];

export const CRM_ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "TASK", "NOTE"] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export const crmActivityTypeLabels: Record<CrmActivityType, string> = {
  CALL: "Llamada",
  EMAIL: "Email",
  MEETING: "Reunión",
  TASK: "Tarea",
  NOTE: "Nota",
};

export const CRM_SOURCES = ["web", "referral", "phone", "email", "event", "social", "existing-customer", "other"] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];

export const crmSourceLabels: Record<CrmSource, string> = {
  web: "Web / formulario",
  referral: "Recomendación",
  phone: "Llamada entrante",
  email: "Email",
  event: "Feria o evento",
  social: "Redes sociales",
  "existing-customer": "Cliente actual",
  other: "Otro",
};

export const crmStatusLabels: Record<CrmStageKind, string> = { OPEN: "Abierta", WON: "Ganada", LOST: "Perdida" };

/** Embudo inicial de una empresa (se puede renombrar, reordenar y ampliar). */
export const DEFAULT_CRM_STAGES: ReadonlyArray<{ name: string; probability: number; kind: CrmStageKind }> = [
  { name: "Nuevo contacto", probability: 10, kind: "OPEN" },
  { name: "Cualificado", probability: 25, kind: "OPEN" },
  { name: "Propuesta enviada", probability: 50, kind: "OPEN" },
  { name: "Negociación", probability: 75, kind: "OPEN" },
  { name: "Ganada", probability: 100, kind: "WON" },
  { name: "Perdida", probability: 0, kind: "LOST" },
];

export type PipelineStage = { id: string; name: string; probability: number; kind: CrmStageKind; position: number };
export type PipelineOpportunity = { id: string; stageId: string; amount: number; status: CrmStageKind; closedAt?: Date | string | null };

const cents = (value: number) => Math.round(value * 100);

/** Importe abierto, previsión ponderada (importe × probabilidad de su etapa) y ganado en un periodo. */
export function pipelineSummary(stages: readonly PipelineStage[], opportunities: readonly PipelineOpportunity[], since: Date) {
  const probability = new Map(stages.map((stage) => [stage.id, stage.probability]));
  let openCount = 0;
  let openCents = 0;
  let weightedCents = 0;
  let wonCents = 0;
  let wonCount = 0;
  let lostCount = 0;
  for (const opportunity of opportunities) {
    if (opportunity.status === "OPEN") {
      openCount += 1;
      openCents += cents(opportunity.amount);
      weightedCents += Math.round((cents(opportunity.amount) * (probability.get(opportunity.stageId) ?? 0)) / 100);
      continue;
    }
    const closedAt = opportunity.closedAt ? new Date(opportunity.closedAt) : null;
    if (!closedAt || closedAt < since) continue;
    if (opportunity.status === "WON") {
      wonCount += 1;
      wonCents += cents(opportunity.amount);
    } else {
      lostCount += 1;
    }
  }
  const closed = wonCount + lostCount;
  return {
    openCount,
    openAmount: openCents / 100,
    weightedAmount: weightedCents / 100,
    wonCount,
    wonAmount: wonCents / 100,
    lostCount,
    /** % de oportunidades cerradas en el periodo que se ganaron (null si no se cerró ninguna). */
    winRate: closed > 0 ? Math.round((wonCount / closed) * 100) : null,
  };
}

/** Totales por columna del embudo. */
export function stageTotals(stages: readonly PipelineStage[], opportunities: readonly PipelineOpportunity[]) {
  return stages.map((stage) => {
    const inStage = opportunities.filter((opportunity) => opportunity.stageId === stage.id);
    return { stageId: stage.id, count: inStage.length, amount: inStage.reduce((sum, opportunity) => sum + cents(opportunity.amount), 0) / 100 };
  });
}

export type AgendaBucket = "overdue" | "today" | "upcoming" | "unscheduled" | "done";

export const agendaBucketLabels: Record<AgendaBucket, string> = {
  overdue: "Vencidas",
  today: "Hoy",
  upcoming: "Próximas",
  unscheduled: "Sin fecha",
  done: "Hechas",
};

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** En qué grupo de la agenda cae una actividad (por día en la zona horaria de la empresa). */
export function agendaBucket(activity: { dueAt?: Date | string | null; completedAt?: Date | string | null }, now: Date, timeZone = "Europe/Madrid"): AgendaBucket {
  if (activity.completedAt) return "done";
  if (!activity.dueAt) return "unscheduled";
  const due = new Date(activity.dueAt);
  const dueDay = dayKey(due, timeZone);
  const today = dayKey(now, timeZone);
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  return "upcoming";
}

/** Probabilidad y estado que corresponden a mover una oportunidad a una etapa. */
export function statusForStage(stage: Pick<PipelineStage, "kind">): CrmStageKind {
  return stage.kind;
}

/** Valida y normaliza el embudo editado: nombres únicos, una etapa de ganada y una de perdida como mínimo. */
export function validateStages(stages: ReadonlyArray<{ name: string; probability: number; kind: CrmStageKind }>): string | null {
  if (stages.length < 3) return "El embudo necesita al menos tres etapas (una abierta, una ganada y una perdida).";
  const names = stages.map((stage) => stage.name.trim().toLocaleLowerCase("es-ES"));
  if (names.some((name) => !name)) return "Todas las etapas necesitan nombre.";
  if (new Set(names).size !== names.length) return "Hay dos etapas con el mismo nombre.";
  if (!stages.some((stage) => stage.kind === "OPEN")) return "Falta al menos una etapa abierta.";
  if (!stages.some((stage) => stage.kind === "WON")) return "Falta una etapa de «ganada».";
  if (!stages.some((stage) => stage.kind === "LOST")) return "Falta una etapa de «perdida».";
  if (stages.some((stage) => !Number.isInteger(stage.probability) || stage.probability < 0 || stage.probability > 100)) return "La probabilidad va de 0 a 100.";
  return null;
}
