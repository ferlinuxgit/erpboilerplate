import { desc, eq, sql } from "drizzle-orm";

import { ocrCreditLedger } from "@/db/schema";
import { creditsForUsage, ocrUsageCostMicroUsd, type OcrUsage } from "@/lib/billing/catalog";
import { db, type DbClient } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { billingEnforced } from "@/server/billing/access";

/** Saldo de créditos de lectura de facturas del espacio. */
export async function getOcrCreditBalance(tenantId: string, client: DbClient = db) {
  const [row] = await client.select({ balance: sql<number>`coalesce(sum(${ocrCreditLedger.delta}), 0)::int` }).from(ocrCreditLedger).where(eq(ocrCreditLedger.tenantId, tenantId));
  return Number(row?.balance ?? 0);
}

export async function listOcrCreditMovements(tenantId: string, limit = 20) {
  return db
    .select({ id: ocrCreditLedger.id, kind: ocrCreditLedger.kind, delta: ocrCreditLedger.delta, description: ocrCreditLedger.description, createdAt: ocrCreditLedger.createdAt })
    .from(ocrCreditLedger)
    .where(eq(ocrCreditLedger.tenantId, tenantId))
    .orderBy(desc(ocrCreditLedger.createdAt))
    .limit(limit);
}

/** Antes de encolar lecturas: hay saldo para al menos `count` facturas (1 crédito cada una). */
export async function assertOcrCreditsAvailable(tenantId: string, count = 1, client: DbClient = db) {
  if (!billingEnforced()) return;
  const balance = await getOcrCreditBalance(tenantId, client);
  if (balance < count) {
    throw new HttpError(402, balance <= 0
      ? "No te quedan créditos para leer facturas con IA. Compra un pack en Facturación."
      : `Te quedan ${balance} créditos de lectura y has subido ${count} facturas. Compra un pack en Facturación o sube menos a la vez.`);
  }
}

/**
 * Descuenta una lectura hecha con su coste real (tokens de la API). Una lectura por trabajo: si se
 * reintenta, no se cobra dos veces. Se registra siempre (también sin cobro activo) para conocer el
 * coste real de la API por cliente.
 */
export async function chargeOcrUsage(input: { tenantId: string; companyId: string; ocrJobId: string; fileName: string; usage: OcrUsage }, client: DbClient = db) {
  const credits = creditsForUsage(input.usage);
  await client
    .insert(ocrCreditLedger)
    .values({
      tenantId: input.tenantId,
      companyId: input.companyId,
      kind: "USAGE",
      delta: billingEnforced() ? -credits : 0,
      description: `Lectura de «${input.fileName.slice(0, 120)}»`,
      ocrJobId: input.ocrJobId,
      model: input.usage.model,
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens ?? 0,
      outputTokens: input.usage.outputTokens,
      costMicroUsd: ocrUsageCostMicroUsd(input.usage),
    })
    .onConflictDoNothing();
  return credits;
}
