import { and, eq, inArray } from "drizzle-orm";

import { accountChart, journal } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import {
  defaultAccountingAccounts,
  defaultAccountingJournals,
  type AccountingMasterAccount,
  type AccountingMasterJournal,
} from "@/lib/accounting-masters";

export type AccountingMasterStatus = {
  missingAccounts: AccountingMasterAccount[];
  missingJournals: AccountingMasterJournal[];
};

export async function getAccountingMasterStatus(companyId: string, client: DbClient = db): Promise<AccountingMasterStatus> {
  const accountCodes = defaultAccountingAccounts.map((account) => account.code);
  const journalCodes = defaultAccountingJournals.map((entry) => entry.code);
  const [existingAccounts, existingJournals] = await Promise.all([
    client
      .select({ code: accountChart.code })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.code, accountCodes))),
    client
      .select({ code: journal.code })
      .from(journal)
      .where(and(eq(journal.companyId, companyId), inArray(journal.code, journalCodes))),
  ]);
  const existingAccountCodes = new Set(existingAccounts.map((account) => account.code));
  const existingJournalCodes = new Set(existingJournals.map((entry) => entry.code));

  return {
    missingAccounts: defaultAccountingAccounts.filter((account) => !existingAccountCodes.has(account.code)).map((account) => ({ ...account })),
    missingJournals: defaultAccountingJournals.filter((entry) => !existingJournalCodes.has(entry.code)).map((entry) => ({ ...entry })),
  };
}

export async function ensureAccountingMasters(
  companyId: string,
  input: { accounts?: AccountingMasterAccount[]; journals?: AccountingMasterJournal[] },
) {
  const accounts = input.accounts?.length ? input.accounts : defaultAccountingAccounts;
  const journals = input.journals?.length ? input.journals : defaultAccountingJournals;

  return db.transaction(async (tx) => {
    for (const account of accounts) {
      const existing = await tx
        .select({ id: accountChart.id })
        .from(accountChart)
        .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, account.code)))
        .limit(1);
      if (existing.length > 0) continue;

      await tx.insert(accountChart).values({
        companyId,
        code: account.code.trim(),
        name: account.name.trim(),
        type: account.type,
      });
    }

    for (const entry of journals) {
      const existing = await tx
        .select({ id: journal.id })
        .from(journal)
        .where(and(eq(journal.companyId, companyId), eq(journal.code, entry.code)))
        .limit(1);
      if (existing.length > 0) continue;

      await tx.insert(journal).values({
        companyId,
        code: entry.code.trim(),
        name: entry.name.trim(),
      });
    }

    return getAccountingMasterStatus(companyId, tx);
  });
}
