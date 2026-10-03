import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { company, invoiceLineTax, item, tax } from "@/db/schema";
import type { DbClient } from "@/lib/db";

/**
 * Impuestos duplicados: dos impuestos activos con el mismo tipo (IVA, recargo, retención…),
 * porcentaje y operación son el mismo impuesto con distinto nombre («IVA» e «IVA general 21%»).
 * Las facturas guardan copia del nombre y el porcentaje de cada impuesto, así que fusionarlos
 * no cambia ninguna factura emitida: solo deja un impuesto por tipo para las facturas nuevas.
 */

export type TaxSignature = { kind: string; rate: string | number; operation: string };

function rateKey(rate: string | number) {
  return Number(rate).toFixed(3);
}

export function taxSignatureKey(value: TaxSignature) {
  return `${value.kind.toUpperCase()}|${rateKey(value.rate)}|${value.operation.toUpperCase()}`;
}

/** Impuesto activo de la empresa equivalente a `value` (mismo tipo, porcentaje y operación), si existe. */
export async function findEquivalentTax(client: DbClient, companyId: string, value: TaxSignature, excludeId?: string) {
  const [row] = await client
    .select({ id: tax.id, name: tax.name })
    .from(tax)
    .where(and(
      eq(tax.companyId, companyId),
      eq(tax.isActive, true),
      eq(tax.kind, value.kind.toUpperCase()),
      eq(tax.operation, value.operation.toUpperCase()),
      sql`${tax.rate} = ${rateKey(value.rate)}::numeric`,
      excludeId ? ne(tax.id, excludeId) : undefined,
    ))
    .limit(1);
  return row ?? null;
}

/** Nombres con la ortografía correcta (los impuestos sembrados antes no llevaban tilde). */
export function normalizeTaxName(name: string) {
  return name.replace(/\bRetencion\b/g, "Retención").replace(/\bretencion\b/g, "retención");
}

/**
 * «IVA general 21%» describe mejor que «IVA»: se prefiere un nombre con el porcentaje y, entre
 * ellos, el más largo («Retención IRPF 15%» mejor que «IRPF 15%»).
 */
export function preferredTaxName(names: string[], rate: string | number) {
  const digits = String(Number(rate)).replace(".", ",");
  const withRate = names.filter((name) => name.includes(`${digits}%`) || name.includes(`${digits} %`));
  return [...withRate].sort((left, right) => right.length - left.length)[0] ?? names[0];
}

export type TaxMerge = {
  kept: { id: string; name: string; finalName: string };
  merged: Array<{ id: string; name: string; invoiceLines: number; items: number }>;
};

export type TaxDedupeReport = { companyId: string; companyName: string; merges: TaxMerge[]; renamed: Array<{ from: string; to: string }> };

/**
 * Fusiona los impuestos activos equivalentes de una empresa. Se queda el predeterminado (o el más
 * usado, o el más antiguo) con el nombre más descriptivo; las líneas de factura y los artículos de
 * los demás pasan a él y los demás se borran. Corrige además «Retencion» → «Retención».
 */
export async function dedupeCompanyTaxes(client: DbClient, companyId: string): Promise<TaxDedupeReport> {
  const [owner] = await client.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1);
  const rows = await client
    .select({
      id: tax.id,
      name: tax.name,
      rate: tax.rate,
      kind: tax.kind,
      operation: tax.operation,
      isDefault: tax.isDefault,
      createdAt: tax.createdAt,
      // Columnas cualificadas: en una subconsulta correlacionada drizzle no antepone la tabla.
      usage: sql<number>`(select count(*)::int from "invoice_line_tax" as usage_lines where usage_lines."taxId" = "tax"."id")`,
    })
    .from(tax)
    .where(and(eq(tax.companyId, companyId), eq(tax.isActive, true)))
    .orderBy(asc(tax.createdAt));

  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(taxSignatureKey(row), [...(groups.get(taxSignatureKey(row)) ?? []), row]);

  const report: TaxDedupeReport = { companyId, companyName: owner?.name ?? companyId, merges: [], renamed: [] };
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [kept, ...others] = [...group].sort((left, right) =>
      Number(right.isDefault) - Number(left.isDefault) || right.usage - left.usage || left.createdAt.getTime() - right.createdAt.getTime());
    const finalName = normalizeTaxName(preferredTaxName(group.map((row) => row.name), kept.rate));
    const otherIds = others.map((row) => row.id);
    const merged = [];
    for (const other of others) {
      const [items] = await client.select({ count: sql<number>`count(*)::int` }).from(item).where(eq(item.defaultTaxId, other.id));
      merged.push({ id: other.id, name: other.name, invoiceLines: other.usage, items: items?.count ?? 0 });
    }
    await client.update(invoiceLineTax).set({ taxId: kept.id }).where(inArray(invoiceLineTax.taxId, otherIds));
    await client.update(item).set({ defaultTaxId: kept.id }).where(inArray(item.defaultTaxId, otherIds));
    await client.delete(tax).where(and(eq(tax.companyId, companyId), inArray(tax.id, otherIds)));
    if (finalName !== kept.name) await client.update(tax).set({ name: finalName, updatedAt: new Date() }).where(eq(tax.id, kept.id));
    report.merges.push({ kept: { id: kept.id, name: kept.name, finalName }, merged });
  }

  // Ortografía del resto de impuestos (sin duplicados).
  const mergedKeptIds = new Set(report.merges.map((merge) => merge.kept.id));
  for (const row of await client.select({ id: tax.id, name: tax.name }).from(tax).where(eq(tax.companyId, companyId))) {
    const fixed = normalizeTaxName(row.name);
    if (fixed === row.name || mergedKeptIds.has(row.id)) continue;
    const [clash] = await client.select({ id: tax.id }).from(tax).where(and(eq(tax.companyId, companyId), eq(tax.name, fixed))).limit(1);
    if (clash) continue;
    await client.update(tax).set({ name: fixed, updatedAt: new Date() }).where(eq(tax.id, row.id));
    report.renamed.push({ from: row.name, to: fixed });
  }
  return report;
}

export function formatTaxDedupeReport(report: TaxDedupeReport, applied: boolean) {
  const out = [`== ${report.companyName} · ${applied ? "APLICADO" : "ENSAYO (sin cambios)"}`];
  if (report.merges.length === 0) out.push("  · Sin impuestos duplicados.");
  for (const merge of report.merges) {
    out.push(`  + Se queda «${merge.kept.finalName}»${merge.kept.finalName !== merge.kept.name ? ` (antes «${merge.kept.name}»)` : ""}`);
    for (const other of merge.merged) out.push(`    - fusiona «${other.name}»: ${other.invoiceLines} líneas de factura, ${other.items} artículos`);
  }
  for (const rename of report.renamed) out.push(`  ~ «${rename.from}» → «${rename.to}»`);
  return out.join("\n");
}
