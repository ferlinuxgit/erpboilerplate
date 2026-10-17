import { and, asc, eq } from "drizzle-orm";

import { itemCategory, tax } from "@/db/schema";
import { type DbClient, db } from "@/lib/db";
import { HttpError } from "@/lib/http";

/** Categorías y tipos de IVA que se pueden asignar a un artículo. */
export async function listItemFormOptions(companyId: string) {
  const [categories, taxes] = await Promise.all([
    db.select({ id: itemCategory.id, name: itemCategory.name }).from(itemCategory).where(eq(itemCategory.companyId, companyId)).orderBy(asc(itemCategory.name)),
    db.select({ id: tax.id, name: tax.name, rate: tax.rate }).from(tax).where(and(eq(tax.companyId, companyId), eq(tax.isActive, true), eq(tax.kind, "VAT"), eq(tax.operation, "ADD"))).orderBy(asc(tax.rate)),
  ]);
  return { categories, taxes: taxes.map((entry) => ({ ...entry, rate: Number(entry.rate) })) };
}

/** Comprueba que la categoría y el IVA elegidos son de la empresa (y el IVA está activo). */
export async function assertItemRefs(client: DbClient, companyId: string, refs: { categoryId?: string | null; defaultTaxId?: string | null }) {
  if (refs.categoryId) {
    const [row] = await client.select({ id: itemCategory.id }).from(itemCategory).where(and(eq(itemCategory.id, refs.categoryId), eq(itemCategory.companyId, companyId))).limit(1);
    if (!row) throw new HttpError(404, "Categoría no encontrada.");
  }
  if (refs.defaultTaxId) {
    const [row] = await client.select({ id: tax.id }).from(tax).where(and(eq(tax.id, refs.defaultTaxId), eq(tax.companyId, companyId), eq(tax.isActive, true))).limit(1);
    if (!row) throw new HttpError(404, "Tipo de IVA no encontrado.");
  }
}
