import { and, count, eq, inArray, isNotNull, notLike, or } from "drizzle-orm";

import { accountChart, company, invoice, tax } from "@/db/schema";
import { getCountryPack } from "@/lib/country-packs";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { taxSignatureKey } from "@/server/taxes/duplicates";

type ChangeCountryInput = {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
  countryCode: string;
};

function templateTaxSignature(entry: { kind?: string; rate: string; operation?: string }) {
  const kind = entry.kind ?? "VAT";
  return taxSignatureKey({ kind, rate: entry.rate, operation: entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD") });
}

/**
 * La empresa adopta el paquete fiscal de su país: moneda y zona horaria por defecto y, si ya tenía
 * plantilla aplicada, los impuestos del nuevo país (los del anterior que no existen en el nuevo se
 * desactivan, no se borran: siguen en los documentos antiguos). Solo se permite mientras la
 * empresa no haya emitido facturas: cambiar de país con facturas emitidas no es una corrección,
 * es otra empresa.
 *
 * Devuelve false si el país no cambia.
 */
export async function changeCompanyCountry(input: ChangeCountryInput, client: DbClient = db): Promise<boolean> {
  const pack = getCountryPack(input.countryCode);
  const [current] = await client.select({ countryCode: company.countryCode }).from(company).where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId))).limit(1);
  if (!current) throw new HttpError(404, "Empresa no encontrada.");
  if (current.countryCode === pack.countryCode) return false;

  const [[issued], [accounts]] = await Promise.all([
    // Emitida = con fecha de emisión o con número definitivo (las antiguas no tienen issuedAt).
    client.select({ total: count() }).from(invoice).where(and(eq(invoice.companyId, input.companyId), or(isNotNull(invoice.issuedAt), notLike(invoice.number, `${DRAFT_NUMBER_PREFIX}%`)))),
    client.select({ total: count() }).from(accountChart).where(eq(accountChart.companyId, input.companyId)),
  ]);
  if (Number(issued?.total ?? 0) > 0) {
    throw new HttpError(409, "La empresa ya tiene facturas emitidas: no se puede cambiar su país. Si operas en otro país, crea otra empresa.");
  }

  await client
    .update(company)
    .set({ countryCode: pack.countryCode, baseCurrencyCode: pack.currency, timezone: pack.timezone, updatedAt: new Date() })
    .where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId)));

  // Sin plantilla aplicada todavía: se aplicará la del nuevo país al terminar la puesta en marcha.
  if (Number(accounts?.total ?? 0) > 0) {
    await applyCompanyTemplate({
      tenantId: input.tenantId,
      companyId: input.companyId,
      activeFiscalYearId: input.fiscalYearId,
      countryCode: pack.countryCode,
      actorUserId: input.actorUserId,
      auditAction: "company.country.template",
      client,
    });
    const wanted = new Set(pack.template.taxes.map(templateTaxSignature));
    const defaultSignature = pack.template.taxes.find((entry) => entry.isDefault);
    const existing = await client.select({ id: tax.id, kind: tax.kind, rate: tax.rate, operation: tax.operation }).from(tax).where(eq(tax.companyId, input.companyId));
    const stale = existing.filter((entry) => !wanted.has(taxSignatureKey(entry))).map((entry) => entry.id);
    if (stale.length > 0) {
      await client.update(tax).set({ isActive: false, isDefault: false, updatedAt: new Date() }).where(and(eq(tax.companyId, input.companyId), inArray(tax.id, stale)));
    }
    if (defaultSignature) {
      const target = existing.find((entry) => taxSignatureKey(entry) === templateTaxSignature(defaultSignature));
      if (target) {
        await client.update(tax).set({ isDefault: false }).where(and(eq(tax.companyId, input.companyId), eq(tax.kind, "VAT")));
        await client.update(tax).set({ isDefault: true, isActive: true, updatedAt: new Date() }).where(eq(tax.id, target.id));
      }
    }
  }

  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "company.country.change",
      entityName: "company",
      entityId: input.companyId,
      payload: { from: current.countryCode, to: pack.countryCode, currency: pack.currency, timezone: pack.timezone, level: pack.level },
    },
    client,
  );
  return true;
}
