import { createHmac } from "node:crypto";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  item,
  itemCategory,
  membership,
  posArea,
  posCategoryStation,
  posKitchenBatch,
  posOrder,
  posOrderLine,
  posRegister,
  posStaffPin,
  posTable,
  posTicket,
  tax,
  user,
} from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { autoLayout, clampToPlan, overlaps, type TableShape } from "@/modules/hospitality/floor-plan";
import { applyModifiers, fireThreshold, firesNow, nextHeldCourse, resolveModifiers, resolveSetMenu } from "@/modules/hospitality/ordering";
import { billPartLines, orderAmounts, type BillPart, type EqualSplit, type LineStatus, type OrderLine, type OrderStatus, type Station } from "@/modules/hospitality/model";
import { recordAudit } from "@/server/audit";
import { isModuleEnabled } from "@/server/modules/service";
import { getOrderingOptions } from "@/server/pos/ordering";
import { createSale, getOpenSession, moveStock, type PosActor, type SaleResult } from "@/server/pos/service";

const num = (value: string | number | null | undefined) => Number(value ?? 0);
const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const qty = (value: number) => (Math.round(value * 1000) / 1000).toFixed(3);
const OPEN_STATUSES = ["OPEN", "BILL_REQUESTED"] as const;

async function audit(actor: PosActor, action: string, entityName: string, entityId: string, payload: Record<string, unknown>, client: DbClient = db) {
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action, entityName, entityId, payload }, client);
}

// ---------------------------------------------------------------------------------------------
// Salas, mesas, estaciones y camareros (configuración)
// ---------------------------------------------------------------------------------------------

export async function listAreasWithTables(companyId: string) {
  const [areas, tables] = await Promise.all([
    db.select().from(posArea).where(eq(posArea.companyId, companyId)).orderBy(asc(posArea.position), asc(posArea.name)),
    db.select().from(posTable).where(eq(posTable.companyId, companyId)).orderBy(asc(posTable.position), asc(posTable.name)),
  ]);
  return areas.map((area) => ({ ...area, tables: tables.filter((entry) => entry.areaId === area.id) }));
}

export async function createArea(actor: PosActor, name: string) {
  const [{ max }] = await db.select({ max: sql<number | null>`max(${posArea.position})` }).from(posArea).where(eq(posArea.companyId, actor.companyId));
  const [created] = await db.insert(posArea).values({ companyId: actor.companyId, name: name.trim(), position: (max ?? -1) + 1 }).onConflictDoNothing().returning({ id: posArea.id });
  if (!created) throw new HttpError(409, `Ya hay una sala llamada «${name.trim()}».`);
  await audit(actor, "pos_area.create", "pos_area", created.id, { name });
  return created;
}

export async function updateArea(actor: PosActor, areaId: string, input: { name?: string; position?: number; bookable?: boolean }) {
  const [updated] = await db
    .update(posArea)
    .set({ ...(input.name ? { name: input.name.trim() } : {}), ...(input.position !== undefined ? { position: input.position } : {}), ...(input.bookable !== undefined ? { bookable: input.bookable } : {}) })
    .where(and(eq(posArea.id, areaId), eq(posArea.companyId, actor.companyId)))
    .returning({ id: posArea.id });
  if (!updated) throw new HttpError(404, "Sala no encontrada.");
  await audit(actor, "pos_area.update", "pos_area", areaId, input);
  return updated;
}

async function assertNoOpenOrders(client: DbClient, companyId: string, tableIds: string[]) {
  if (tableIds.length === 0) return;
  const [open] = await client
    .select({ id: posOrder.id })
    .from(posOrder)
    .where(and(eq(posOrder.companyId, companyId), inArray(posOrder.tableId, tableIds), inArray(posOrder.status, [...OPEN_STATUSES])))
    .limit(1);
  if (open) throw new HttpError(409, "Hay mesas con la cuenta abierta: cóbralas o muévelas antes.");
}

export async function deleteArea(actor: PosActor, areaId: string) {
  await db.transaction(async (tx) => {
    const tables = await tx.select({ id: posTable.id }).from(posTable).where(and(eq(posTable.areaId, areaId), eq(posTable.companyId, actor.companyId)));
    await assertNoOpenOrders(tx, actor.companyId, tables.map((entry) => entry.id));
    const [deleted] = await tx.delete(posArea).where(and(eq(posArea.id, areaId), eq(posArea.companyId, actor.companyId))).returning({ id: posArea.id });
    if (!deleted) throw new HttpError(404, "Sala no encontrada.");
    await audit(actor, "pos_area.delete", "pos_area", areaId, {}, tx);
  });
}

/** Alta rápida de mesas numeradas: «Mesa 1» … «Mesa 12» (o con el prefijo que se quiera). */
export async function createTables(actor: PosActor, input: { areaId: string; prefix: string; from: number; to: number; seats: number }) {
  if (input.to < input.from || input.to - input.from > 99) throw new HttpError(400, "Indica un rango de hasta 100 mesas.");
  return db.transaction(async (tx) => {
    const [area] = await tx.select({ id: posArea.id }).from(posArea).where(and(eq(posArea.id, input.areaId), eq(posArea.companyId, actor.companyId))).limit(1);
    if (!area) throw new HttpError(404, "Sala no encontrada.");
    const [{ max }] = await tx.select({ max: sql<number | null>`max(${posTable.position})` }).from(posTable).where(eq(posTable.areaId, input.areaId));
    const values = Array.from({ length: input.to - input.from + 1 }, (_, index) => ({
      companyId: actor.companyId,
      areaId: input.areaId,
      name: `${input.prefix.trim()} ${input.from + index}`.trim(),
      seats: input.seats,
      position: (max ?? -1) + 1 + index,
    }));
    const created = await tx.insert(posTable).values(values).onConflictDoNothing().returning({ id: posTable.id });
    await audit(actor, "pos_table.create", "pos_area", input.areaId, { count: created.length, prefix: input.prefix, from: input.from, to: input.to }, tx);
    return { created: created.length };
  });
}

export async function updateTable(actor: PosActor, tableId: string, input: { name?: string; seats?: number; isActive?: boolean; areaId?: string; shape?: TableShape; bookable?: boolean }) {
  if (input.areaId) {
    const [area] = await db.select({ id: posArea.id }).from(posArea).where(and(eq(posArea.id, input.areaId), eq(posArea.companyId, actor.companyId))).limit(1);
    if (!area) throw new HttpError(404, "Sala no encontrada.");
  }
  const [updated] = await db
    .update(posTable)
    .set({
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.seats ? { seats: input.seats } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.areaId ? { areaId: input.areaId, posX: null, posY: null } : {}),
      ...(input.shape ? { shape: input.shape } : {}),
      ...(input.bookable !== undefined ? { bookable: input.bookable } : {}),
    })
    .where(and(eq(posTable.id, tableId), eq(posTable.companyId, actor.companyId)))
    .returning({ id: posTable.id });
  if (!updated) throw new HttpError(404, "Mesa no encontrada.");
  await audit(actor, "pos_table.update", "pos_table", tableId, input);
  return updated;
}

/** Guarda el plano de una sala: posición, tamaño y forma de cada mesa (dentro de la cuadrícula, sin solaparse). */
export async function saveAreaLayout(actor: PosActor, areaId: string, tables: Array<{ id: string; posX: number; posY: number; width: number; height: number; shape: TableShape }>) {
  const placed = tables.map((table) => ({ ...table, ...clampToPlan(table) }));
  for (const [index, table] of placed.entries()) {
    const clash = placed.slice(index + 1).find((other) => overlaps(table, other));
    if (clash) throw new HttpError(400, "Hay dos mesas encima una de otra: sepáralas antes de guardar.");
  }
  await db.transaction(async (tx) => {
    const owned = await tx.select({ id: posTable.id }).from(posTable).where(and(eq(posTable.areaId, areaId), eq(posTable.companyId, actor.companyId)));
    const ids = new Set(owned.map((row) => row.id));
    if (placed.some((table) => !ids.has(table.id))) throw new HttpError(404, "Alguna mesa no es de esta sala.");
    for (const table of placed) {
      await tx.update(posTable).set({ posX: table.posX, posY: table.posY, width: table.width, height: table.height, shape: table.shape }).where(eq(posTable.id, table.id));
    }
    await audit(actor, "pos_area.layout", "pos_area", areaId, { tables: placed.length }, tx);
  });
  return { saved: placed.length };
}

export async function deleteTable(actor: PosActor, tableId: string) {
  await db.transaction(async (tx) => {
    await assertNoOpenOrders(tx, actor.companyId, [tableId]);
    const [deleted] = await tx.delete(posTable).where(and(eq(posTable.id, tableId), eq(posTable.companyId, actor.companyId))).returning({ id: posTable.id });
    if (!deleted) throw new HttpError(404, "Mesa no encontrada.");
    await audit(actor, "pos_table.delete", "pos_table", tableId, {}, tx);
  });
}

export async function listCategoryStations(companyId: string) {
  const rows = await db
    .select({ id: itemCategory.id, name: itemCategory.name, station: posCategoryStation.station })
    .from(itemCategory)
    .leftJoin(posCategoryStation, and(eq(posCategoryStation.categoryId, itemCategory.id), eq(posCategoryStation.companyId, companyId)))
    .where(eq(itemCategory.companyId, companyId))
    .orderBy(asc(itemCategory.name));
  return rows.map((row) => ({ categoryId: row.id, name: row.name, station: (row.station ?? "NONE") as Station }));
}

/** A qué estación (cocina, barra o ninguna) van los productos de cada categoría. */
export async function saveCategoryStations(actor: PosActor, entries: Array<{ categoryId: string; station: Station }>) {
  await db.transaction(async (tx) => {
    const owned = entries.length > 0
      ? await tx.select({ id: itemCategory.id }).from(itemCategory).where(and(eq(itemCategory.companyId, actor.companyId), inArray(itemCategory.id, entries.map((entry) => entry.categoryId))))
      : [];
    if (owned.length !== new Set(entries.map((entry) => entry.categoryId)).size) throw new HttpError(404, "Alguna categoría no existe.");
    for (const entry of entries) {
      await tx
        .insert(posCategoryStation)
        .values({ companyId: actor.companyId, categoryId: entry.categoryId, station: entry.station })
        .onConflictDoUpdate({ target: [posCategoryStation.companyId, posCategoryStation.categoryId], set: { station: entry.station } });
    }
    await audit(actor, "pos_station.update", "pos_category_station", actor.companyId, { entries }, tx);
  });
}

function pinHash(companyId: string, pin: string) {
  return createHmac("sha256", process.env.JWT_SECRET || "erp-pos-pin").update(`${companyId}:${pin}`).digest("hex");
}

export async function listStaff(companyId: string, tenantId: string) {
  const [members, pins] = await Promise.all([
    db.select({ userId: user.id, name: user.name }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(eq(membership.tenantId, tenantId)).orderBy(asc(user.name)),
    db.select({ userId: posStaffPin.userId }).from(posStaffPin).where(eq(posStaffPin.companyId, companyId)),
  ]);
  const withPin = new Set(pins.map((pin) => pin.userId));
  return members.map((member) => ({ ...member, hasPin: withPin.has(member.userId) }));
}

/** PIN de 4 a 6 cifras para identificarse rápido en una tablet compartida. Vacío = quitarlo. */
export async function setStaffPin(actor: PosActor, userId: string, pin: string | null) {
  const [member] = await db.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, actor.tenantId), eq(membership.userId, userId))).limit(1);
  if (!member) throw new HttpError(404, "Ese usuario no es del equipo.");
  if (!pin) {
    await db.delete(posStaffPin).where(and(eq(posStaffPin.companyId, actor.companyId), eq(posStaffPin.userId, userId)));
  } else {
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, "El PIN tiene de 4 a 6 cifras.");
    const hash = pinHash(actor.companyId, pin);
    const [taken] = await db.select({ userId: posStaffPin.userId }).from(posStaffPin).where(and(eq(posStaffPin.companyId, actor.companyId), eq(posStaffPin.pinHash, hash), ne(posStaffPin.userId, userId))).limit(1);
    if (taken) throw new HttpError(409, "Ese PIN ya lo usa otra persona: elige otro.");
    await db
      .insert(posStaffPin)
      .values({ companyId: actor.companyId, userId, pinHash: hash })
      .onConflictDoUpdate({ target: [posStaffPin.companyId, posStaffPin.userId], set: { pinHash: hash, updatedAt: new Date() } });
  }
  await audit(actor, pin ? "pos_staff_pin.set" : "pos_staff_pin.remove", "pos_staff_pin", userId, {});
}

/** Camarero que corresponde a un PIN (null si no coincide). */
export async function verifyStaffPin(companyId: string, pin: string) {
  if (!/^\d{4,6}$/.test(pin)) return null;
  const [row] = await db
    .select({ userId: user.id, name: user.name })
    .from(posStaffPin)
    .innerJoin(user, eq(user.id, posStaffPin.userId))
    .where(and(eq(posStaffPin.companyId, companyId), eq(posStaffPin.pinHash, pinHash(companyId, pin))))
    .limit(1);
  return row ?? null;
}

async function assertWaiter(client: DbClient, tenantId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const [row] = await client.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, tenantId), eq(membership.userId, userId))).limit(1);
  if (!row) throw new HttpError(404, "Camarero no encontrado.");
  return userId;
}

// ---------------------------------------------------------------------------------------------
// Plano de mesas
// ---------------------------------------------------------------------------------------------

type LoadedLine = OrderLine & { orderId: string; sentAt: Date | null; createdAt: Date; addedByName: string | null; course: number; firedAt: Date | null; parentLineId: string | null; modifiers: Array<{ group: string; name: string; price: number }> };

async function loadLines(client: DbClient, orderIds: string[]): Promise<LoadedLine[]> {
  if (orderIds.length === 0) return [];
  const rows = await client
    .select({
      id: posOrderLine.id,
      orderId: posOrderLine.orderId,
      itemId: posOrderLine.itemId,
      description: posOrderLine.description,
      quantity: posOrderLine.quantity,
      unitPrice: posOrderLine.unitPrice,
      taxRate: posOrderLine.taxRate,
      taxId: posOrderLine.taxId,
      note: posOrderLine.note,
      station: posOrderLine.station,
      status: posOrderLine.status,
      paidQuantity: posOrderLine.paidQuantity,
      sentAt: posOrderLine.sentAt,
      createdAt: posOrderLine.createdAt,
      course: posOrderLine.course,
      firedAt: posOrderLine.firedAt,
      parentLineId: posOrderLine.parentLineId,
      modifiers: posOrderLine.modifiers,
      addedByName: user.name,
    })
    .from(posOrderLine)
    .leftJoin(user, eq(user.id, posOrderLine.addedByUserId))
    .where(inArray(posOrderLine.orderId, orderIds))
    .orderBy(asc(posOrderLine.createdAt));
  return rows.map((row) => ({
    ...row,
    quantity: num(row.quantity),
    unitPrice: num(row.unitPrice),
    taxRate: num(row.taxRate),
    paidQuantity: num(row.paidQuantity),
    station: row.station as Station,
    status: row.status as LineStatus,
  }));
}

/** Salas con sus mesas y la cuenta abierta de cada una (importe, comensales, tiempo, cocina). */
export async function getFloor(companyId: string, registerId: string) {
  const [areas, orders] = await Promise.all([
    listAreasWithTables(companyId),
    db
      .select({
        id: posOrder.id,
        tableId: posOrder.tableId,
        label: posOrder.label,
        status: posOrder.status,
        guests: posOrder.guests,
        openedAt: posOrder.openedAt,
        equalSplit: posOrder.equalSplit,
        waiterName: user.name,
      })
      .from(posOrder)
      .leftJoin(user, eq(user.id, posOrder.waiterUserId))
      .where(and(eq(posOrder.companyId, companyId), eq(posOrder.registerId, registerId), inArray(posOrder.status, [...OPEN_STATUSES])))
      .orderBy(asc(posOrder.openedAt)),
  ]);
  // Import diferido: el módulo de reservas usa openOrder de este archivo.
  const { countPendingBookings, upcomingBookingsByTable } = await import("@/server/pos/bookings");
  const [lines, upcoming, pendingBookings] = await Promise.all([loadLines(db, orders.map((order) => order.id)), upcomingBookingsByTable(companyId), countPendingBookings(companyId)]);
  const summaries = orders.map((order) => {
    const own = lines.filter((line) => line.orderId === order.id);
    const amounts = orderAmounts(own, order.equalSplit as EqualSplit | null);
    return {
      id: order.id,
      tableId: order.tableId,
      label: order.label,
      status: order.status as OrderStatus,
      guests: order.guests,
      openedAt: order.openedAt,
      waiterName: order.waiterName,
      total: amounts.total,
      pending: amounts.pending,
      unsent: own.filter((line) => line.status === "PENDING").length,
      ready: own.filter((line) => line.status === "READY").length,
    };
  });
  return {
    areas: areas.map((area) => ({
      id: area.id,
      name: area.name,
      planned: area.tables.some((entry) => entry.isActive && entry.posX !== null),
      tables: autoLayout(area.tables.filter((entry) => entry.isActive)).map((entry) => ({
        id: entry.id,
        name: entry.name,
        seats: entry.seats,
        shape: entry.shape as TableShape,
        posX: entry.posX,
        posY: entry.posY,
        width: entry.width,
        height: entry.height,
        order: summaries.find((order) => order.tableId === entry.id) ?? null,
        booking: upcoming.get(entry.id) ?? null,
      })),
    })),
    pendingBookings,
    // Cuentas sin mesa (barra, para llevar).
    loose: summaries.filter((order) => !order.tableId),
  };
}

// ---------------------------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------------------------

async function loadOrder(client: DbClient, companyId: string, orderId: string, lock = false) {
  const query = client.select().from(posOrder).where(and(eq(posOrder.id, orderId), eq(posOrder.companyId, companyId)));
  const [row] = await (lock ? query.for("update").limit(1) : query.limit(1));
  if (!row) throw new HttpError(404, "Cuenta no encontrada.");
  return row;
}

async function loadOpenOrder(client: DbClient, companyId: string, orderId: string) {
  const row = await loadOrder(client, companyId, orderId, true);
  if (!OPEN_STATUSES.includes(row.status as (typeof OPEN_STATUSES)[number])) throw new HttpError(409, row.status === "PAID" ? "Esta cuenta ya está cobrada." : "Esta cuenta está cerrada.");
  return row;
}

async function assertTable(client: DbClient, companyId: string, tableId: string) {
  const [row] = await client.select({ id: posTable.id, name: posTable.name, isActive: posTable.isActive }).from(posTable).where(and(eq(posTable.id, tableId), eq(posTable.companyId, companyId))).limit(1);
  if (!row || !row.isActive) throw new HttpError(404, "Mesa no encontrada.");
  return row;
}

async function tableOpenOrder(client: DbClient, companyId: string, tableId: string) {
  const [row] = await client.select({ id: posOrder.id }).from(posOrder).where(and(eq(posOrder.companyId, companyId), eq(posOrder.tableId, tableId), inArray(posOrder.status, [...OPEN_STATUSES]))).limit(1);
  return row ?? null;
}

/** Abre la cuenta de una mesa (si ya está abierta, devuelve esa) o una cuenta sin mesa (barra). */
export async function openOrder(actor: PosActor, input: { registerId: string; tableId?: string | null; label?: string | null; guests?: number; waiterUserId?: string | null }) {
  return db.transaction(async (tx) => {
    const [register] = await tx.select({ id: posRegister.id }).from(posRegister).where(and(eq(posRegister.id, input.registerId), eq(posRegister.companyId, actor.companyId))).limit(1);
    if (!register) throw new HttpError(404, "Caja no encontrada.");
    if (input.tableId) {
      await assertTable(tx, actor.companyId, input.tableId);
      const existing = await tableOpenOrder(tx, actor.companyId, input.tableId);
      if (existing) return { id: existing.id, created: false };
    } else if (!input.label?.trim()) {
      throw new HttpError(400, "Pon un nombre a la cuenta (p. ej. «Barra · Juan»).");
    }
    const waiterUserId = await assertWaiter(tx, actor.tenantId, input.waiterUserId);
    const [created] = await tx
      .insert(posOrder)
      .values({
        companyId: actor.companyId,
        registerId: input.registerId,
        tableId: input.tableId || null,
        label: input.label?.trim() || null,
        guests: Math.max(1, Math.min(200, input.guests ?? 1)),
        waiterUserId: waiterUserId ?? actor.actorUserId,
        openedByUserId: actor.actorUserId,
      })
      .onConflictDoNothing()
      .returning({ id: posOrder.id });
    if (!created && input.tableId) {
      // Otro camarero la abrió a la vez: se usa la suya.
      const existing = await tableOpenOrder(tx, actor.companyId, input.tableId);
      if (existing) return { id: existing.id, created: false };
    }
    if (!created) throw new HttpError(409, "No se pudo abrir la cuenta.");
    await audit(actor, "pos_order.open", "pos_order", created.id, { tableId: input.tableId ?? null, label: input.label ?? null, guests: input.guests ?? 1 }, tx);
    return { id: created.id, created: true };
  });
}

export type OrderView = Awaited<ReturnType<typeof getOrder>>;

export async function getOrder(companyId: string, orderId: string) {
  const [row] = await db
    .select({
      id: posOrder.id,
      registerId: posOrder.registerId,
      tableId: posOrder.tableId,
      tableName: posTable.name,
      areaName: posArea.name,
      label: posOrder.label,
      status: posOrder.status,
      guests: posOrder.guests,
      equalSplit: posOrder.equalSplit,
      firedCourse: posOrder.firedCourse,
      waiterUserId: posOrder.waiterUserId,
      waiterName: user.name,
      openedAt: posOrder.openedAt,
      closedAt: posOrder.closedAt,
      updatedAt: posOrder.updatedAt,
    })
    .from(posOrder)
    .leftJoin(posTable, eq(posTable.id, posOrder.tableId))
    .leftJoin(posArea, eq(posArea.id, posTable.areaId))
    .leftJoin(user, eq(user.id, posOrder.waiterUserId))
    .where(and(eq(posOrder.id, orderId), eq(posOrder.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const [lines, tickets] = await Promise.all([
    loadLines(db, [orderId]),
    db.select({ id: posTicket.id, invoiceId: posTicket.invoiceId, totalAmount: posTicket.totalAmount, tipAmount: posTicket.tipAmount, createdAt: posTicket.createdAt }).from(posTicket).where(and(eq(posTicket.companyId, companyId), eq(posTicket.orderId, orderId), eq(posTicket.kind, "SALE"))).orderBy(asc(posTicket.createdAt)),
  ]);
  const equalSplit = row.equalSplit as EqualSplit | null;
  return {
    ...row,
    status: row.status as OrderStatus,
    equalSplit,
    name: row.tableName ?? row.label ?? "Cuenta",
    lines,
    amounts: orderAmounts(lines, equalSplit),
    tickets: tickets.map((ticket) => ({ ...ticket, totalAmount: num(ticket.totalAmount), tipAmount: num(ticket.tipAmount) })),
  };
}

export async function updateOrder(actor: PosActor, orderId: string, input: { guests?: number; waiterUserId?: string | null; label?: string | null }) {
  return db.transaction(async (tx) => {
    await loadOpenOrder(tx, actor.companyId, orderId);
    const waiterUserId = input.waiterUserId !== undefined ? await assertWaiter(tx, actor.tenantId, input.waiterUserId) : undefined;
    await tx
      .update(posOrder)
      .set({
        ...(input.guests ? { guests: Math.max(1, Math.min(200, input.guests)) } : {}),
        ...(waiterUserId !== undefined ? { waiterUserId } : {}),
        ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.update", "pos_order", orderId, input, tx);
    return { id: orderId };
  });
}

/** Estación de cada producto según su categoría. */
async function stationsForItems(client: DbClient, companyId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, Station>();
  const rows = await client
    .select({ itemId: item.id, station: posCategoryStation.station })
    .from(item)
    .leftJoin(posCategoryStation, and(eq(posCategoryStation.categoryId, item.categoryId), eq(posCategoryStation.companyId, companyId)))
    .where(and(eq(item.companyId, companyId), inArray(item.id, itemIds)));
  return new Map(rows.map((row) => [row.itemId, (row.station ?? "NONE") as Station]));
}

export type OrderLineInput = {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxId?: string | null;
  note?: string | null;
  /** Tiempo pedido (1–4) para platos de cocina; lo demás va «sin tiempo». */
  course?: number | null;
  /** Opciones elegidas de los modificadores del producto. */
  modifierOptionIds?: string[];
  /** Menú de precio cerrado: un plato por tiempo. */
  setMenuPicks?: Array<{ courseId: string; itemId: string }>;
};

/**
 * Añade productos a la cuenta (una ronda). Lo que aún no se ha enviado a cocina se agrupa: tocar dos
 * veces la caña suma 2 en la misma línea (si no lleva nota, modificadores ni tiempo distinto). Los
 * modificadores y menús se validan y se ponen precio aquí, no en el dispositivo. Pedir la cuenta y
 * volver a pedir reabre la mesa.
 */
export async function addOrderLines(actor: PosActor, orderId: string, lines: OrderLineInput[], waiterUserId?: string | null) {
  if (lines.length === 0) throw new HttpError(400, "No hay nada que añadir.");
  if (lines.some((line) => !(line.quantity > 0) || line.unitPrice < 0 || !line.description.trim())) throw new HttpError(400, "Revisa los productos: cantidades positivas y precios no negativos.");
  return db.transaction(async (tx) => {
    const order = await loadOpenOrder(tx, actor.companyId, orderId);
    if (order.equalSplit) throw new HttpError(409, "La cuenta se está pagando a partes iguales: termina de cobrarla antes de añadir más.");
    const menuItemIds = lines.flatMap((line) => line.setMenuPicks ?? []).map((pick) => pick.itemId);
    const itemIds = [...new Set([...lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)), ...menuItemIds])];
    if (itemIds.length > 0) {
      const owned = await tx.select({ id: item.id }).from(item).where(and(eq(item.companyId, actor.companyId), inArray(item.id, itemIds)));
      if (owned.length !== itemIds.length) throw new HttpError(404, "Algún producto no existe.");
    }
    const taxIds = [...new Set(lines.map((line) => line.taxId).filter((id): id is string => Boolean(id)))];
    const rates = taxIds.length > 0
      ? new Map((await tx.select({ id: tax.id, rate: tax.rate }).from(tax).where(and(eq(tax.companyId, actor.companyId), inArray(tax.id, taxIds)))).map((row) => [row.id, num(row.rate)]))
      : new Map<string, number>();
    const stations = await stationsForItems(tx, actor.companyId, itemIds);
    const options = await getOrderingOptions(actor.companyId, tx, lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)));
    const pending = await tx.select().from(posOrderLine).where(and(eq(posOrderLine.orderId, orderId), eq(posOrderLine.status, "PENDING")));
    const addedBy = (await assertWaiter(tx, actor.tenantId, waiterUserId)) ?? actor.actorUserId;
    const courseFor = (station: Station, requested: number | null | undefined) => (station === "KITCHEN" ? Math.max(1, Math.min(4, requested || 1)) : 0);

    for (const line of lines) {
      const taxRate = line.taxId ? rates.get(line.taxId) ?? line.taxRate : line.taxRate;
      const note = line.note?.trim() || null;
      const station = line.itemId ? stations.get(line.itemId) ?? "NONE" : "NONE";
      const groups = line.itemId ? options.modifiers[line.itemId] ?? [] : [];
      const menu = line.itemId ? options.setMenus[line.itemId] : undefined;

      if (menu) {
        // Menú: la línea del menú lleva el precio (con suplementos) y cada plato va a su estación a 0 €.
        const resolved = resolveSetMenu(menu, line.setMenuPicks ?? []);
        if ("error" in resolved) throw new HttpError(400, resolved.error);
        const priced = applyModifiers({ description: line.description.trim(), unitPrice: Math.round(line.unitPrice * 100) / 100, taxRate }, resolved.dishes.filter((dish) => dish.supplement > 0).map((dish) => ({ group: "Suplemento", name: `${dish.name} +`, price: dish.supplement })));
        const [parent] = await tx
          .insert(posOrderLine)
          .values({ orderId, itemId: line.itemId, description: line.description.trim(), quantity: qty(line.quantity), unitPrice: money(priced.unitPrice), taxRate: String(taxRate), taxId: line.taxId || null, note, station: "NONE", course: 0, addedByUserId: addedBy, modifiers: resolved.dishes.map((dish) => ({ group: menu.find((course) => course.id === dish.courseId)?.name ?? "", name: dish.name, price: dish.supplement })) })
          .returning({ id: posOrderLine.id });
        for (const dish of resolved.dishes) {
          const dishStation = stations.get(dish.itemId) ?? "NONE";
          await tx.insert(posOrderLine).values({ orderId, itemId: dish.itemId, description: dish.name, quantity: qty(line.quantity), unitPrice: money(0), taxRate: String(taxRate), taxId: line.taxId || null, note: null, station: dishStation, course: dishStation === "KITCHEN" ? Math.max(1, dish.course || 1) : 0, parentLineId: parent.id, addedByUserId: addedBy });
        }
        continue;
      }

      let modifiers: Array<{ group: string; name: string; price: number }> = [];
      let description = line.description.trim();
      let unitPrice = Math.round(line.unitPrice * 100) / 100;
      if (groups.length > 0 || (line.modifierOptionIds ?? []).length > 0) {
        const resolved = resolveModifiers(groups, line.modifierOptionIds ?? []);
        if ("error" in resolved) throw new HttpError(400, resolved.error);
        modifiers = resolved.modifiers;
        ({ description, unitPrice } = applyModifiers({ description, unitPrice, taxRate }, modifiers));
      }
      const course = courseFor(station, line.course);
      const same = pending.find((candidate) => !candidate.parentLineId && candidate.itemId === (line.itemId || null) && num(candidate.unitPrice) === unitPrice && (candidate.note ?? null) === note && candidate.description === description && candidate.course === course && (candidate.modifiers ?? []).length === modifiers.length);
      if (same && !options.setMenus[same.itemId ?? ""]) {
        const quantity = num(same.quantity) + line.quantity;
        same.quantity = qty(quantity);
        await tx.update(posOrderLine).set({ quantity: qty(quantity), updatedAt: new Date() }).where(eq(posOrderLine.id, same.id));
      } else {
        const [created] = await tx
          .insert(posOrderLine)
          .values({ orderId, itemId: line.itemId || null, description, quantity: qty(line.quantity), unitPrice: money(unitPrice), taxRate: String(taxRate), taxId: line.taxId || null, note, station, course, modifiers, addedByUserId: addedBy })
          .returning();
        pending.push(created);
      }
    }
    await tx.update(posOrder).set({ status: "OPEN", updatedAt: new Date() }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.add", "pos_order", orderId, { lines: lines.map((line) => ({ description: line.description, quantity: line.quantity, modifiers: line.modifierOptionIds?.length ?? 0, menu: Boolean(line.setMenuPicks?.length) })), status: order.status }, tx);
    return { id: orderId };
  });
}

/**
 * Cambia unidades o nota de una línea. Sin enviar a cocina se edita libremente; ya enviada, solo se
 * puede anular (queda registrado con el motivo) o reducir unidades anulando la diferencia.
 */
export async function updateOrderLine(actor: PosActor, lineId: string, input: { quantity?: number; note?: string | null; cancelReason?: string | null; course?: number }) {
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(posOrderLine).where(eq(posOrderLine.id, lineId)).for("update").limit(1);
    if (!line) throw new HttpError(404, "Línea no encontrada.");
    const order = await loadOpenOrder(tx, actor.companyId, line.orderId);
    if (order.equalSplit) throw new HttpError(409, "La cuenta se está pagando a partes iguales: no se puede cambiar.");
    const paid = num(line.paidQuantity);
    const current = num(line.quantity);
    const nextQuantity = input.quantity ?? current;
    if (nextQuantity < paid - 0.0005) throw new HttpError(409, "No se puede bajar de las unidades ya cobradas.");
    if (line.status === "CANCELLED") throw new HttpError(409, "La línea está anulada.");
    const children = await tx.select().from(posOrderLine).where(eq(posOrderLine.parentLineId, lineId));
    // Platos de un menú: no se cambian las unidades (se cambia el menú entero).
    if (line.parentLineId && input.quantity !== undefined && input.quantity !== current) throw new HttpError(409, "Es un plato de un menú: cambia o quita el menú entero.");
    if (children.length > 0 && input.quantity !== undefined && input.quantity > current) throw new HttpError(409, "Para otro menú, añádelo de nuevo eligiendo sus platos.");
    if (input.course !== undefined && line.station === "KITCHEN") {
      if (line.status !== "PENDING" && !(line.status === "SENT" && !line.firedAt)) throw new HttpError(409, "Ya está marchado: no se puede cambiar de tiempo.");
      await tx.update(posOrderLine).set({ course: Math.max(1, Math.min(4, input.course)), updatedAt: new Date() }).where(eq(posOrderLine.id, lineId));
    }
    if (line.status === "PENDING") {
      if (nextQuantity <= 0) await tx.delete(posOrderLine).where(eq(posOrderLine.id, lineId));
      else {
        await tx.update(posOrderLine).set({ quantity: qty(nextQuantity), ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}), updatedAt: new Date() }).where(eq(posOrderLine.id, lineId));
        if (children.length > 0 && nextQuantity !== current) await tx.update(posOrderLine).set({ quantity: qty(nextQuantity), updatedAt: new Date() }).where(eq(posOrderLine.parentLineId, lineId));
      }
    } else {
      if (nextQuantity > current) throw new HttpError(409, "Ya está en cocina: añade las unidades como un pedido nuevo.");
      if (nextQuantity < current) {
        const reason = input.cancelReason?.trim();
        if (!reason) throw new HttpError(400, "Indica el motivo para anular algo que ya está en cocina.");
        const cancelled = Math.round((current - nextQuantity) * 1000) / 1000;
        if (nextQuantity <= 0) {
          // Toda la línea anulada (queda a la vista en la cuenta y en cocina, tachada, con su motivo).
          await tx.update(posOrderLine).set({ status: "CANCELLED", cancelReason: reason, updatedAt: new Date() }).where(eq(posOrderLine.id, lineId));
          // Anular un menú anula también sus platos (cocina los ve tachados).
          if (children.length > 0) await tx.update(posOrderLine).set({ status: "CANCELLED", cancelReason: reason, updatedAt: new Date() }).where(and(eq(posOrderLine.parentLineId, lineId), ne(posOrderLine.status, "CANCELLED")));
        } else {
          if (children.length > 0) throw new HttpError(409, "Anula el menú entero (todas sus unidades) o pásalo a otra mesa.");
          await tx.update(posOrderLine).set({ quantity: qty(nextQuantity), updatedAt: new Date() }).where(eq(posOrderLine.id, lineId));
          const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, paidQuantity: _paid, ...copy } = line;
          await tx.insert(posOrderLine).values({ ...copy, quantity: qty(cancelled), paidQuantity: "0", status: "CANCELLED", cancelReason: reason, addedByUserId: actor.actorUserId });
        }
      }
      if (input.note !== undefined) await tx.update(posOrderLine).set({ note: input.note?.trim() || null }).where(eq(posOrderLine.id, lineId));
    }
    await tx.update(posOrder).set({ updatedAt: new Date() }).where(eq(posOrder.id, line.orderId));
    await audit(actor, line.status === "PENDING" ? "pos_order.line_update" : "pos_order.line_cancel", "pos_order", line.orderId, { lineId, description: line.description, from: current, to: nextQuantity, reason: input.cancelReason ?? null }, tx);
    return { id: line.orderId };
  });
}

/**
 * Envía a cocina y barra lo pendiente de la cuenta: una comanda por estación (para su pantalla o para
 * imprimirla). Lo que no lleva estación (bebida embotellada, pan…) queda servido.
 */
export async function sendOrderToKitchen(actor: PosActor, orderId: string) {
  return db.transaction(async (tx) => {
    const order = await loadOpenOrder(tx, actor.companyId, orderId);
    const all = await tx.select().from(posOrderLine).where(eq(posOrderLine.orderId, orderId));
    const pending = all.filter((line) => line.status === "PENDING");
    if (pending.length === 0) return { batches: [] as Array<{ id: string; station: Station }>, held: 0 };
    const now = new Date();
    // Tiempos: sale el tiempo en curso (y la barra); los siguientes quedan en espera hasta «Marchar».
    const threshold = fireThreshold(order.firedCourse, all);
    if (threshold !== order.firedCourse) await tx.update(posOrder).set({ firedCourse: threshold }).where(eq(posOrder.id, orderId));
    let held = 0;
    const batches: Array<{ id: string; station: Station }> = [];
    for (const station of ["KITCHEN", "BAR"] as const) {
      const lines = pending.filter((line) => line.station === station);
      if (lines.length === 0) continue;
      const [batch] = await tx.insert(posKitchenBatch).values({ companyId: actor.companyId, orderId, station, sentByUserId: actor.actorUserId }).returning({ id: posKitchenBatch.id });
      const fire = lines.filter((line) => firesNow(line, threshold)).map((line) => line.id);
      const wait = lines.filter((line) => !firesNow(line, threshold)).map((line) => line.id);
      if (fire.length > 0) await tx.update(posOrderLine).set({ status: "SENT", sentAt: now, firedAt: now, kitchenBatchId: batch.id, updatedAt: now }).where(inArray(posOrderLine.id, fire));
      if (wait.length > 0) await tx.update(posOrderLine).set({ status: "SENT", sentAt: now, firedAt: null, kitchenBatchId: batch.id, updatedAt: now }).where(inArray(posOrderLine.id, wait));
      held += wait.length;
      batches.push({ id: batch.id, station });
    }
    const direct = pending.filter((line) => line.station === "NONE");
    if (direct.length > 0) await tx.update(posOrderLine).set({ status: "SERVED", sentAt: now, firedAt: now, updatedAt: now }).where(inArray(posOrderLine.id, direct.map((line) => line.id)));
    await tx.update(posOrder).set({ updatedAt: now }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.send", "pos_order", orderId, { batches, lines: pending.length, held }, tx);
    return { batches, held };
  });
}

/** «Marchar»: cocina empieza el siguiente tiempo en espera de la mesa. */
export async function fireNextCourse(actor: PosActor, orderId: string) {
  return db.transaction(async (tx) => {
    await loadOpenOrder(tx, actor.companyId, orderId);
    const lines = await tx.select().from(posOrderLine).where(eq(posOrderLine.orderId, orderId));
    const course = nextHeldCourse(lines);
    if (course === null) throw new HttpError(409, "No hay nada en espera en cocina.");
    const now = new Date();
    const fired = lines.filter((line) => line.station === "KITCHEN" && line.status === "SENT" && !line.firedAt && line.course <= course);
    await tx.update(posOrderLine).set({ firedAt: now, updatedAt: now }).where(inArray(posOrderLine.id, fired.map((line) => line.id)));
    await tx.update(posOrder).set({ firedCourse: course, updatedAt: now }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.fire", "pos_order", orderId, { course, lines: fired.length }, tx);
    return { course, lines: fired.length, batches: [...new Set(fired.map((line) => line.kitchenBatchId).filter((id): id is string => Boolean(id)))] };
  });
}

/** Pide la cuenta: la mesa queda marcada y se puede imprimir la pre-cuenta. */
export async function requestBill(actor: PosActor, orderId: string) {
  await db.transaction(async (tx) => {
    await loadOpenOrder(tx, actor.companyId, orderId);
    await tx.update(posOrder).set({ status: "BILL_REQUESTED", updatedAt: new Date() }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.bill", "pos_order", orderId, {}, tx);
  });
  return { id: orderId };
}

async function hasPayments(client: DbClient, companyId: string, orderId: string) {
  const [row] = await client.select({ id: posTicket.id }).from(posTicket).where(and(eq(posTicket.companyId, companyId), eq(posTicket.orderId, orderId))).limit(1);
  return Boolean(row);
}

/** Cambia la cuenta a otra mesa libre. */
export async function moveOrder(actor: PosActor, orderId: string, tableId: string) {
  return db.transaction(async (tx) => {
    const order = await loadOpenOrder(tx, actor.companyId, orderId);
    const table = await assertTable(tx, actor.companyId, tableId);
    if (await tableOpenOrder(tx, actor.companyId, tableId)) throw new HttpError(409, `${table.name} está ocupada: júntalas en lugar de moverla.`);
    await tx.update(posOrder).set({ tableId, label: null, updatedAt: new Date() }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.move", "pos_order", orderId, { from: order.tableId, to: tableId }, tx);
    return { id: orderId };
  });
}

/** Junta dos cuentas: lo pendiente de una pasa a la otra (que se queda con los comensales de ambas). */
export async function mergeOrders(actor: PosActor, sourceOrderId: string, targetOrderId: string) {
  if (sourceOrderId === targetOrderId) throw new HttpError(400, "Elige otra mesa.");
  return db.transaction(async (tx) => {
    const source = await loadOpenOrder(tx, actor.companyId, sourceOrderId);
    const target = await loadOpenOrder(tx, actor.companyId, targetOrderId);
    if (source.equalSplit || target.equalSplit) throw new HttpError(409, "Hay una cuenta pagándose a partes iguales: termina de cobrarla.");
    if (await hasPayments(tx, actor.companyId, sourceOrderId)) throw new HttpError(409, "Esa cuenta ya tiene cobros: pasa los productos pendientes con «Traspasar».");
    await tx.update(posOrderLine).set({ orderId: targetOrderId, updatedAt: new Date() }).where(eq(posOrderLine.orderId, sourceOrderId));
    await tx.update(posKitchenBatch).set({ orderId: targetOrderId }).where(eq(posKitchenBatch.orderId, sourceOrderId));
    await tx.update(posOrder).set({ guests: Math.min(200, source.guests + target.guests), status: "OPEN", updatedAt: new Date() }).where(eq(posOrder.id, targetOrderId));
    await tx.update(posOrder).set({ status: "CANCELLED", cancelReason: "Unida a otra cuenta", closedAt: new Date(), updatedAt: new Date() }).where(eq(posOrder.id, sourceOrderId));
    await audit(actor, "pos_order.merge", "pos_order", targetOrderId, { sourceOrderId }, tx);
    return { id: targetOrderId };
  });
}

/** Pasa unidades pendientes de cobro a otra mesa (la abre si está libre). */
export async function transferLines(actor: PosActor, orderId: string, input: { lines: Array<{ lineId: string; quantity: number }>; tableId: string }) {
  return db.transaction(async (tx) => {
    const order = await loadOpenOrder(tx, actor.companyId, orderId);
    if (order.equalSplit) throw new HttpError(409, "La cuenta se está pagando a partes iguales.");
    if (order.tableId === input.tableId) throw new HttpError(400, "Elige otra mesa.");
    await assertTable(tx, actor.companyId, input.tableId);
    let target = await tableOpenOrder(tx, actor.companyId, input.tableId);
    if (!target) {
      const [created] = await tx.insert(posOrder).values({ companyId: actor.companyId, registerId: order.registerId, tableId: input.tableId, guests: 1, waiterUserId: order.waiterUserId, openedByUserId: actor.actorUserId }).returning({ id: posOrder.id });
      target = created;
    }
    const lines = await tx.select().from(posOrderLine).where(eq(posOrderLine.orderId, orderId));
    for (const entry of input.lines) {
      const line = lines.find((candidate) => candidate.id === entry.lineId);
      if (!line || line.status === "CANCELLED") throw new HttpError(404, "Línea no encontrada.");
      if (line.parentLineId) throw new HttpError(409, "Es un plato de un menú: pasa el menú entero.");
      const children = lines.filter((candidate) => candidate.parentLineId === line.id && candidate.status !== "CANCELLED");
      if (children.length > 0) {
        // Un menú pasa entero, con sus platos.
        if (num(line.paidQuantity) > 0 || Math.abs(entry.quantity - num(line.quantity)) > 0.0005) throw new HttpError(409, `«${line.description}» se pasa entero y sin cobros.`);
        await tx.update(posOrderLine).set({ orderId: target.id, updatedAt: new Date() }).where(inArray(posOrderLine.id, [line.id, ...children.map((child) => child.id)]));
        continue;
      }
      const available = num(line.quantity) - num(line.paidQuantity);
      if (!(entry.quantity > 0) || entry.quantity > available + 0.0005) throw new HttpError(409, `De «${line.description}» solo se pueden pasar ${available.toLocaleString("es-ES")}.`);
      const remaining = Math.round((num(line.quantity) - entry.quantity) * 1000) / 1000;
      if (remaining <= 0.0005) {
        await tx.update(posOrderLine).set({ orderId: target.id, updatedAt: new Date() }).where(eq(posOrderLine.id, line.id));
      } else {
        await tx.update(posOrderLine).set({ quantity: qty(remaining), updatedAt: new Date() }).where(eq(posOrderLine.id, line.id));
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, paidQuantity: _paid, ...copy } = line;
        await tx.insert(posOrderLine).values({ ...copy, orderId: target.id, quantity: qty(entry.quantity), paidQuantity: "0" });
      }
    }
    await tx.update(posOrder).set({ updatedAt: new Date() }).where(inArray(posOrder.id, [orderId, target.id]));
    await audit(actor, "pos_order.transfer", "pos_order", orderId, { targetOrderId: target.id, lines: input.lines }, tx);
    return { id: orderId, targetOrderId: target.id };
  });
}

/** Cierra sin cobrar una cuenta sin cobros (se equivocaron de mesa, se fueron sin consumir…). */
export async function cancelOrder(actor: PosActor, orderId: string, reason: string) {
  return db.transaction(async (tx) => {
    await loadOpenOrder(tx, actor.companyId, orderId);
    if (await hasPayments(tx, actor.companyId, orderId)) throw new HttpError(409, "La cuenta ya tiene cobros: cobra el resto.");
    const lines = await tx.select({ status: posOrderLine.status }).from(posOrderLine).where(eq(posOrderLine.orderId, orderId));
    const served = lines.filter((line) => line.status !== "PENDING" && line.status !== "CANCELLED").length;
    if (served > 0 && !reason.trim()) throw new HttpError(400, "Hay productos ya enviados: indica el motivo para cerrar sin cobrar.");
    await tx.update(posOrderLine).set({ status: "CANCELLED", cancelReason: reason.trim() || "Cuenta anulada", updatedAt: new Date() }).where(and(eq(posOrderLine.orderId, orderId), ne(posOrderLine.status, "CANCELLED")));
    await tx.update(posOrder).set({ status: "CANCELLED", cancelReason: reason.trim() || null, closedAt: new Date(), updatedAt: new Date() }).where(eq(posOrder.id, orderId));
    await audit(actor, "pos_order.cancel", "pos_order", orderId, { reason, sentLines: served }, tx);
    return { id: orderId };
  });
}

export type PayOrderInput = {
  part: BillPart;
  payment: { cash: number; card: number; cashReceived?: number | null };
  customerId?: string | null;
  tipAmount?: number;
  waiterUserId?: string | null;
  clientRequestId: string;
};

/**
 * Cobra la cuenta entera o una parte (por productos o a partes iguales). Cada cobro es un ticket
 * (factura simplificada) en la sesión de caja abierta; lo cobrado se marca en la cuenta dentro de la
 * misma transacción. Al cobrar lo último, la mesa queda libre y sale el stock de todo lo servido.
 */
export async function payOrder(actor: PosActor, orderId: string, input: PayOrderInput): Promise<SaleResult & { closed: boolean; pending: number }> {
  const order = await loadOrder(db, actor.companyId, orderId);
  const [previous] = await db.select({ id: posTicket.id }).from(posTicket).where(and(eq(posTicket.companyId, actor.companyId), eq(posTicket.clientRequestId, input.clientRequestId))).limit(1);
  if (!previous && !OPEN_STATUSES.includes(order.status as (typeof OPEN_STATUSES)[number])) throw new HttpError(409, "Esta cuenta ya está cerrada.");
  const lines = await loadLines(db, [orderId]);
  const view = await getOrder(actor.companyId, orderId);
  const plan = billPartLines(lines, input.part, order.equalSplit as EqualSplit | null, view?.name ?? "Cuenta");
  if ("error" in plan && !previous) throw new HttpError(409, plan.error);
  const cart = "error" in plan ? [] : plan.cart;
  let closed = false;

  const sale = await createSale(actor, {
    registerId: order.registerId,
    lines: cart.map((line) => ({ itemId: line.itemId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, taxId: line.taxId ?? null })),
    customerId: input.customerId ?? null,
    payment: input.payment,
    clientRequestId: input.clientRequestId,
  }, {
    orderId,
    skipStock: true,
    tipAmount: input.tipAmount,
    waiterUserId: input.waiterUserId ?? order.waiterUserId,
    onIssued: async (tx) => {
      if ("error" in plan) return;
      // La cuenta no ha cambiado desde que se calculó el cobro (otro camarero no ha cobrado a la vez).
      const fresh = await loadOpenOrder(tx, actor.companyId, orderId);
      if (JSON.stringify(fresh.equalSplit ?? null) !== JSON.stringify(order.equalSplit ?? null)) throw new HttpError(409, "La cuenta ha cambiado mientras cobrabas: vuelve a intentarlo.");
      for (const [lineId, paidQuantity] of plan.paidQuantities) {
        await tx.update(posOrderLine).set({ paidQuantity: qty(paidQuantity), updatedAt: new Date() }).where(eq(posOrderLine.id, lineId));
      }
      closed = plan.closes;
      await tx
        .update(posOrder)
        .set({ equalSplit: plan.equalSplit, ...(plan.closes ? { status: "PAID", closedAt: new Date() } : {}), updatedAt: new Date() })
        .where(eq(posOrder.id, orderId));
      if (plan.closes) {
        const [register] = await tx.select({ warehouseId: posRegister.warehouseId }).from(posRegister).where(eq(posRegister.id, order.registerId)).limit(1);
        if (register?.warehouseId && (await isModuleEnabled(actor.companyId, "inventory"))) {
          const served = lines.filter((line) => line.status !== "CANCELLED");
          await moveStock(tx, actor.companyId, register.warehouseId, served.map((line) => ({ itemId: line.itemId, quantity: line.quantity })), "OUT", `pos-order:${orderId}`, `Mesa ${view?.name ?? ""}`.trim(), []);
        }
      }
      await audit(actor, plan.closes ? "pos_order.paid" : "pos_order.partial_payment", "pos_order", orderId, { mode: input.part.mode, closes: plan.closes, tip: input.tipAmount ?? 0 }, tx);
    },
  });
  const after = await getOrder(actor.companyId, orderId);
  return { ...sale, closed: closed || after?.status === "PAID", pending: after?.amounts.pending ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Cocina y barra
// ---------------------------------------------------------------------------------------------

/** Comandas pendientes de una estación (las más antiguas primero), para su pantalla. */
export async function getKitchenBoard(companyId: string, station: Exclude<Station, "NONE">) {
  const rows = await db
    .select({
      lineId: posOrderLine.id,
      batchId: posOrderLine.kitchenBatchId,
      orderId: posOrderLine.orderId,
      description: posOrderLine.description,
      quantity: posOrderLine.quantity,
      note: posOrderLine.note,
      status: posOrderLine.status,
      sentAt: posOrderLine.sentAt,
      course: posOrderLine.course,
      firedAt: posOrderLine.firedAt,
      parentLineId: posOrderLine.parentLineId,
      tableName: posTable.name,
      label: posOrder.label,
      waiterName: user.name,
    })
    .from(posOrderLine)
    .innerJoin(posOrder, eq(posOrder.id, posOrderLine.orderId))
    .leftJoin(posTable, eq(posTable.id, posOrder.tableId))
    .leftJoin(user, eq(user.id, posOrder.waiterUserId))
    .where(and(eq(posOrder.companyId, companyId), eq(posOrderLine.station, station), inArray(posOrderLine.status, ["SENT", "READY"])))
    .orderBy(asc(posOrderLine.sentAt), asc(posOrderLine.createdAt));
  const batches = new Map<string, { batchId: string; orderId: string; name: string; waiterName: string | null; sentAt: Date | null; firedAt: Date | null; lines: Array<{ id: string; description: string; quantity: number; note: string | null; status: LineStatus; course: number; held: boolean; firedAt: Date | null; inMenu: boolean }> }>();
  for (const row of rows) {
    const key = row.batchId ?? row.orderId;
    const batch = batches.get(key) ?? { batchId: key, orderId: row.orderId, name: row.tableName ?? row.label ?? "Cuenta", waiterName: row.waiterName, sentAt: row.sentAt, firedAt: null, lines: [] };
    const held = row.status === "SENT" && !row.firedAt;
    batch.lines.push({ id: row.lineId, description: row.description, quantity: num(row.quantity), note: row.note, status: row.status as LineStatus, course: row.course, held, firedAt: row.firedAt, inMenu: Boolean(row.parentLineId) });
    // Lo último que se ha marchado en la comanda (para avisar y ordenar).
    if (row.firedAt && (!batch.firedAt || row.firedAt > batch.firedAt)) batch.firedAt = row.firedAt;
    batches.set(key, batch);
  }
  for (const batch of batches.values()) batch.lines.sort((a, b) => Number(a.held) - Number(b.held) || a.course - b.course);
  return [...batches.values()];
}

/** Cocina/barra marca líneas como listas o servidas (o las devuelve a «en preparación»). */
export async function setKitchenLineStatus(actor: PosActor, lineIds: string[], status: "SENT" | "READY" | "SERVED") {
  if (lineIds.length === 0) return { updated: 0 };
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: posOrderLine.id, orderId: posOrderLine.orderId })
      .from(posOrderLine)
      .innerJoin(posOrder, eq(posOrder.id, posOrderLine.orderId))
      .where(and(eq(posOrder.companyId, actor.companyId), inArray(posOrderLine.id, lineIds), inArray(posOrderLine.status, ["SENT", "READY", "SERVED"])));
    if (owned.length === 0) return { updated: 0 };
    await tx.update(posOrderLine).set({ status, updatedAt: new Date() }).where(inArray(posOrderLine.id, owned.map((row) => row.id)));
    await tx.update(posOrder).set({ updatedAt: new Date() }).where(inArray(posOrder.id, [...new Set(owned.map((row) => row.orderId))]));
    await audit(actor, `pos_kitchen.${status.toLowerCase()}`, "pos_order_line", owned[0].id, { lineIds: owned.map((row) => row.id) }, tx);
    return { updated: owned.length };
  });
}

/** Comanda impresa: líneas de un envío a cocina o barra. */
export async function getKitchenBatch(companyId: string, batchId: string) {
  const [batch] = await db
    .select({ id: posKitchenBatch.id, station: posKitchenBatch.station, createdAt: posKitchenBatch.createdAt, orderId: posKitchenBatch.orderId, tableName: posTable.name, label: posOrder.label, guests: posOrder.guests, waiterName: user.name })
    .from(posKitchenBatch)
    .innerJoin(posOrder, eq(posOrder.id, posKitchenBatch.orderId))
    .leftJoin(posTable, eq(posTable.id, posOrder.tableId))
    .leftJoin(user, eq(user.id, posKitchenBatch.sentByUserId))
    .where(and(eq(posKitchenBatch.id, batchId), eq(posKitchenBatch.companyId, companyId)))
    .limit(1);
  if (!batch) return null;
  const lines = await db.select({ description: posOrderLine.description, quantity: posOrderLine.quantity, note: posOrderLine.note, status: posOrderLine.status, course: posOrderLine.course, firedAt: posOrderLine.firedAt, parentLineId: posOrderLine.parentLineId }).from(posOrderLine).where(eq(posOrderLine.kitchenBatchId, batchId)).orderBy(asc(posOrderLine.course), asc(posOrderLine.createdAt));
  return { ...batch, station: batch.station as Station, name: batch.tableName ?? batch.label ?? "Cuenta", lines: lines.map((line) => ({ ...line, quantity: num(line.quantity), held: line.status === "SENT" && !line.firedAt, inMenu: Boolean(line.parentLineId) })) };
}

/** Mesas abiertas de una caja (aviso al cerrarla). */
export async function countOpenOrders(companyId: string, registerId: string) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(posOrder).where(and(eq(posOrder.companyId, companyId), eq(posOrder.registerId, registerId), inArray(posOrder.status, [...OPEN_STATUSES])));
  return row?.count ?? 0;
}

/** ¿Puede vender esta caja (sesión abierta)? Las cuentas se pueden abrir y llevar sin caja abierta, pero no cobrar. */
export async function hasOpenSession(companyId: string, registerId: string) {
  return Boolean(await getOpenSession(companyId, registerId));
}
