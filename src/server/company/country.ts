import { and, count, eq, inArray, isNotNull, notLike, or } from "drizzle-orm";

import { accountChart, company, invoice, tax } from "@/db/schema";
import { getCountryPack } from "@/lib/country-packs";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { DRAFT_NUMBER_PREFIX } from "@/server/invoices/lifecycle";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { taxSignatureKey } from "@/server/taxes/duplicates";

type CompanyActor = {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
};

type ChangeCountryInput = CompanyActor & { countryCode: string };

function templateTaxSignature(entry: { kind?: string; rate: string; operation?: string }) {
  const kind = entry.kind ?? "VAT";
  return taxSignatureKey({ kind, rate: entry.rate, operation: entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD") });
}

async function readCompanyAddress(client: DbClient, input: CompanyActor) {
  const [row] = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId)))
    .limit(1);
  if (!row) throw new HttpError(404, "Empresa no encontrada.");
  return row;
}

/** Territorio fiscal actual de la empresa (país o ES-CN / ES-CE / ES-ML). */
export async function currentCompanyTerritory(input: Pick<CompanyActor, "tenantId" | "companyId">, client: DbClient = db) {
  const [row] = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId)))
    .limit(1);
  return taxTerritoryOf(row) ?? "ES";
}

/**
 * Impuestos del territorio: se aplica su plantilla (crea los que faltan) y se ajustan los que ya
 * tenía la empresa. Un impuesto con el mismo tipo se renombra (IVA 4 % → IPSI 4 %); los que no
 * existen en el territorio se desactivan, no se borran (siguen en los documentos antiguos, que
 * guardan su propio nombre y tipo); el impuesto por defecto pasa a ser el general del territorio.
 * Solo si la plantilla ya estaba aplicada: si no, se aplicará la del territorio al terminar la
 * puesta en marcha.
 */
async function adoptTerritoryTaxes(client: DbClient, input: CompanyActor, territory: string, auditAction: string) {
  const [accounts] = await client.select({ total: count() }).from(accountChart).where(eq(accountChart.companyId, input.companyId));
  if (Number(accounts?.total ?? 0) === 0) return;
  const pack = getCountryPack(territory);
  await applyCompanyTemplate({
    tenantId: input.tenantId,
    companyId: input.companyId,
    activeFiscalYearId: input.fiscalYearId,
    countryCode: territory,
    actorUserId: input.actorUserId,
    auditAction,
    client,
  });
  const templateBySignature = new Map(pack.template.taxes.map((entry) => [templateTaxSignature(entry), entry]));
  const existing = await client.select({ id: tax.id, name: tax.name, kind: tax.kind, rate: tax.rate, operation: tax.operation }).from(tax).where(eq(tax.companyId, input.companyId));
  const names = new Set(existing.map((entry) => entry.name));
  const stale: string[] = [];
  for (const entry of existing) {
    const wanted = templateBySignature.get(taxSignatureKey(entry));
    if (!wanted) {
      stale.push(entry.id);
    } else if (wanted.name !== entry.name && !names.has(wanted.name)) {
      await client.update(tax).set({ name: wanted.name, isActive: true, updatedAt: new Date() }).where(eq(tax.id, entry.id));
      names.add(wanted.name);
    } else {
      await client.update(tax).set({ isActive: true, updatedAt: new Date() }).where(eq(tax.id, entry.id));
    }
  }
  if (stale.length > 0) {
    await client.update(tax).set({ isActive: false, isDefault: false, updatedAt: new Date() }).where(and(eq(tax.companyId, input.companyId), inArray(tax.id, stale)));
  }
  await client.update(tax).set({ isDefault: false }).where(and(eq(tax.companyId, input.companyId), eq(tax.kind, "VAT")));
  const defaultTax = pack.template.taxes.find((entry) => entry.isDefault);
  const target = defaultTax ? existing.find((entry) => taxSignatureKey(entry) === templateTaxSignature(defaultTax)) : null;
  if (target) await client.update(tax).set({ isDefault: true, isActive: true, updatedAt: new Date() }).where(eq(tax.id, target.id));
}

/**
 * La empresa adopta el paquete fiscal de su país: moneda y zona horaria por defecto y los
 * impuestos del país (o de su territorio, según su domicilio). Solo se permite mientras la empresa
 * no haya emitido facturas: cambiar de país con facturas emitidas no es una corrección, es otra
 * empresa.
 *
 * Devuelve false si el país no cambia.
 */
export async function changeCompanyCountry(input: ChangeCountryInput, client: DbClient = db): Promise<boolean> {
  const current = await readCompanyAddress(client, input);
  const pack = getCountryPack(input.countryCode);
  if (current.countryCode === pack.countryCode) return false;

  // Emitida = con fecha de emisión o con número definitivo (las antiguas no tienen issuedAt).
  const [issued] = await client.select({ total: count() }).from(invoice).where(and(eq(invoice.companyId, input.companyId), or(isNotNull(invoice.issuedAt), notLike(invoice.number, `${DRAFT_NUMBER_PREFIX}%`))));
  if (Number(issued?.total ?? 0) > 0) {
    throw new HttpError(409, "La empresa ya tiene facturas emitidas: no se puede cambiar su país. Si operas en otro país, crea otra empresa.");
  }

  const territory = taxTerritoryOf({ ...current, countryCode: pack.countryCode }) ?? pack.countryCode;
  const territoryPack = getCountryPack(territory);
  await client
    .update(company)
    .set({ countryCode: pack.countryCode, baseCurrencyCode: territoryPack.currency, timezone: territoryPack.timezone, updatedAt: new Date() })
    .where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId)));
  await adoptTerritoryTaxes(client, input, territory, "company.country.template");

  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "company.country.change",
      entityName: "company",
      entityId: input.companyId,
      payload: { from: current.countryCode, to: pack.countryCode, territory, currency: territoryPack.currency, timezone: territoryPack.timezone, level: pack.level },
    },
    client,
  );
  return true;
}

/**
 * Tras guardar el domicilio fiscal: si el territorio cambia dentro del mismo país (Madrid →
 * Tenerife: IVA → IGIC) la empresa adopta los impuestos del nuevo territorio. A diferencia del
 * cambio de país, se permite con facturas emitidas: es un traslado de domicilio y las facturas
 * anteriores conservan sus impuestos.
 *
 * Devuelve false si el territorio no cambia.
 */
export async function syncCompanyTaxTerritory(input: CompanyActor & { previousTerritory: string }, client: DbClient = db): Promise<boolean> {
  const territory = await currentCompanyTerritory(input, client);
  if (territory === input.previousTerritory) return false;
  await adoptTerritoryTaxes(client, input, territory, "company.territory.template");
  const pack = getCountryPack(territory);
  if (territory === "ES-CN" || input.previousTerritory === "ES-CN") {
    await client.update(company).set({ timezone: pack.timezone, updatedAt: new Date() }).where(and(eq(company.id, input.companyId), eq(company.tenantId, input.tenantId)));
  }
  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: "company.territory.change",
      entityName: "company",
      entityId: input.companyId,
      payload: { from: input.previousTerritory, to: territory, tax: pack.taxLabel },
    },
    client,
  );
  return true;
}
