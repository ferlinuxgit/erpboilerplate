import { and, eq, inArray } from "drizzle-orm";

import { item } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { HttpError, jsonError } from "@/lib/http";

/**
 * `item.id` es una FK global: sin esta comprobación una línea de documento
 * podría referenciar un artículo de otra empresa (fuga cross-tenant).
 */
export class ItemOwnershipError extends HttpError {
  readonly invalidItemIds: string[];

  constructor(invalidItemIds: string[]) {
    super(422, "Artículo no válido.");
    this.name = "ItemOwnershipError";
    this.invalidItemIds = invalidItemIds;
  }
}

type ItemReader = Pick<DbClient, "select">;

/**
 * Lanza `ItemOwnershipError` (422) si algún `itemId` informado no pertenece a
 * `companyId`. Ignora valores vacíos (líneas libres sin artículo).
 */
export async function assertItemsBelongToCompany(
  client: ItemReader,
  companyId: string,
  itemIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const uniqueIds = [...new Set(itemIds.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  if (uniqueIds.length === 0) return;

  const owned = await client
    .select({ id: item.id })
    .from(item)
    .where(and(eq(item.companyId, companyId), inArray(item.id, uniqueIds)));
  const ownedIds = new Set(owned.map((row) => row.id));
  const invalid = uniqueIds.filter((id) => !ownedIds.has(id));
  if (invalid.length > 0) throw new ItemOwnershipError(invalid);
}

/**
 * Variante para route handlers: devuelve una respuesta 422 lista para `return`
 * o `null` si todos los artículos son de la empresa.
 */
export async function rejectForeignItems(
  client: ItemReader,
  companyId: string,
  lines: ReadonlyArray<{ itemId?: string | null } | null | undefined> | null | undefined,
) {
  try {
    await assertItemsBelongToCompany(client, companyId, (lines ?? []).map((line) => line?.itemId));
    return null;
  } catch (error) {
    if (error instanceof ItemOwnershipError) return jsonError(error.status, error.message);
    throw error;
  }
}
