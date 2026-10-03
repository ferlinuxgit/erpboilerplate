import { eq, sql } from "drizzle-orm";

import { accountChart, company, companySettings, documentSeries, fiscalYear, journal, tax } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate, type CompanyTemplate, type CompanyTemplateAccount } from "@/lib/company-templates";
import { canonicalSubaccountCode, natureForAccountType, normalizeSubaccountLength } from "@/server/accounting/subaccounts-model";
import { recordAudit } from "@/server/audit";
import { normalizeTaxName, taxSignatureKey } from "@/server/taxes/duplicates";

type ApplyEsSeedsInput = {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  activeFiscalYearId?: string;
  auditAction?: string;
  client?: DbClient;
  legalName?: string;
  vatNumber?: string;
};

type ApplyCompanyTemplateInput = ApplyEsSeedsInput & {
  countryCode: string;
};

export async function applyCompanyTemplate(input: ApplyCompanyTemplateInput) {
  const template = getCompanyTemplate(input.countryCode);
  if (!template) {
    throw new Error("No hay una plantilla automatica disponible para este pais.");
  }

  const client = input.client ?? db;
  const activeFiscalYear = input.activeFiscalYearId
    ? { id: input.activeFiscalYearId }
    : (
        await client
          .select({
            id: fiscalYear.id,
          })
          .from(fiscalYear)
          .where(eq(fiscalYear.companyId, input.companyId))
          .limit(1)
      )[0];

  if (!activeFiscalYear) {
    throw new Error("No existe un ejercicio fiscal activo para aplicar los seeds.");
  }

  const applySeedRows = async (tx: DbClient) => {
    await applyTemplateRows(tx, {
      ...input,
      activeFiscalYearId: activeFiscalYear.id,
      template,
    });
  };

  if (input.client) {
    await applySeedRows(input.client);
    return;
  }

  await db.transaction(applySeedRows);
}

async function applyTemplateRows(
  tx: DbClient,
  input: ApplyCompanyTemplateInput & {
    activeFiscalYearId: string;
    template: CompanyTemplate;
  },
) {
    if (input.legalName || input.vatNumber) {
      await tx
        .update(company)
        .set({
          legalName: input.legalName?.trim() || null,
          vatNumber: input.vatNumber?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(company.id, input.companyId));
    }

    const existingSettings = await tx
      .select({ id: companySettings.id })
      .from(companySettings)
      .where(eq(companySettings.companyId, input.companyId))
      .limit(1);

    if (existingSettings.length === 0) {
      await tx.insert(companySettings).values({
        companyId: input.companyId,
        fiscalRegime: input.template.settings.fiscalRegime,
        taxPeriodicity: input.template.settings.taxPeriodicity,
        defaultCustomerAccountCode: input.template.settings.defaultCustomerAccountCode,
        defaultSupplierAccountCode: input.template.settings.defaultSupplierAccountCode,
        defaultSalesAccountCode: input.template.settings.defaultSalesAccountCode,
        defaultPurchaseAccountCode: input.template.settings.defaultPurchaseAccountCode,
        defaultBankAccountCode: input.template.settings.defaultBankAccountCode,
      });
    }

    if (input.template.accounts.length > 0) {
      const [lengthRow] = await tx
        .select({ subaccountLength: companySettings.subaccountLength })
        .from(companySettings)
        .where(eq(companySettings.companyId, input.companyId))
        .limit(1);
      const plan = buildTemplateChart(input.template.accounts, normalizeSubaccountLength(lengthRow?.subaccountLength));
      // Cuentas del PGC (1–4 dígitos): siempre de agrupación, sin apuntes.
      await tx.insert(accountChart).values(
        plan.groups.map((entry) => ({
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
          parentCode: entry.parentCode ?? null,
          level: entry.level ?? entry.code.length,
          isPostable: false,
          isActive: entry.isActive ?? false,
          source: entry.source ?? input.template.id,
          templateVersion: entry.templateVersion ?? null,
          nature: natureForAccountType(entry.type),
        })),
      ).onConflictDoUpdate({
        target: [accountChart.companyId, accountChart.code],
        set: {
          name: sql`excluded."name"`,
          type: sql`excluded."type"`,
          parentCode: sql`excluded."parentCode"`,
          level: sql`excluded."level"`,
          isPostable: sql`excluded."isPostable"`,
          source: sql`excluded."source"`,
          templateVersion: sql`excluded."templateVersion"`,
        },
      });
      // Subcuenta canónica de cada cuenta de último nivel (477 → 47700000): son las que admiten apuntes.
      if (plan.subaccounts.length > 0) {
        await tx.insert(accountChart).values(
          plan.subaccounts.map((entry) => ({
            companyId: input.companyId,
            code: entry.code,
            name: entry.name,
            type: entry.type,
            parentCode: entry.parentCode,
            level: entry.code.length,
            isPostable: true,
            isActive: entry.isActive,
            source: entry.source,
            templateVersion: entry.templateVersion,
            nature: natureForAccountType(entry.type),
          })),
        ).onConflictDoNothing();
      }
    }

    // Un impuesto que la empresa ya tiene con otro nombre («IVA», «IRPF 15%») no se vuelve a crear:
    // dos impuestos con el mismo tipo y porcentaje son el mismo impuesto duplicado.
    const existingTaxes = await tx.select({ name: tax.name, kind: tax.kind, rate: tax.rate, operation: tax.operation }).from(tax).where(eq(tax.companyId, input.companyId));
    // Nombres antiguos sin tilde («Retencion IRPF 15%»): la plantilla los sigue reconociendo para
    // corregirles el tipo y la operación al reaplicarla.
    const legacyNameFor = new Map(existingTaxes.map((entry) => [normalizeTaxName(entry.name), entry.name]));
    const existingNames = new Set(existingTaxes.map((entry) => entry.name));
    const existingSignatures = new Set(existingTaxes.map((entry) => taxSignatureKey(entry)));
    const templateTaxes = input.template.taxes.map((entry) => ({ ...entry, name: existingNames.has(entry.name) ? entry.name : legacyNameFor.get(entry.name) ?? entry.name })).filter((entry) => {
      const kind = entry.kind ?? "VAT";
      const operation = entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD");
      return existingNames.has(entry.name) || !existingSignatures.has(taxSignatureKey({ kind, rate: entry.rate, operation }));
    });
    if (templateTaxes.length > 0) {
      // Tipo y operación también se corrigen en impuestos ya creados (retenciones antiguas guardadas
      // como IVA que sumaban en vez de restar). `isDefault` solo al crear: respeta la elección del usuario.
      await tx.insert(tax).values(templateTaxes.map((entry) => ({
          companyId: input.companyId,
          name: entry.name,
          rate: entry.rate,
          kind: entry.kind ?? "VAT",
          operation: entry.operation ?? (entry.kind === "WITHHOLDING" ? "SUBTRACT" : "ADD"),
          isDefault: entry.isDefault ?? false,
      }))).onConflictDoUpdate({
        target: [tax.companyId, tax.name],
        set: { rate: sql`excluded."rate"`, kind: sql`excluded."kind"`, operation: sql`excluded."operation"`, updatedAt: new Date() },
      });
    }

    if (input.template.journals.length > 0) {
      await tx.insert(journal).values(input.template.journals.map((entry) => ({
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
      }))).onConflictDoUpdate({ target: [journal.companyId, journal.code], set: { name: sql`excluded."name"` } });
    }

    if (input.template.documentSeries.length > 0) {
      await tx.insert(documentSeries).values(input.template.documentSeries.map((entry) => ({
          companyId: input.companyId,
          fiscalYearId: input.activeFiscalYearId,
          type: entry.type,
          prefix: entry.prefix,
          nextNumber: entry.nextNumber,
      }))).onConflictDoNothing();
    }

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: input.auditAction ?? "onboarding.seed.apply",
        entityName: "company",
        entityId: input.companyId,
        payload: {
          legalName: input.legalName,
          vatNumber: input.vatNumber,
          countryCode: input.countryCode,
          templateId: input.template.id,
        },
      },
      tx,
    );
}

export async function applyEsSeeds(input: ApplyEsSeedsInput) {
  return applyCompanyTemplate({ ...input, countryCode: "ES" });
}

/**
 * Plan contable de una plantilla (función pura): las cuentas del PGC quedan como cuentas de grupo y
 * cada cuenta de último nivel (las que la plantilla marca como imputables) recibe su subcuenta
 * canónica de `subaccountLength` dígitos con el mismo nombre.
 */
export function buildTemplateChart(accounts: readonly CompanyTemplateAccount[], subaccountLength: number) {
  const groups = accounts.filter((entry) => entry.code.length < subaccountLength);
  const seen = new Set<string>();
  const subaccounts: Array<{
    code: string;
    name: string;
    type: CompanyTemplateAccount["type"];
    parentCode: string;
    isActive: boolean;
    source: string;
    templateVersion: string | null;
  }> = [];
  for (const entry of groups) {
    if (entry.isPostable === false) continue;
    const code = canonicalSubaccountCode(entry.code, subaccountLength);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    subaccounts.push({
      code,
      name: entry.name,
      type: entry.type,
      parentCode: entry.code,
      isActive: entry.isActive ?? false,
      source: entry.source ?? "template",
      templateVersion: entry.templateVersion ?? null,
    });
  }
  return { groups, subaccounts };
}
