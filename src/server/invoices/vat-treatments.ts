import { eq } from "drizzle-orm";

import { companySettings } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyFiscalContext } from "@/server/company/fiscal-context";
import { companySalesVatTreatments, orderTreatments } from "@/server/invoices/vat-treatments-model";

/** Tratamientos de IVA de las ventas de la empresa y si son los automáticos o una elección suya. */
export async function getCompanySalesVatTreatments(companyId: string, client: DbClient = db) {
  const [[row], fiscal] = await Promise.all([
    client.select({ saved: companySettings.salesVatTreatments }).from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1),
    getCompanyFiscalContext(companyId, client),
  ]);
  const saved = row?.saved ?? null;
  return {
    enabled: companySalesVatTreatments(saved, fiscal),
    automatic: !saved || saved.length === 0,
  };
}

/** Guarda la elección (siempre con el nacional); `null` vuelve a los automáticos. */
export async function saveCompanySalesVatTreatments(companyId: string, values: readonly string[] | null, client: DbClient = db) {
  const next = values === null ? null : orderTreatments(values);
  await client
    .insert(companySettings)
    .values({ companyId, salesVatTreatments: next })
    .onConflictDoUpdate({ target: companySettings.companyId, set: { salesVatTreatments: next, updatedAt: new Date() } });
  return getCompanySalesVatTreatments(companyId, client);
}
