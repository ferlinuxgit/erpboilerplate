import { and, asc, eq, inArray } from "drizzle-orm";

import { item, itemCategory, itemRecipeLine, tax, unitOfMeasure } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createsCycle, foodCost, recipeCost, type RecipeBook } from "@/modules/hospitality/recipes";
import { grossPrice } from "@/modules/pos/model";
import { recordAudit } from "@/server/audit";
import type { PosActor } from "@/server/pos/service";

const num = (value: string | number | null | undefined) => Number(value ?? 0);

/** Todos los escandallos de la empresa (para desglosar ventas y calcular costes). */
export async function loadRecipeBook(client: DbClient, companyId: string): Promise<RecipeBook> {
  const rows = await client.select({ itemId: itemRecipeLine.itemId, ingredientItemId: itemRecipeLine.ingredientItemId, quantity: itemRecipeLine.quantity }).from(itemRecipeLine).where(eq(itemRecipeLine.companyId, companyId)).orderBy(asc(itemRecipeLine.position));
  const book = new Map<string, Array<{ ingredientItemId: string; quantity: number }>>();
  for (const row of rows) {
    const list = book.get(row.itemId) ?? [];
    list.push({ ingredientItemId: row.ingredientItemId, quantity: num(row.quantity) });
    book.set(row.itemId, list);
  }
  return book;
}

/** Coste unitario de un ingrediente: coste medio del almacén o, si aún no hay, el de compra. */
const unitCostOf = (row: { averageCost: string; costPrice: string }) => (num(row.averageCost) > 0 ? num(row.averageCost) : num(row.costPrice));

/** Platos con su escandallo, coste por ración, precio y food cost; y los artículos para elegir ingredientes. */
export async function listRecipes(companyId: string) {
  const [items, book] = await Promise.all([
    db
      .select({ id: item.id, name: item.name, sku: item.sku, isService: item.isService, isActive: item.isActive, salePrice: item.salePrice, costPrice: item.costPrice, averageCost: item.averageCost, taxRate: tax.rate, unit: unitOfMeasure.code, categoryName: itemCategory.name })
      .from(item)
      .leftJoin(tax, eq(tax.id, item.defaultTaxId))
      .leftJoin(unitOfMeasure, eq(unitOfMeasure.id, item.unitOfMeasureId))
      .leftJoin(itemCategory, eq(itemCategory.id, item.categoryId))
      .where(eq(item.companyId, companyId))
      .orderBy(asc(item.name)),
    loadRecipeBook(db, companyId),
  ]);
  const byId = new Map(items.map((row) => [row.id, row]));
  const unitCost = (itemId: string) => {
    const row = byId.get(itemId);
    if (!row) return 0;
    // Un ingrediente que a su vez tiene escandallo (sub-receta) cuesta lo que sus ingredientes.
    return book.has(itemId) ? recipeCost(itemId, book, (id) => (book.has(id) ? 0 : unitCostOf(byId.get(id) ?? { averageCost: "0", costPrice: "0" }))) : unitCostOf(row);
  };
  const recipes = [...book.keys()].filter((id) => byId.has(id)).map((itemId) => {
    const row = byId.get(itemId)!;
    const cost = recipeCost(itemId, book, (id) => (book.has(id) ? 0 : unitCostOf(byId.get(id) ?? { averageCost: "0", costPrice: "0" })));
    const netPrice = num(row.salePrice);
    return {
      itemId,
      name: row.name,
      categoryName: row.categoryName,
      price: grossPrice(netPrice, num(row.taxRate ?? 0)),
      netPrice,
      cost,
      margin: Math.round((netPrice - cost) * 100) / 100,
      foodCost: foodCost(cost, netPrice),
      lines: (book.get(itemId) ?? []).map((line) => {
        const ingredient = byId.get(line.ingredientItemId);
        return { ingredientItemId: line.ingredientItemId, name: ingredient?.name ?? "?", unit: ingredient?.unit ?? "ud", quantity: line.quantity, unitCost: unitCost(line.ingredientItemId), isSubRecipe: book.has(line.ingredientItemId) };
      }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return {
    recipes,
    items: items.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name, sku: row.sku, categoryName: row.categoryName, unit: row.unit ?? "ud", unitCost: unitCost(row.id), isService: row.isService, hasRecipe: book.has(row.id), netPrice: num(row.salePrice), price: grossPrice(num(row.salePrice), num(row.taxRate ?? 0)) })),
  };
}

export type RecipeList = Awaited<ReturnType<typeof listRecipes>>;

/** Sustituye el escandallo de un plato. */
export async function saveRecipe(actor: PosActor, itemId: string, lines: Array<{ ingredientItemId: string; quantity: number }>) {
  if (lines.length === 0) throw new HttpError(400, "Añade al menos un ingrediente.");
  if (lines.some((line) => !(line.quantity > 0))) throw new HttpError(400, "Las cantidades deben ser mayores que cero.");
  const ingredientIds = lines.map((line) => line.ingredientItemId);
  if (new Set(ingredientIds).size !== ingredientIds.length) throw new HttpError(400, "Hay ingredientes repetidos: súmalos en una línea.");
  if (ingredientIds.includes(itemId)) throw new HttpError(400, "Un plato no puede ser ingrediente de sí mismo.");
  return db.transaction(async (tx) => {
    const owned = await tx.select({ id: item.id }).from(item).where(and(eq(item.companyId, actor.companyId), inArray(item.id, [itemId, ...ingredientIds])));
    if (owned.length !== ingredientIds.length + 1) throw new HttpError(404, "Algún artículo no existe.");
    const book = new Map(await loadRecipeBook(tx, actor.companyId));
    book.delete(itemId);
    if (createsCycle(itemId, ingredientIds, book)) throw new HttpError(400, "Algún ingrediente ya lleva este plato dentro: se formaría un bucle.");
    await tx.delete(itemRecipeLine).where(and(eq(itemRecipeLine.itemId, itemId), eq(itemRecipeLine.companyId, actor.companyId)));
    await tx.insert(itemRecipeLine).values(lines.map((line, position) => ({ companyId: actor.companyId, itemId, ingredientItemId: line.ingredientItemId, quantity: line.quantity.toFixed(4), position })));
    await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "item_recipe.save", entityName: "item", entityId: itemId, payload: { lines } }, tx);
    return { itemId };
  });
}

export async function deleteRecipe(actor: PosActor, itemId: string) {
  await db.delete(itemRecipeLine).where(and(eq(itemRecipeLine.itemId, itemId), eq(itemRecipeLine.companyId, actor.companyId)));
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "item_recipe.delete", entityName: "item", entityId: itemId, payload: {} });
}
