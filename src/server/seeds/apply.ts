import { and, eq } from "drizzle-orm";

import pgcPyme from "@/server/seeds/es/pgc-pyme.json";
import taxesEs from "@/server/seeds/es/taxes-es.json";
import documentSeriesEs from "@/server/seeds/es/document-series-es.json";
import journalsEs from "@/server/seeds/es/journals-es.json";
import { accountChart, company, documentSeries, fiscalYear, journal, tax } from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";

type ApplyEsSeedsInput = {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  legalName?: string;
  vatNumber?: string;
};

type AccountSeed = {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
};

type SeriesSeed = {
  type:
    | "SALES_QUOTE"
    | "SALES_ORDER"
    | "DELIVERY_NOTE"
    | "SALES_INVOICE"
    | "CREDIT_NOTE"
    | "PURCHASE_ORDER"
    | "GOODS_RECEIPT"
    | "SUPPLIER_INVOICE"
    | "SUPPLIER_CREDIT_NOTE"
    | "PAYMENT"
    | "RECEIPT";
  prefix: string;
  nextNumber: number;
};

export async function applyEsSeeds(input: ApplyEsSeedsInput) {
  const [activeFiscalYear] = await db
    .select({
      id: fiscalYear.id,
    })
    .from(fiscalYear)
    .where(eq(fiscalYear.companyId, input.companyId))
    .limit(1);

  if (!activeFiscalYear) {
    throw new Error("No existe un ejercicio fiscal activo para aplicar los seeds.");
  }

  await db.transaction(async (tx) => {
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

    for (const entry of pgcPyme as AccountSeed[]) {
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

    for (const entry of taxesEs) {
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

    for (const entry of journalsEs) {
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

    for (const entry of documentSeriesEs as SeriesSeed[]) {
      const existing = await tx
        .select({ id: documentSeries.id })
        .from(documentSeries)
        .where(
          and(
            eq(documentSeries.companyId, input.companyId),
            eq(documentSeries.fiscalYearId, activeFiscalYear.id),
            eq(documentSeries.type, entry.type),
            eq(documentSeries.prefix, entry.prefix),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(documentSeries).values({
          companyId: input.companyId,
          fiscalYearId: activeFiscalYear.id,
          type: entry.type,
          prefix: entry.prefix,
          nextNumber: entry.nextNumber,
        });
      }
    }
  });

  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "onboarding.seed.apply",
    entityName: "company",
    entityId: input.companyId,
    payload: { legalName: input.legalName, vatNumber: input.vatNumber },
  });
}
