import { and, eq } from "drizzle-orm";

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
  const seriesRows = await tx
    .select()
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, input.companyId),
        eq(documentSeries.type, input.type),
      ),
    )
    .orderBy(documentSeries.id)
    .for("update");

  const series = seriesRows.find((candidate) => candidate.fiscalYearId === input.fiscalYearId);

  if (!series) {
    throw new Error(`No existe serie para ${input.type}.`);
  }

  const nextNumber = Math.max(...seriesRows.map((candidate) => candidate.nextNumber));
  const [reserved] = await tx
    .update(documentSeries)
    .set({ nextNumber: nextNumber + 1 })
    .where(eq(documentSeries.id, series.id))
    .returning({ format: documentSeries.format, prefix: documentSeries.prefix });

  if (!reserved) {
    throw new Error(`No se pudo reservar serie para ${input.type}.`);
  }

  return formatSeriesNumber({
    format: reserved.format,
    nextNumber,
    prefix: reserved.prefix,
    referenceDate: input.referenceDate,
  });
}
