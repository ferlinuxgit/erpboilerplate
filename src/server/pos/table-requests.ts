import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { company, membership, posMenuItem, posMenuSettings, posRegister, posTable, posTableRequest } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { slugify, zonedParts } from "@/modules/hospitality/bookings";
import { grossPrice } from "@/modules/pos/model";
import { recordAudit } from "@/server/audit";
import { isModuleEnabled } from "@/server/modules/service";
import { addOrderLines, openOrder, sendOrderToKitchen } from "@/server/pos/hospitality";
import { getOrderingOptions } from "@/server/pos/ordering";
import { listPosCatalog, type PosActor } from "@/server/pos/service";

export const TABLE_REQUEST_KINDS = ["ORDER", "CALL", "BILL"] as const;
export type TableRequestKind = (typeof TABLE_REQUEST_KINDS)[number];
export type TableRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "DONE";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const MAX_LINES = 30;
const MAX_UNITS = 20;

export type TableRequestInput = { tableId: string; kind: TableRequestKind; items: Array<{ dishId: string; quantity: number; note: string | null }>; note: string | null };

/** Cliente sentado (QR de su mesa): pedir platos, llamar al camarero o pedir la cuenta. */
export async function createTableRequest(slug: string, input: TableRequestInput) {
  const [settings] = await db.select().from(posMenuSettings).where(eq(posMenuSettings.slug, slugify(slug))).limit(1);
  if (!settings || !settings.enabled || !(await isModuleEnabled(settings.companyId, "hospitality"))) throw new HttpError(404, "Esta carta no está disponible.");
  const companyId = settings.companyId;
  if (input.kind === "ORDER" ? !settings.tableOrdering : !settings.tableService) throw new HttpError(403, "Este local no admite pedidos desde la mesa.");
  const [table] = await db.select({ id: posTable.id, name: posTable.name }).from(posTable).where(and(eq(posTable.id, input.tableId), eq(posTable.companyId, companyId), eq(posTable.isActive, true))).limit(1);
  if (!table) throw new HttpError(404, "Mesa no encontrada: escanea el código de tu mesa.");

  if (input.kind !== "ORDER") {
    // Pulsar dos veces «Llamar» no crea dos avisos.
    const [existing] = await db.select({ id: posTableRequest.id }).from(posTableRequest).where(and(eq(posTableRequest.companyId, companyId), eq(posTableRequest.tableId, table.id), eq(posTableRequest.kind, input.kind), eq(posTableRequest.status, "PENDING"))).limit(1);
    if (existing) return { id: existing.id, token: null, status: "PENDING" as TableRequestStatus, duplicate: true };
  }

  let items: Array<{ itemId: string; name: string; quantity: number; note: string | null; price: number }> = [];
  if (input.kind === "ORDER") {
    if (input.items.length === 0) throw new HttpError(400, "El pedido está vacío.");
    if (input.items.length > MAX_LINES || input.items.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_UNITS)) throw new HttpError(400, `Como mucho ${MAX_UNITS} unidades de cada plato: para grupos grandes, pide al camarero.`);
    const [rows, catalog, ordering, [owner]] = await Promise.all([
      db.select({ id: posMenuItem.id, itemId: posMenuItem.itemId, displayName: posMenuItem.displayName, soldOutDate: posMenuItem.soldOutDate }).from(posMenuItem).where(and(eq(posMenuItem.companyId, companyId), eq(posMenuItem.visible, true), inArray(posMenuItem.id, input.items.map((line) => line.dishId)))),
      listPosCatalog(companyId, null, false),
      getOrderingOptions(companyId),
      db.select({ timezone: company.timezone }).from(company).where(eq(company.id, companyId)).limit(1),
    ]);
    const today = zonedParts(new Date(), owner?.timezone ?? "Europe/Madrid").date;
    items = input.items.map((line) => {
      const row = rows.find((candidate) => candidate.id === line.dishId);
      const entry = row ? catalog.find((candidate) => candidate.id === row.itemId) : undefined;
      if (!row || !entry) throw new HttpError(409, "Algún plato ya no está en la carta: vuelve a cargarla.");
      if (row.soldOutDate === today) throw new HttpError(409, `«${row.displayName ?? entry.name}» se ha agotado.`);
      if (ordering.modifiers[entry.id]?.length || ordering.setMenus[entry.id]?.length) throw new HttpError(409, `«${row.displayName ?? entry.name}» se pide al camarero (tiene opciones).`);
      return { itemId: entry.id, name: row.displayName ?? entry.name, quantity: line.quantity, note: line.note?.trim().slice(0, 120) || null, price: grossPrice(entry.unitPrice, entry.taxRate) };
    });
  }

  const token = randomBytes(18).toString("base64url");
  const [created] = await db.insert(posTableRequest).values({ companyId, tableId: table.id, kind: input.kind, items, note: input.note?.trim().slice(0, 200) || null, tokenHash: hashToken(token) }).returning({ id: posTableRequest.id });

  // Sin confirmación: entra en la cuenta de la mesa y va a cocina al momento.
  if (input.kind === "ORDER" && settings.directToKitchen) {
    const actor = await ownerActor(companyId);
    const registerId = await defaultRegister(companyId);
    if (actor && registerId) {
      await acceptOrder(actor, created.id, registerId, null, true).catch(() => undefined);
    }
  }
  const [after] = await db.select({ status: posTableRequest.status }).from(posTableRequest).where(eq(posTableRequest.id, created.id)).limit(1);
  return { id: created.id, token, status: (after?.status ?? "PENDING") as TableRequestStatus, duplicate: false };
}

/** Para pedidos directos: se atribuyen al propietario (queda en la auditoría como pedido desde la mesa). */
async function ownerActor(companyId: string): Promise<PosActor | null> {
  const [row] = await db.select({ tenantId: company.tenantId, countryCode: company.countryCode }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!row) return null;
  const [owner] = await db.select({ userId: membership.userId }).from(membership).where(and(eq(membership.tenantId, row.tenantId), eq(membership.role, "OWNER"))).limit(1);
  if (!owner) return null;
  return { tenantId: row.tenantId, companyId, actorUserId: owner.userId, countryCode: row.countryCode, activeFiscalYearId: "" } as PosActor;
}

async function defaultRegister(companyId: string) {
  const [register] = await db.select({ id: posRegister.id }).from(posRegister).where(and(eq(posRegister.companyId, companyId), eq(posRegister.mode, "TABLES"), eq(posRegister.isActive, true))).orderBy(asc(posRegister.name)).limit(1);
  return register?.id ?? null;
}

/** El cliente consulta en qué queda su pedido (con el código que recibió al enviarlo). */
export async function getTableRequest(id: string, token: string) {
  const [row] = await db.select({ status: posTableRequest.status, kind: posTableRequest.kind, tokenHash: posTableRequest.tokenHash }).from(posTableRequest).where(eq(posTableRequest.id, id)).limit(1);
  if (!row || row.tokenHash !== hashToken(token)) return null;
  return { status: row.status as TableRequestStatus, kind: row.kind as TableRequestKind };
}

/** Peticiones pendientes por mesa (para el plano de la sala). */
export async function pendingRequestsByTable(companyId: string) {
  const rows = await db.select().from(posTableRequest).where(and(eq(posTableRequest.companyId, companyId), eq(posTableRequest.status, "PENDING"))).orderBy(asc(posTableRequest.createdAt));
  const byTable = new Map<string, Array<{ id: string; kind: TableRequestKind; items: typeof rows[number]["items"]; note: string | null; createdAt: string }>>();
  for (const row of rows) {
    const list = byTable.get(row.tableId) ?? [];
    list.push({ id: row.id, kind: row.kind as TableRequestKind, items: row.items, note: row.note, createdAt: row.createdAt.toISOString() });
    byTable.set(row.tableId, list);
  }
  return byTable;
}

async function loadPending(companyId: string, id: string) {
  const [row] = await db.select().from(posTableRequest).where(and(eq(posTableRequest.id, id), eq(posTableRequest.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, "Petición no encontrada.");
  if (row.status !== "PENDING") throw new HttpError(409, "Otro camarero ya la ha atendido.");
  return row;
}

/** Aceptar un pedido: entra en la cuenta de la mesa (se abre si no la tiene) con los precios del TPV. */
async function acceptOrder(actor: PosActor, id: string, registerId: string, waiterUserId: string | null, sendNow: boolean) {
  const request = await loadPending(actor.companyId, id);
  if (request.kind !== "ORDER") throw new HttpError(400, "No es un pedido.");
  const catalog = await listPosCatalog(actor.companyId, null, false);
  const order = await openOrder(actor, { registerId, tableId: request.tableId, guests: 1, waiterUserId });
  await addOrderLines(actor, order.id, request.items.map((line) => {
    const entry = catalog.find((candidate) => candidate.id === line.itemId);
    if (!entry) throw new HttpError(409, `«${line.name}» ya no está en el catálogo.`);
    return { itemId: entry.id, description: entry.name, quantity: line.quantity, unitPrice: entry.unitPrice, taxRate: entry.taxRate, taxId: entry.taxId, note: line.note ? `QR: ${line.note}` : "Pedido desde la mesa" };
  }), waiterUserId, `table-request:${id}`);
  if (sendNow) await sendOrderToKitchen(actor, order.id, `table-request-send:${id}`);
  await db.update(posTableRequest).set({ status: "ACCEPTED", orderId: order.id, handledByUserId: actor.actorUserId, handledAt: new Date() }).where(eq(posTableRequest.id, id));
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: sendNow ? "pos_table_request.direct" : "pos_table_request.accept", entityName: "pos_table_request", entityId: id, payload: { orderId: order.id, lines: request.items.length } });
  return { orderId: order.id, registerId };
}

/** El camarero atiende una petición: aceptar o rechazar un pedido, o marcar atendido un aviso. */
export async function handleTableRequest(actor: PosActor, id: string, action: "ACCEPT" | "REJECT" | "DONE", input: { registerId: string | null; waiterUserId: string | null }) {
  if (action === "ACCEPT") {
    const registerId = input.registerId ?? (await defaultRegister(actor.companyId));
    if (!registerId) throw new HttpError(400, "Necesitas una caja en modo «Mesas».");
    return acceptOrder(actor, id, registerId, input.waiterUserId, false);
  }
  await loadPending(actor.companyId, id);
  await db.update(posTableRequest).set({ status: action === "REJECT" ? "REJECTED" : "DONE", handledByUserId: actor.actorUserId, handledAt: new Date() }).where(eq(posTableRequest.id, id));
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: `pos_table_request.${action.toLowerCase()}`, entityName: "pos_table_request", entityId: id, payload: {} });
  return { orderId: null, registerId: null };
}
