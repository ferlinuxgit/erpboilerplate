import { and, eq } from "drizzle-orm";

import { documentSeries } from "@/db/schema";
import { db } from "@/lib/db";

type ReservableSeriesType =
  | "SALES_QUOTE"
  | "SALES_ORDER"
  | "DELIVERY_NOTE"
  | "SALES_INVOICE"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "SUPPLIER_INVOICE"
  | "PAYMENT"
  | "RECEIPT";

export async function reserveSeriesNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { companyId: string; fiscalYearId: string; type: ReservableSeriesType },
) {
  const [series] = await tx
    .select()
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, input.companyId),
        eq(documentSeries.fiscalYearId, input.fiscalYearId),
        eq(documentSeries.type, input.type),
      ),
    )
    .limit(1);

  if (!series) {
    throw new Error(`No existe serie para ${input.type}.`);
  }

  const number = `${series.prefix}${String(series.nextNumber).padStart(6, "0")}`;
  await tx
    .update(documentSeries)
    .set({ nextNumber: series.nextNumber + 1 })
    .where(eq(documentSeries.id, series.id));

  return number;
}
