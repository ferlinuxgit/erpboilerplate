import { and, asc, count, eq, inArray } from "drizzle-orm";

import { customer, customerGroup, item, priceList, priceListItem } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { NO_CUSTOMER_PRICING, type CustomerPricing } from "@/lib/pricing";
import { recordAudit } from "@/server/audit";

export type PricingActor = { tenantId: string; companyId: string; actorUserId: string };

/** Código corto: mayúsculas, letras, números y guiones (1–12 caracteres). */
export function normalizePricingCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,12}$/.test(normalized)) {
    throw new HttpError(400, "El código solo admite letras, números y guiones (máximo 12 caracteres), p. ej. MAY o HOST.");
  }
  return normalized;
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

async function withDuplicateMessage<T>(run: () => Promise<T>, message: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, message);
    throw error;
  }
}

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

/* ------------------------------------------------------------------ Tarifas */

export async function listPriceLists(companyId: string, client: DbClient = db) {
  const lists = await client.select().from(priceList).where(eq(priceList.companyId, companyId)).orderBy(asc(priceList.name));
  const counts = await client
    .select({ priceListId: priceListItem.priceListId, items: count() })
    .from(priceListItem)
    .where(eq(priceListItem.companyId, companyId))
    .groupBy(priceListItem.priceListId);
  const countById = new Map(counts.map((row) => [row.priceListId, row.items]));
  return lists.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    adjustmentPct: toNumber(row.adjustmentPct),
    isActive: row.isActive,
    itemCount: countById.get(row.id) ?? 0,
  }));
}

/** Tarifa con todos los artículos activos (y los que ya tienen precio aunque estén de baja) para editar sus precios. */
export async function getPriceListDetail(companyId: string, priceListId: string, client: DbClient = db) {
  const [list] = await client.select().from(priceList).where(and(eq(priceList.id, priceListId), eq(priceList.companyId, companyId))).limit(1);
  if (!list) return null;
  const rows = await client
    .select({ id: item.id, sku: item.sku, name: item.name, salePrice: item.salePrice, isActive: item.isActive, price: priceListItem.price })
    .from(item)
    .leftJoin(priceListItem, and(eq(priceListItem.itemId, item.id), eq(priceListItem.priceListId, priceListId)))
    .where(eq(item.companyId, companyId))
    .orderBy(asc(item.name));
  return {
    id: list.id,
    code: list.code,
    name: list.name,
    adjustmentPct: toNumber(list.adjustmentPct),
    isActive: list.isActive,
    items: rows
      .filter((row) => row.isActive || row.price !== null)
      .map((row) => ({ id: row.id, sku: row.sku, name: row.name, salePrice: toNumber(row.salePrice), price: row.price === null ? null : toNumber(row.price) })),
  };
}

export type PriceListInput = { code: string; name: string; adjustmentPct?: number };
export type PriceListUpdate = { name?: string; adjustmentPct?: number; isActive?: boolean; prices?: Array<{ itemId: string; price: number | null }> };

export async function createPriceList(actor: PricingActor, input: PriceListInput) {
  const code = normalizePricingCode(input.code);
  return withDuplicateMessage(() => db.transaction(async (tx) => {
    const [created] = await tx
      .insert(priceList)
      .values({ companyId: actor.companyId, code, name: input.name.trim(), adjustmentPct: (input.adjustmentPct ?? 0).toFixed(3) })
      .returning();
    await recordAudit({ ...actor, action: "priceList.create", entityName: "priceList", entityId: created!.id, payload: { code, name: created!.name } }, tx);
    return created!;
  }), `Ya existe una tarifa con el código ${code}.`);
}

export async function updatePriceList(actor: PricingActor, priceListId: string, input: PriceListUpdate) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(priceList).where(and(eq(priceList.id, priceListId), eq(priceList.companyId, actor.companyId))).limit(1);
    if (!existing) throw new HttpError(404, "Tarifa no encontrada.");
    const [saved] = await tx
      .update(priceList)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.adjustmentPct !== undefined ? { adjustmentPct: input.adjustmentPct.toFixed(3) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(priceList.id, priceListId))
      .returning();

    if (input.prices?.length) {
      const itemIds = [...new Set(input.prices.map((entry) => entry.itemId))];
      const owned = await tx.select({ id: item.id }).from(item).where(and(eq(item.companyId, actor.companyId), inArray(item.id, itemIds)));
      if (owned.length !== itemIds.length) throw new HttpError(400, "Algún artículo de la tarifa no existe en la empresa.");
      const toDelete = input.prices.filter((entry) => entry.price === null).map((entry) => entry.itemId);
      const toUpsert = input.prices.filter((entry): entry is { itemId: string; price: number } => entry.price !== null);
      if (toDelete.length) {
        await tx.delete(priceListItem).where(and(eq(priceListItem.priceListId, priceListId), inArray(priceListItem.itemId, toDelete)));
      }
      for (const entry of toUpsert) {
        await tx
          .insert(priceListItem)
          .values({ companyId: actor.companyId, priceListId, itemId: entry.itemId, price: entry.price.toFixed(2) })
          .onConflictDoUpdate({ target: [priceListItem.priceListId, priceListItem.itemId], set: { price: entry.price.toFixed(2), updatedAt: new Date() } });
      }
    }
    await recordAudit({
      ...actor,
      action: "priceList.update",
      entityName: "priceList",
      entityId: priceListId,
      payload: { name: input.name, adjustmentPct: input.adjustmentPct, isActive: input.isActive, pricesChanged: input.prices?.length ?? 0 },
    }, tx);
    return saved!;
  });
}

export async function deletePriceList(actor: PricingActor, priceListId: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(priceList).where(and(eq(priceList.id, priceListId), eq(priceList.companyId, actor.companyId))).returning({ id: priceList.id, name: priceList.name });
    if (!deleted) throw new HttpError(404, "Tarifa no encontrada.");
    await recordAudit({ ...actor, action: "priceList.delete", entityName: "priceList", entityId: priceListId, payload: { name: deleted.name } }, tx);
    return deleted;
  });
}

/* ------------------------------------------------------- Grupos de clientes */

export async function listCustomerGroups(companyId: string, client: DbClient = db) {
  const groups = await client
    .select({ id: customerGroup.id, code: customerGroup.code, name: customerGroup.name, priceListId: customerGroup.priceListId, discountPct: customerGroup.discountPct, priceListName: priceList.name })
    .from(customerGroup)
    .leftJoin(priceList, eq(priceList.id, customerGroup.priceListId))
    .where(eq(customerGroup.companyId, companyId))
    .orderBy(asc(customerGroup.name));
  const counts = await client
    .select({ groupId: customer.customerGroupId, customers: count() })
    .from(customer)
    .where(eq(customer.companyId, companyId))
    .groupBy(customer.customerGroupId);
  const countById = new Map(counts.map((row) => [row.groupId, row.customers]));
  return groups.map((row) => ({ ...row, discountPct: toNumber(row.discountPct), customerCount: countById.get(row.id) ?? 0 }));
}

export type CustomerGroupInput = { code: string; name: string; priceListId?: string | null; discountPct?: number };
export type CustomerGroupUpdate = { name?: string; priceListId?: string | null; discountPct?: number };

async function assertPriceListOwned(client: DbClient, companyId: string, priceListId: string | null | undefined) {
  if (!priceListId) return;
  const [row] = await client.select({ id: priceList.id }).from(priceList).where(and(eq(priceList.id, priceListId), eq(priceList.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(400, "La tarifa elegida no existe en la empresa.");
}

async function assertGroupOwned(client: DbClient, companyId: string, groupId: string | null | undefined) {
  if (!groupId) return;
  const [row] = await client.select({ id: customerGroup.id }).from(customerGroup).where(and(eq(customerGroup.id, groupId), eq(customerGroup.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(400, "El grupo de clientes elegido no existe en la empresa.");
}

/** Valida la tarifa y el grupo que se asignan a un cliente. */
export async function assertCustomerPricingRefs(companyId: string, refs: { customerGroupId?: string | null; priceListId?: string | null }, client: DbClient = db) {
  await assertGroupOwned(client, companyId, refs.customerGroupId);
  await assertPriceListOwned(client, companyId, refs.priceListId);
}

export async function createCustomerGroup(actor: PricingActor, input: CustomerGroupInput) {
  const code = normalizePricingCode(input.code);
  return withDuplicateMessage(() => db.transaction(async (tx) => {
    await assertPriceListOwned(tx, actor.companyId, input.priceListId);
    const [created] = await tx
      .insert(customerGroup)
      .values({ companyId: actor.companyId, code, name: input.name.trim(), priceListId: input.priceListId || null, discountPct: (input.discountPct ?? 0).toFixed(3) })
      .returning();
    await recordAudit({ ...actor, action: "customerGroup.create", entityName: "customerGroup", entityId: created!.id, payload: { code, name: created!.name } }, tx);
    return created!;
  }), `Ya existe un grupo de clientes con el código ${code}.`);
}

export async function updateCustomerGroup(actor: PricingActor, groupId: string, input: CustomerGroupUpdate) {
  return db.transaction(async (tx) => {
    await assertPriceListOwned(tx, actor.companyId, input.priceListId);
    const [saved] = await tx
      .update(customerGroup)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.priceListId !== undefined ? { priceListId: input.priceListId || null } : {}),
        ...(input.discountPct !== undefined ? { discountPct: input.discountPct.toFixed(3) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(customerGroup.id, groupId), eq(customerGroup.companyId, actor.companyId)))
      .returning();
    if (!saved) throw new HttpError(404, "Grupo de clientes no encontrado.");
    await recordAudit({ ...actor, action: "customerGroup.update", entityName: "customerGroup", entityId: groupId, payload: input }, tx);
    return saved;
  });
}

export async function deleteCustomerGroup(actor: PricingActor, groupId: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(customerGroup).where(and(eq(customerGroup.id, groupId), eq(customerGroup.companyId, actor.companyId))).returning({ id: customerGroup.id, name: customerGroup.name });
    if (!deleted) throw new HttpError(404, "Grupo de clientes no encontrado.");
    await recordAudit({ ...actor, action: "customerGroup.delete", entityName: "customerGroup", entityId: groupId, payload: { name: deleted.name } }, tx);
    return deleted;
  });
}

/* ------------------------------------------------------- Precio por cliente */

/** Tarifa (propia o del grupo) y descuento de grupo de un cliente. Tarifas desactivadas no se aplican. */
export async function getCustomerPricing(companyId: string, customerId: string, client: DbClient = db): Promise<CustomerPricing> {
  const [row] = await client
    .select({
      ownPriceListId: customer.priceListId,
      groupId: customerGroup.id,
      groupName: customerGroup.name,
      groupDiscountPct: customerGroup.discountPct,
      groupPriceListId: customerGroup.priceListId,
    })
    .from(customer)
    .leftJoin(customerGroup, eq(customerGroup.id, customer.customerGroupId))
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
    .limit(1);
  if (!row) return NO_CUSTOMER_PRICING;
  const group = row.groupId ? { id: row.groupId, name: row.groupName ?? "", discountPct: toNumber(row.groupDiscountPct) } : null;
  const priceListId = row.ownPriceListId ?? row.groupPriceListId;
  if (!priceListId) return { priceList: null, group };
  const [list] = await client
    .select({ id: priceList.id, name: priceList.name, adjustmentPct: priceList.adjustmentPct, isActive: priceList.isActive })
    .from(priceList)
    .where(and(eq(priceList.id, priceListId), eq(priceList.companyId, companyId)))
    .limit(1);
  if (!list?.isActive) return { priceList: null, group };
  const prices = await client
    .select({ itemId: priceListItem.itemId, price: priceListItem.price })
    .from(priceListItem)
    .where(eq(priceListItem.priceListId, list.id));
  return {
    priceList: { id: list.id, name: list.name, adjustmentPct: toNumber(list.adjustmentPct), prices: Object.fromEntries(prices.map((entry) => [entry.itemId, toNumber(entry.price)])) },
    group,
  };
}

/** Artículos activos para elegir en las líneas de venta (con su precio de venta base). */
export async function listSaleCatalog(companyId: string, client: DbClient = db) {
  const rows = await client
    .select({ id: item.id, sku: item.sku, name: item.name, salePrice: item.salePrice })
    .from(item)
    .where(and(eq(item.companyId, companyId), eq(item.isActive, true)))
    .orderBy(asc(item.name));
  return rows.map((row) => ({ id: row.id, sku: row.sku, name: row.name, salePrice: toNumber(row.salePrice) }));
}

/** Opciones de los selectores de grupo y tarifa en la ficha del cliente. */
export async function customerPricingOptions(companyId: string, client: DbClient = db) {
  const [groups, lists] = await Promise.all([listCustomerGroups(companyId, client), listPriceLists(companyId, client)]);
  return {
    groups: groups.map((group) => ({ id: group.id, name: group.name, discountPct: group.discountPct, priceListName: group.priceListName })),
    priceLists: lists.filter((list) => list.isActive).map((list) => ({ id: list.id, name: list.name })),
  };
}
