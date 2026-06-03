import { and, eq } from "drizzle-orm";

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

    for (const entry of input.template.accounts) {
      const existing = await tx
        .select({ id: accountChart.id })
        .from(accountChart)
        .where(and(eq(accountChart.companyId, input.companyId), eq(accountChart.code, entry.code)))
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(accountChart).values({
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
        });
      }
    }

    for (const entry of input.template.taxes) {
      const existing = await tx
        .select({ id: tax.id })
        .from(tax)
        .where(and(eq(tax.companyId, input.companyId), eq(tax.name, entry.name)))
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(tax).values({
          companyId: input.companyId,
          name: entry.name,
          rate: entry.rate,
        });
      }
    }

    for (const entry of input.template.journals) {
      const existing = await tx
        .select({ id: journal.id })
        .from(journal)
        .where(and(eq(journal.companyId, input.companyId), eq(journal.code, entry.code)))
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(journal).values({
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
        });
      }
    }

    for (const entry of input.template.documentSeries) {
      const existing = await tx
        .select({ id: documentSeries.id })
        .from(documentSeries)
        .where(
          and(
            eq(documentSeries.companyId, input.companyId),
            eq(documentSeries.fiscalYearId, input.activeFiscalYearId),
            eq(documentSeries.type, entry.type),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(documentSeries).values({
          companyId: input.companyId,
          fiscalYearId: input.activeFiscalYearId,
          type: entry.type,
          prefix: entry.prefix,
          nextNumber: entry.nextNumber,
        });
      }
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
