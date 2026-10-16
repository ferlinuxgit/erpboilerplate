import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";

import { crmActivity, crmOpportunity, crmStage, customer, membership, salesQuote, user } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { DEFAULT_CRM_STAGES, pipelineSummary, stageTotals, validateStages, type CrmActivityType, type CrmStageKind } from "@/modules/crm/model";
import { recordAudit } from "@/server/audit";
import { createCustomerWithPartner } from "@/server/customers/service";

export type CrmActor = { tenantId: string; companyId: string; actorUserId: string };

type StageRow = Omit<typeof crmStage.$inferSelect, "kind"> & { kind: CrmStageKind };

const asStages = (rows: Array<typeof crmStage.$inferSelect>): StageRow[] => rows.map((row) => ({ ...row, kind: row.kind as CrmStageKind }));

function money(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ---------------------------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------------------------

/** Etapas del embudo; la primera vez crea las de por defecto. */
export async function ensureStages(companyId: string, client: DbClient = db): Promise<StageRow[]> {
  const existing = await client.select().from(crmStage).where(eq(crmStage.companyId, companyId)).orderBy(asc(crmStage.position));
  if (existing.length > 0) return asStages(existing);
  await client
    .insert(crmStage)
    .values(DEFAULT_CRM_STAGES.map((stage, index) => ({ companyId, name: stage.name, probability: stage.probability, kind: stage.kind, position: index })))
    .onConflictDoNothing();
  return asStages(await client.select().from(crmStage).where(eq(crmStage.companyId, companyId)).orderBy(asc(crmStage.position)));
}

export type StageInput = { id?: string; name: string; probability: number; kind: CrmStageKind };

/**
 * Guarda el embudo completo (orden = el de la lista). Una etapa con oportunidades no se puede quitar;
 * si una etapa cambia de tipo, sus oportunidades pasan al estado nuevo.
 */
export async function saveStages(actor: CrmActor, input: StageInput[]) {
  const problem = validateStages(input);
  if (problem) throw new HttpError(400, problem);
  return db.transaction(async (tx) => {
    const current = await ensureStages(actor.companyId, tx);
    const keptIds = new Set(input.map((stage) => stage.id).filter(Boolean));
    if (input.some((stage) => stage.id && !current.some((row) => row.id === stage.id))) throw new HttpError(404, "Etapa no encontrada.");
    const removed = current.filter((row) => !keptIds.has(row.id));
    if (removed.length > 0) {
      const [used] = await tx
        .select({ stageId: crmOpportunity.stageId, count: sql<number>`count(*)::int` })
        .from(crmOpportunity)
        .where(and(eq(crmOpportunity.companyId, actor.companyId), inArray(crmOpportunity.stageId, removed.map((row) => row.id))))
        .groupBy(crmOpportunity.stageId)
        .limit(1);
      if (used) {
        const stage = removed.find((row) => row.id === used.stageId);
        throw new HttpError(409, `La etapa «${stage?.name}» tiene ${used.count} oportunidad${used.count === 1 ? "" : "es"}: muévelas a otra etapa antes de quitarla.`);
      }
      await tx.delete(crmStage).where(and(eq(crmStage.companyId, actor.companyId), inArray(crmStage.id, removed.map((row) => row.id))));
    }
    // Nombres temporales para poder intercambiar nombres sin chocar con el índice único.
    for (const row of current.filter((entry) => keptIds.has(entry.id))) {
      await tx.update(crmStage).set({ name: `__tmp_${row.id}` }).where(eq(crmStage.id, row.id));
    }
    for (const [position, stage] of input.entries()) {
      const values = { name: stage.name.trim(), probability: stage.probability, kind: stage.kind, position };
      if (stage.id) {
        await tx.update(crmStage).set(values).where(and(eq(crmStage.id, stage.id), eq(crmStage.companyId, actor.companyId)));
        const previous = current.find((row) => row.id === stage.id);
        if (previous && previous.kind !== stage.kind) {
          await tx
            .update(crmOpportunity)
            .set({ status: stage.kind, closedAt: stage.kind === "OPEN" ? null : new Date(), updatedAt: new Date() })
            .where(and(eq(crmOpportunity.companyId, actor.companyId), eq(crmOpportunity.stageId, stage.id)));
        }
      } else {
        await tx.insert(crmStage).values({ companyId: actor.companyId, ...values });
      }
    }
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_stage.update",
      entityName: "crm_stage",
      entityId: actor.companyId,
      payload: { stages: input.map((stage) => ({ name: stage.name, probability: stage.probability, kind: stage.kind })) },
    }, tx);
    return asStages(await tx.select().from(crmStage).where(eq(crmStage.companyId, actor.companyId)).orderBy(asc(crmStage.position)));
  });
}

// ---------------------------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------------------------

const opportunityColumns = {
  id: crmOpportunity.id,
  title: crmOpportunity.title,
  customerId: crmOpportunity.customerId,
  customerName: customer.name,
  contactName: crmOpportunity.contactName,
  contactEmail: crmOpportunity.contactEmail,
  contactPhone: crmOpportunity.contactPhone,
  stageId: crmOpportunity.stageId,
  amount: crmOpportunity.amount,
  expectedCloseDate: crmOpportunity.expectedCloseDate,
  ownerUserId: crmOpportunity.ownerUserId,
  ownerName: user.name,
  source: crmOpportunity.source,
  notes: crmOpportunity.notes,
  status: crmOpportunity.status,
  lostReason: crmOpportunity.lostReason,
  closedAt: crmOpportunity.closedAt,
  salesQuoteId: crmOpportunity.salesQuoteId,
  position: crmOpportunity.position,
  createdAt: crmOpportunity.createdAt,
  updatedAt: crmOpportunity.updatedAt,
};

export type OpportunityRow = {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  stageId: string;
  amount: number;
  expectedCloseDate: Date | null;
  ownerUserId: string | null;
  ownerName: string | null;
  source: string | null;
  notes: string | null;
  status: CrmStageKind;
  lostReason: string | null;
  closedAt: Date | null;
  salesQuoteId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

function toOpportunity(row: Omit<OpportunityRow, "amount" | "status"> & { amount: string; status: string }): OpportunityRow {
  return { ...row, amount: Number(row.amount), status: row.status as CrmStageKind };
}

export type OpportunityFilters = {
  status?: CrmStageKind | "ALL";
  ownerUserId?: string;
  customerId?: string;
  q?: string;
  /** Oportunidades cerradas desde esta fecha (las abiertas siempre). */
  closedSince?: Date;
  limit?: number;
};

export async function listOpportunities(companyId: string, filters: OpportunityFilters = {}): Promise<OpportunityRow[]> {
  const conditions: SQL[] = [eq(crmOpportunity.companyId, companyId)];
  if (filters.status && filters.status !== "ALL") conditions.push(eq(crmOpportunity.status, filters.status));
  if (filters.ownerUserId) conditions.push(eq(crmOpportunity.ownerUserId, filters.ownerUserId));
  if (filters.customerId) conditions.push(eq(crmOpportunity.customerId, filters.customerId));
  if (filters.closedSince) conditions.push(or(eq(crmOpportunity.status, "OPEN"), gte(crmOpportunity.closedAt, filters.closedSince)) as SQL);
  const query = filters.q?.trim();
  if (query) {
    const pattern = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    conditions.push(or(ilike(crmOpportunity.title, pattern), ilike(customer.name, pattern), ilike(crmOpportunity.contactName, pattern)) as SQL);
  }
  const rows = await db
    .select(opportunityColumns)
    .from(crmOpportunity)
    .leftJoin(customer, eq(customer.id, crmOpportunity.customerId))
    .leftJoin(user, eq(user.id, crmOpportunity.ownerUserId))
    .where(and(...conditions))
    .orderBy(asc(crmOpportunity.position), desc(crmOpportunity.updatedAt))
    .limit(filters.limit ?? 500);
  return rows.map(toOpportunity);
}

/** Embudo: etapas, oportunidades (abiertas y cerradas en los últimos 90 días) y resumen del mes. */
export async function getPipeline(companyId: string, filters: { ownerUserId?: string; q?: string } = {}) {
  const stages = await ensureStages(companyId);
  const since90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const opportunities = await listOpportunities(companyId, { ...filters, closedSince: since90 });
  const monthStart = startOfMonth();
  return {
    stages,
    opportunities,
    totals: stageTotals(stages, opportunities),
    summary: pipelineSummary(stages, opportunities, monthStart),
  };
}

async function assertStage(client: DbClient, companyId: string, stageId: string) {
  const [stage] = await client.select().from(crmStage).where(and(eq(crmStage.id, stageId), eq(crmStage.companyId, companyId))).limit(1);
  if (!stage) throw new HttpError(404, "Etapa no encontrada.");
  return asStages([stage])[0];
}

async function assertCustomer(client: DbClient, companyId: string, customerId: string) {
  const [row] = await client.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Cliente no encontrado.");
}

async function assertMember(client: DbClient, tenantId: string, userId: string) {
  const [row] = await client.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, tenantId), eq(membership.userId, userId))).limit(1);
  if (!row) throw new HttpError(404, "Ese usuario no es del equipo.");
}

async function nextPosition(client: DbClient, companyId: string, stageId: string) {
  const [row] = await client
    .select({ max: sql<number | null>`max(${crmOpportunity.position})` })
    .from(crmOpportunity)
    .where(and(eq(crmOpportunity.companyId, companyId), eq(crmOpportunity.stageId, stageId)));
  return (row?.max ?? -1) + 1;
}

export type OpportunityInput = {
  title: string;
  customerId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  stageId?: string | null;
  amount: number;
  expectedCloseDate?: Date | null;
  ownerUserId?: string | null;
  source?: string | null;
  notes?: string | null;
  lostReason?: string | null;
};

const clean = (value: string | null | undefined) => value?.trim() || null;

export async function createOpportunity(actor: CrmActor, input: OpportunityInput) {
  if (!input.customerId && !clean(input.contactName)) throw new HttpError(400, "Indica el cliente o, si aún no lo es, el nombre del contacto.");
  return db.transaction(async (tx) => {
    const stages = await ensureStages(actor.companyId, tx);
    const stage = input.stageId ? await assertStage(tx, actor.companyId, input.stageId) : stages.find((row) => row.kind === "OPEN") ?? stages[0];
    if (input.customerId) await assertCustomer(tx, actor.companyId, input.customerId);
    const ownerUserId = input.ownerUserId ?? actor.actorUserId;
    await assertMember(tx, actor.tenantId, ownerUserId);
    const [created] = await tx
      .insert(crmOpportunity)
      .values({
        companyId: actor.companyId,
        title: input.title.trim(),
        customerId: input.customerId || null,
        contactName: clean(input.contactName),
        contactEmail: clean(input.contactEmail),
        contactPhone: clean(input.contactPhone),
        stageId: stage.id,
        amount: money(input.amount),
        expectedCloseDate: input.expectedCloseDate ?? null,
        ownerUserId,
        source: clean(input.source),
        notes: clean(input.notes),
        status: stage.kind,
        lostReason: stage.kind === "LOST" ? clean(input.lostReason) : null,
        closedAt: stage.kind === "OPEN" ? null : new Date(),
        position: await nextPosition(tx, actor.companyId, stage.id),
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: crmOpportunity.id });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_opportunity.create",
      entityName: "crm_opportunity",
      entityId: created.id,
      payload: { title: input.title, amount: input.amount, stage: stage.name, customerId: input.customerId ?? null },
    }, tx);
    return created;
  });
}

async function loadOwnedOpportunity(client: DbClient, companyId: string, id: string) {
  const [row] = await client.select().from(crmOpportunity).where(and(eq(crmOpportunity.id, id), eq(crmOpportunity.companyId, companyId))).for("update").limit(1);
  if (!row) throw new HttpError(404, "Oportunidad no encontrada.");
  return row;
}

/** Nota automática en la cronología de la oportunidad (cambios de etapa, presupuesto creado…). */
async function logNote(client: DbClient, actor: CrmActor, opportunity: { id: string; customerId: string | null }, subject: string) {
  await client.insert(crmActivity).values({
    companyId: actor.companyId,
    opportunityId: opportunity.id,
    customerId: opportunity.customerId,
    type: "NOTE",
    subject,
    completedAt: new Date(),
    createdByUserId: actor.actorUserId,
  });
}

export async function updateOpportunity(actor: CrmActor, id: string, input: Partial<OpportunityInput>) {
  return db.transaction(async (tx) => {
    const current = await loadOwnedOpportunity(tx, actor.companyId, id);
    const customerId = input.customerId === undefined ? current.customerId : input.customerId || null;
    const contactName = input.contactName === undefined ? current.contactName : clean(input.contactName);
    if (!customerId && !contactName) throw new HttpError(400, "Indica el cliente o, si aún no lo es, el nombre del contacto.");
    if (customerId && customerId !== current.customerId) await assertCustomer(tx, actor.companyId, customerId);
    if (input.ownerUserId && input.ownerUserId !== current.ownerUserId) await assertMember(tx, actor.tenantId, input.ownerUserId);
    const stage = input.stageId && input.stageId !== current.stageId ? await assertStage(tx, actor.companyId, input.stageId) : null;
    const values: Partial<typeof crmOpportunity.$inferInsert> = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      customerId,
      contactName,
      ...(input.contactEmail !== undefined ? { contactEmail: clean(input.contactEmail) } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: clean(input.contactPhone) } : {}),
      ...(input.amount !== undefined ? { amount: money(input.amount) } : {}),
      ...(input.expectedCloseDate !== undefined ? { expectedCloseDate: input.expectedCloseDate } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.source !== undefined ? { source: clean(input.source) } : {}),
      ...(input.notes !== undefined ? { notes: clean(input.notes) } : {}),
      ...(input.lostReason !== undefined ? { lostReason: clean(input.lostReason) } : {}),
      ...(stage
        ? { stageId: stage.id, status: stage.kind, closedAt: stage.kind === "OPEN" ? null : new Date(), position: await nextPosition(tx, actor.companyId, stage.id) }
        : {}),
      updatedAt: new Date(),
    };
    await tx.update(crmOpportunity).set(values).where(eq(crmOpportunity.id, id));
    if (customerId !== current.customerId) {
      await tx.update(crmActivity).set({ customerId }).where(and(eq(crmActivity.companyId, actor.companyId), eq(crmActivity.opportunityId, id)));
    }
    if (stage) await logNote(tx, actor, { id, customerId }, `Movida a «${stage.name}»`);
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_opportunity.update",
      entityName: "crm_opportunity",
      entityId: id,
      payload: { ...input, expectedCloseDate: input.expectedCloseDate?.toISOString() ?? input.expectedCloseDate },
    }, tx);
    return { id };
  });
}

/**
 * Mueve una oportunidad a una etapa (y posición) del embudo: arrastrar en el kanban o «Mover a…».
 * Ganada/perdida fija la fecha de cierre; perdida admite el motivo.
 */
export async function moveOpportunity(actor: CrmActor, id: string, input: { stageId: string; index?: number; lostReason?: string | null }) {
  return db.transaction(async (tx) => {
    const current = await loadOwnedOpportunity(tx, actor.companyId, id);
    const stage = await assertStage(tx, actor.companyId, input.stageId);
    const siblings = await tx
      .select({ id: crmOpportunity.id })
      .from(crmOpportunity)
      .where(and(eq(crmOpportunity.companyId, actor.companyId), eq(crmOpportunity.stageId, stage.id), ne(crmOpportunity.id, id)))
      .orderBy(asc(crmOpportunity.position), desc(crmOpportunity.updatedAt));
    const index = Math.max(0, Math.min(input.index ?? siblings.length, siblings.length));
    const ordered = [...siblings.slice(0, index).map((row) => row.id), id, ...siblings.slice(index).map((row) => row.id)];
    for (const [position, rowId] of ordered.entries()) {
      if (rowId === id) continue;
      await tx.update(crmOpportunity).set({ position }).where(eq(crmOpportunity.id, rowId));
    }
    const stageChanged = current.stageId !== stage.id;
    await tx
      .update(crmOpportunity)
      .set({
        stageId: stage.id,
        position: index,
        status: stage.kind,
        ...(stageChanged ? { closedAt: stage.kind === "OPEN" ? null : new Date() } : {}),
        ...(stage.kind === "LOST" && input.lostReason !== undefined ? { lostReason: clean(input.lostReason) } : {}),
        ...(stage.kind !== "LOST" && stageChanged ? { lostReason: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(crmOpportunity.id, id));
    if (stageChanged) {
      const label = stage.kind === "WON" ? "Ganada" : stage.kind === "LOST" ? `Perdida${clean(input.lostReason) ? `: ${clean(input.lostReason)}` : ""}` : `Movida a «${stage.name}»`;
      await logNote(tx, actor, current, label);
      await recordAudit({
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        action: "crm_opportunity.move",
        entityName: "crm_opportunity",
        entityId: id,
        payload: { fromStageId: current.stageId, toStageId: stage.id, status: stage.kind },
      }, tx);
    }
    return { id, stageId: stage.id, status: stage.kind as CrmStageKind };
  });
}

export async function deleteOpportunity(actor: CrmActor, id: string) {
  await db.transaction(async (tx) => {
    const current = await loadOwnedOpportunity(tx, actor.companyId, id);
    await tx.delete(crmOpportunity).where(eq(crmOpportunity.id, id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_opportunity.delete",
      entityName: "crm_opportunity",
      entityId: id,
      payload: { title: current.title, amount: Number(current.amount) },
    }, tx);
  });
}

/** Da de alta como cliente al contacto de una oportunidad (prospecto) y la vincula. */
export async function convertOpportunityContact(actor: CrmActor, id: string, input: Parameters<typeof createCustomerWithPartner>[2]) {
  return db.transaction(async (tx) => {
    const current = await loadOwnedOpportunity(tx, actor.companyId, id);
    if (current.customerId) throw new HttpError(409, "La oportunidad ya tiene cliente.");
    const created = await createCustomerWithPartner(tx, actor.companyId, input);
    await tx.update(crmOpportunity).set({ customerId: created.id, updatedAt: new Date() }).where(eq(crmOpportunity.id, id));
    await tx.update(crmActivity).set({ customerId: created.id }).where(and(eq(crmActivity.companyId, actor.companyId), eq(crmActivity.opportunityId, id)));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "customer.create",
      entityName: "customer",
      entityId: created.id,
      payload: { origin: "crm", opportunityId: id, name: created.name },
    }, tx);
    await logNote(tx, actor, { id, customerId: created.id }, `Alta como cliente: ${created.name}`);
    return { customerId: created.id, customerName: created.name };
  });
}

/** Vincula un presupuesto recién creado a su oportunidad (desde «Crear presupuesto»). */
export async function linkQuoteToOpportunity(client: DbClient, actor: CrmActor, input: { opportunityId: string; salesQuoteId: string; quoteNumber: string; customerId: string }) {
  const [current] = await client
    .select({ id: crmOpportunity.id, customerId: crmOpportunity.customerId })
    .from(crmOpportunity)
    .where(and(eq(crmOpportunity.id, input.opportunityId), eq(crmOpportunity.companyId, actor.companyId)))
    .limit(1);
  if (!current) return;
  await client
    .update(crmOpportunity)
    .set({ salesQuoteId: input.salesQuoteId, customerId: current.customerId ?? input.customerId, updatedAt: new Date() })
    .where(eq(crmOpportunity.id, current.id));
  await logNote(client, actor, { id: current.id, customerId: current.customerId ?? input.customerId }, `Presupuesto ${input.quoteNumber} creado`);
}

export async function getOpportunity(companyId: string, id: string) {
  const [row] = await db
    .select(opportunityColumns)
    .from(crmOpportunity)
    .leftJoin(customer, eq(customer.id, crmOpportunity.customerId))
    .leftJoin(user, eq(user.id, crmOpportunity.ownerUserId))
    .where(and(eq(crmOpportunity.id, id), eq(crmOpportunity.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const [stages, activities, quote] = await Promise.all([
    ensureStages(companyId),
    listActivities(companyId, { opportunityId: id, includeDone: true }),
    row.salesQuoteId
      ? db.select({ id: salesQuote.id, number: salesQuote.number, totalAmount: salesQuote.totalAmount, status: salesQuote.status }).from(salesQuote).where(and(eq(salesQuote.id, row.salesQuoteId), eq(salesQuote.companyId, companyId))).limit(1)
      : Promise.resolve([]),
  ]);
  return { opportunity: toOpportunity(row), stages, activities, quote: quote[0] ?? null };
}

// ---------------------------------------------------------------------------------------------
// Actividades
// ---------------------------------------------------------------------------------------------

export type ActivityRow = {
  id: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  customerId: string | null;
  customerName: string | null;
  type: CrmActivityType;
  subject: string;
  notes: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  assignedUserId: string | null;
  assignedName: string | null;
  createdAt: Date;
};

export type ActivityFilters = {
  opportunityId?: string;
  customerId?: string;
  assignedUserId?: string;
  includeDone?: boolean;
  /** Solo hechas (agenda: «Hechas», las más recientes). */
  doneOnly?: boolean;
  limit?: number;
};

export async function listActivities(companyId: string, filters: ActivityFilters = {}): Promise<ActivityRow[]> {
  const conditions: SQL[] = [eq(crmActivity.companyId, companyId)];
  if (filters.opportunityId) conditions.push(eq(crmActivity.opportunityId, filters.opportunityId));
  if (filters.customerId) conditions.push(eq(crmActivity.customerId, filters.customerId));
  if (filters.assignedUserId) conditions.push(eq(crmActivity.assignedUserId, filters.assignedUserId));
  if (filters.doneOnly) conditions.push(isNotNull(crmActivity.completedAt));
  else if (!filters.includeDone) conditions.push(isNull(crmActivity.completedAt));
  const rows = await db
    .select({
      id: crmActivity.id,
      opportunityId: crmActivity.opportunityId,
      opportunityTitle: crmOpportunity.title,
      customerId: crmActivity.customerId,
      customerName: customer.name,
      type: crmActivity.type,
      subject: crmActivity.subject,
      notes: crmActivity.notes,
      dueAt: crmActivity.dueAt,
      completedAt: crmActivity.completedAt,
      assignedUserId: crmActivity.assignedUserId,
      assignedName: user.name,
      createdAt: crmActivity.createdAt,
    })
    .from(crmActivity)
    .leftJoin(crmOpportunity, eq(crmOpportunity.id, crmActivity.opportunityId))
    .leftJoin(customer, eq(customer.id, crmActivity.customerId))
    .leftJoin(user, eq(user.id, crmActivity.assignedUserId))
    .where(and(...conditions))
    .orderBy(filters.doneOnly || filters.includeDone ? desc(sql`coalesce(${crmActivity.completedAt}, ${crmActivity.dueAt}, ${crmActivity.createdAt})`) : asc(sql`coalesce(${crmActivity.dueAt}, 'infinity'::timestamptz)`), desc(crmActivity.createdAt))
    .limit(filters.limit ?? 300);
  return rows.map((row) => ({ ...row, type: row.type as CrmActivityType }));
}

export type ActivityInput = {
  type: CrmActivityType;
  subject: string;
  notes?: string | null;
  dueAt?: Date | null;
  opportunityId?: string | null;
  customerId?: string | null;
  assignedUserId?: string | null;
  completed?: boolean;
};

export async function createActivity(actor: CrmActor, input: ActivityInput) {
  return db.transaction(async (tx) => {
    let customerId = input.customerId || null;
    if (input.opportunityId) {
      const opportunity = await loadOwnedOpportunity(tx, actor.companyId, input.opportunityId);
      customerId = customerId ?? opportunity.customerId;
    }
    if (customerId) await assertCustomer(tx, actor.companyId, customerId);
    const assignedUserId = input.assignedUserId ?? actor.actorUserId;
    await assertMember(tx, actor.tenantId, assignedUserId);
    // Una nota es un registro de algo que ya pasó: se guarda como hecha.
    const done = input.completed ?? input.type === "NOTE";
    const [created] = await tx
      .insert(crmActivity)
      .values({
        companyId: actor.companyId,
        opportunityId: input.opportunityId || null,
        customerId,
        type: input.type,
        subject: input.subject.trim(),
        notes: clean(input.notes),
        dueAt: input.dueAt ?? null,
        completedAt: done ? new Date() : null,
        assignedUserId,
        createdByUserId: actor.actorUserId,
      })
      .returning({ id: crmActivity.id });
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_activity.create",
      entityName: "crm_activity",
      entityId: created.id,
      payload: { type: input.type, subject: input.subject, opportunityId: input.opportunityId ?? null, customerId },
    }, tx);
    return created;
  });
}

export async function updateActivity(actor: CrmActor, id: string, input: Partial<ActivityInput>) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(crmActivity).where(and(eq(crmActivity.id, id), eq(crmActivity.companyId, actor.companyId))).limit(1);
    if (!current) throw new HttpError(404, "Actividad no encontrada.");
    if (input.assignedUserId && input.assignedUserId !== current.assignedUserId) await assertMember(tx, actor.tenantId, input.assignedUserId);
    await tx
      .update(crmActivity)
      .set({
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
        ...(input.notes !== undefined ? { notes: clean(input.notes) } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        ...(input.completed !== undefined ? { completedAt: input.completed ? current.completedAt ?? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(crmActivity.id, id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: input.completed === true ? "crm_activity.complete" : "crm_activity.update",
      entityName: "crm_activity",
      entityId: id,
      payload: { ...input, dueAt: input.dueAt?.toISOString() ?? input.dueAt },
    }, tx);
    return { id };
  });
}

export async function deleteActivity(actor: CrmActor, id: string) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: crmActivity.id, subject: crmActivity.subject }).from(crmActivity).where(and(eq(crmActivity.id, id), eq(crmActivity.companyId, actor.companyId))).limit(1);
    if (!current) throw new HttpError(404, "Actividad no encontrada.");
    await tx.delete(crmActivity).where(eq(crmActivity.id, id));
    await recordAudit({
      tenantId: actor.tenantId,
      companyId: actor.companyId,
      actorUserId: actor.actorUserId,
      action: "crm_activity.delete",
      entityName: "crm_activity",
      entityId: id,
      payload: { subject: current.subject },
    }, tx);
  });
}

/** Tareas vencidas sin hacer (panel de inicio). */
export async function countOverdueActivities(companyId: string, assignedUserId?: string) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmActivity)
    .where(and(
      eq(crmActivity.companyId, companyId),
      isNull(crmActivity.completedAt),
      lt(crmActivity.dueAt, startOfToday),
      ...(assignedUserId ? [eq(crmActivity.assignedUserId, assignedUserId)] : []),
    ));
  return row?.count ?? 0;
}

/** Ficha del cliente: oportunidades abiertas y actividades pendientes. */
export async function getCustomerCrm(companyId: string, customerId: string) {
  const [opportunities, activities] = await Promise.all([
    listOpportunities(companyId, { customerId, limit: 20 }),
    listActivities(companyId, { customerId, limit: 10 }),
  ]);
  return { opportunities, activities };
}

export async function listTeamOptions(tenantId: string) {
  return db
    .select({ id: user.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.tenantId, tenantId))
    .orderBy(asc(user.name));
}

export async function listCustomerOptions(companyId: string) {
  return db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, companyId), eq(customer.status, "ACTIVE")))
    .orderBy(asc(customer.name))
    .limit(2000);
}
