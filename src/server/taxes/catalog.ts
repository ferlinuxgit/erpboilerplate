import { and, eq, inArray } from "drizzle-orm";

import { tax } from "@/db/schema";
import { getCompanyTemplate, type CompanyTemplateTax } from "@/lib/company-templates";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { taxSignatureKey } from "@/server/taxes/duplicates";

export type TaxCatalogGroup = "VAT" | "SURCHARGE" | "WITHHOLDING" | "OTHER";

export type TaxCatalogEntry = {
  /** Clave estable: tipo, porcentaje y operación (dos impuestos con la misma son el mismo). */
  code: string;
  name: string;
  rate: number;
  kind: TaxCatalogGroup;
  operation: "ADD" | "SUBTRACT";
  description: string | null;
  inUseByDefault: boolean;
  /** La empresa lo usa (tiene un impuesto activo equivalente). */
  inUse: boolean;
  /** Nombre que tiene en la empresa si es distinto del del catálogo («IVA» → «IVA general 21%»). */
  companyName: string | null;
  isDefault: boolean;
  /** Impuesto de la empresa que lo representa (el activo o, si no se usa, el archivado). */
  taxId: string | null;
};

export type CompanyCustomTax = { id: string; name: string; rate: number; kind: string; operation: string; isActive: boolean; isDefault: boolean };

function entrySignature(entry: CompanyTemplateTax) {
  const kind = entry.kind ?? "VAT";
  return taxSignatureKey({ kind, rate: entry.rate, operation: entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD") });
}

const groupDescriptions: Partial<Record<TaxCatalogGroup, string>> = {
  VAT: "Impuesto indirecto que se suma a la factura.",
  SURCHARGE: "Recargo de equivalencia: se suma junto a su IVA.",
  WITHHOLDING: "Retención: se resta del total a cobrar.",
};

/** Catálogo de impuestos del territorio fiscal de la empresa (la plantilla de su país o territorio). */
export function taxCatalogFor(territory: string) {
  return getCompanyTemplate(territory).taxes.map((entry) => {
    const kind = (entry.kind ?? "VAT") as TaxCatalogGroup;
    return {
      code: entrySignature(entry),
      name: entry.name,
      rate: Number(entry.rate),
      kind,
      operation: entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD"),
      description: entry.description ?? groupDescriptions[kind] ?? null,
      inUseByDefault: entry.inUseByDefault !== false,
    } as const;
  });
}

async function companyTaxRows(client: DbClient, companyId: string) {
  return client
    .select({ id: tax.id, name: tax.name, rate: tax.rate, kind: tax.kind, operation: tax.operation, isActive: tax.isActive, isDefault: tax.isDefault })
    .from(tax)
    .where(eq(tax.companyId, companyId));
}

/** Catálogo con el estado de la empresa y, aparte, los impuestos propios que no están en él. */
export async function listCompanyTaxCatalog(companyId: string, client: DbClient = db): Promise<{ territory: string; entries: TaxCatalogEntry[]; custom: CompanyCustomTax[] }> {
  const territory = await getCompanyTaxTerritory(companyId, client);
  const catalog = taxCatalogFor(territory);
  const rows = await companyTaxRows(client, companyId);
  const codes = new Set(catalog.map((entry) => entry.code));
  const entries = catalog.map((entry) => {
    const matches = rows.filter((row) => taxSignatureKey(row) === entry.code);
    const active = matches.find((row) => row.isActive);
    const shown = active ?? matches[0];
    return {
      ...entry,
      inUse: Boolean(active),
      companyName: shown && shown.name !== entry.name ? shown.name : null,
      isDefault: Boolean(active?.isDefault),
      taxId: shown?.id ?? null,
    };
  });
  const custom = rows
    .filter((row) => !codes.has(taxSignatureKey(row)))
    .map((row) => ({ id: row.id, name: row.name, rate: Number(row.rate), kind: row.kind, operation: row.operation, isActive: row.isActive, isDefault: row.isDefault }));
  return { territory, entries, custom };
}

/**
 * Marca un impuesto del catálogo como «lo uso» o «no lo uso». Usar uno que la empresa ya tenía lo
 * reactiva (con su nombre); si no lo tenía, se crea con el nombre del catálogo. Dejar de usarlo lo
 * archiva: no aparece al facturar, pero las facturas que ya lo llevan no cambian.
 */
export async function setCompanyCatalogTaxInUse(companyId: string, code: string, inUse: boolean, client: DbClient = db) {
  const territory = await getCompanyTaxTerritory(companyId, client);
  const entry = taxCatalogFor(territory).find((candidate) => candidate.code === code);
  if (!entry) return null;
  const matches = (await companyTaxRows(client, companyId)).filter((row) => taxSignatureKey(row) === code);
  if (!inUse) {
    if (matches.length > 0) {
      await client.update(tax).set({ isActive: false, isDefault: false, updatedAt: new Date() }).where(and(eq(tax.companyId, companyId), inArray(tax.id, matches.map((row) => row.id))));
    }
    return { ...entry, inUse: false };
  }
  const existing = matches.find((row) => row.isActive) ?? matches[0];
  if (existing) {
    if (!existing.isActive) await client.update(tax).set({ isActive: true, updatedAt: new Date() }).where(eq(tax.id, existing.id));
    return { ...entry, inUse: true, taxId: existing.id };
  }
  const [created] = await client
    .insert(tax)
    .values({ companyId, name: entry.name, rate: entry.rate.toFixed(3), kind: entry.kind, operation: entry.operation, isDefault: false, isActive: true })
    .onConflictDoUpdate({ target: [tax.companyId, tax.name], set: { rate: entry.rate.toFixed(3), kind: entry.kind, operation: entry.operation, isActive: true, updatedAt: new Date() } })
    .returning({ id: tax.id });
  return { ...entry, inUse: true, taxId: created?.id };
}
