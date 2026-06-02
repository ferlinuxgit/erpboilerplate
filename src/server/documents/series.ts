import { and, eq, sql } from "drizzle-orm";

import { documentSeries } from "@/db/schema";
import { db } from "@/lib/db";
import { formatSeriesNumber } from "@/lib/document-series-format";

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
  input: { companyId: string; fiscalYearId: string; type: ReservableSeriesType; referenceDate?: Date | string | null },
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

  const [reserved] = await tx
    .update(documentSeries)
    .set({ nextNumber: sql<number>`${documentSeries.nextNumber} + 1` })
    .where(eq(documentSeries.id, series.id))
    .returning({ format: documentSeries.format, prefix: documentSeries.prefix, nextNumber: documentSeries.nextNumber });

  if (!reserved) {
    throw new Error(`No se pudo reservar serie para ${input.type}.`);
  }

  return formatSeriesNumber({
    format: reserved.format,
    nextNumber: reserved.nextNumber - 1,
    prefix: reserved.prefix,
    referenceDate: input.referenceDate,
  });
}
