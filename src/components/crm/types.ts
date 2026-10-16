import type { CrmActivityType, CrmStageKind } from "@/modules/crm/model";

/** Datos serializados que las páginas del CRM pasan a sus componentes cliente. */
export type CrmStageView = { id: string; name: string; probability: number; kind: CrmStageKind; position: number };

export type CrmOpportunityView = {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  stageId: string;
  amount: number;
  expectedCloseDate: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  source: string | null;
  notes: string | null;
  status: CrmStageKind;
  lostReason: string | null;
  closedAt: string | null;
  salesQuoteId: string | null;
};

export type CrmActivityView = {
  id: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  customerId: string | null;
  customerName: string | null;
  type: CrmActivityType;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
};

export type CrmOption = { id: string; name: string };

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export function serializeOpportunity(row: Omit<CrmOpportunityView, "expectedCloseDate" | "closedAt"> & { expectedCloseDate: Date | null; closedAt: Date | null }): CrmOpportunityView {
  return {
    id: row.id,
    title: row.title,
    customerId: row.customerId,
    customerName: row.customerName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    stageId: row.stageId,
    amount: row.amount,
    expectedCloseDate: iso(row.expectedCloseDate),
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    source: row.source,
    notes: row.notes,
    status: row.status,
    lostReason: row.lostReason,
    closedAt: iso(row.closedAt),
    salesQuoteId: row.salesQuoteId,
  };
}

export function serializeActivity(row: Omit<CrmActivityView, "dueAt" | "completedAt"> & { dueAt: Date | null; completedAt: Date | null }): CrmActivityView {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    opportunityTitle: row.opportunityTitle,
    customerId: row.customerId,
    customerName: row.customerName,
    type: row.type,
    subject: row.subject,
    notes: row.notes,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    assignedUserId: row.assignedUserId,
    assignedName: row.assignedName,
  };
}

export function serializeStage(row: CrmStageView): CrmStageView {
  return { id: row.id, name: row.name, probability: row.probability, kind: row.kind, position: row.position };
}

/** yyyy-mm-dd de un ISO (para inputs de fecha) y vuelta a ISO a mediodía UTC (sin saltos de día). */
export function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export function dateInputToIso(value: string) {
  return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : null;
}
