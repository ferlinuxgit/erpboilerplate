import { eq, sql } from "drizzle-orm";

import { accountChart, company, companySettings, documentSeries, fiscalYear, journal, tax } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate, type CompanyTemplate } from "@/lib/company-templates";
import { recordAudit } from "@/server/audit";

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
      await tx.insert(accountChart).values(
        input.template.accounts.map((entry) => ({
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
          parentCode: entry.parentCode ?? null,
          level: entry.level ?? entry.code.length,
          isPostable: entry.isPostable ?? true,
          isActive: entry.isActive ?? false,
          source: entry.source ?? input.template.id,
          templateVersion: entry.templateVersion ?? null,
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
    }

    if (input.template.taxes.length > 0) {
      await tx.insert(tax).values(input.template.taxes.map((entry) => ({
          companyId: input.companyId,
          name: entry.name,
          rate: entry.rate,
      }))).onConflictDoUpdate({ target: [tax.companyId, tax.name], set: { rate: sql`excluded."rate"` } });
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
