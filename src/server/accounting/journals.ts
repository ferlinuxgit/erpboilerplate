import { and, eq } from "drizzle-orm";

import { journal } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import esJournals from "@/server/seeds/es/journals-es.json";

/** Diarios del PGC: ventas, compras, bancos, general y cierre. */
export type JournalCode = "VEN" | "COM" | "BAN" | "GEN" | "CIE";

const JOURNAL_NAMES = new Map<string, string>((esJournals as Array<{ code: string; name: string }>).map((entry) => [entry.code, entry.name]));

const SOURCE_JOURNALS: Record<string, JournalCode> = {
  invoice: "VEN",
  supplierInvoice: "COM",
  payment: "BAN",
  supplierPayment: "BAN",
  bankTransaction: "BAN",
  bankTransactionAssignment: "BAN",
  fiscalYearRegularization: "CIE",
  fiscalYearClosing: "CIE",
  fiscalYearOpening: "CIE",
};

/** Diario de un asiento según su origen (función pura). Manuales y reversiones manuales → GEN. */
export function journalCodeForSource(sourceType: string | null | undefined): JournalCode {
  return (sourceType && SOURCE_JOURNALS[sourceType]) || "GEN";
}

const journalByTransaction = new WeakMap<object, Map<string, Promise<{ id: string; code: string }>>>();

async function findOrCreateJournal(client: DbClient, companyId: string, code: JournalCode) {
  const lookup = () =>
    client
      .select({ id: journal.id, code: journal.code })
      .from(journal)
      .where(and(eq(journal.companyId, companyId), eq(journal.code, code)))
      .limit(1);
  const [existing] = await lookup();
  if (existing) return existing;
  await client.insert(journal).values({ companyId, code, name: JOURNAL_NAMES.get(code) ?? code }).onConflictDoNothing();
  const [created] = await lookup();
  if (!created) throw new Error(`No se pudo crear el diario ${code}.`);
  return created;
}

/** Diario `code` de la empresa; lo crea (con el nombre del PGC) si falta. Memoizado por transacción. */
export async function ensureJournal(companyId: string, code: JournalCode, client: DbClient = db) {
  if (client === db) return findOrCreateJournal(client, companyId, code);
  let byKey = journalByTransaction.get(client);
  if (!byKey) {
    byKey = new Map();
    journalByTransaction.set(client, byKey);
  }
  const key = `${companyId}:${code}`;
  let pending = byKey.get(key);
  if (!pending) {
    pending = findOrCreateJournal(client, companyId, code);
    byKey.set(key, pending);
    const memo = byKey;
    pending.catch(() => memo.delete(key));
  }
  return pending;
}
