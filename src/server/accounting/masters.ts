import { and, eq, inArray } from "drizzle-orm";

import { accountChart, journal } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getCompanyTemplate, type CompanyTemplate } from "@/lib/company-templates";
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

function catalogForTemplate(template?: CompanyTemplate | null) {
  if (template === null) {
    return {
      accounts: [],
      journals: [],
    };
  }

  return {
    accounts: template?.accounts ?? defaultAccountingAccounts,
    journals: template?.journals ?? defaultAccountingJournals,
  };
}

export async function getAccountingMasterStatus(
  companyId: string,
  client: DbClient = db,
  template?: CompanyTemplate | null,
): Promise<AccountingMasterStatus> {
  const catalog = catalogForTemplate(template);
  const accountCodes = catalog.accounts.map((account) => account.code);
  const journalCodes = catalog.journals.map((entry) => entry.code);
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
    missingAccounts: catalog.accounts.filter((account) => !existingAccountCodes.has(account.code)).map((account) => ({ ...account })),
    missingJournals: catalog.journals.filter((entry) => !existingJournalCodes.has(entry.code)).map((entry) => ({ ...entry })),
  };
}

export async function ensureAccountingMasters(
  companyId: string,
  input: { accounts?: AccountingMasterAccount[]; journals?: AccountingMasterJournal[] },
  template?: CompanyTemplate | null,
) {
  const catalog = catalogForTemplate(template ?? getCompanyTemplate("ES"));
  const accounts = input.accounts?.length ? input.accounts : catalog.accounts;
  const journals = input.journals?.length ? input.journals : catalog.journals;

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

    return getAccountingMasterStatus(companyId, tx, template);
  });
}
