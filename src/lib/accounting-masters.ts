import { getCompanyTemplate, type TemplateAccountType } from "@/lib/company-templates";

const esTemplate = getCompanyTemplate("ES");

export const defaultAccountingAccounts = esTemplate?.accounts ?? [];
export const defaultAccountingJournals = esTemplate?.journals ?? [];

export type AccountingAccountType = TemplateAccountType;
export type AccountingMasterAccount = { code: string; name: string; type: AccountingAccountType; role?: string };
export type AccountingMasterJournal = { code: string; name: string; role?: string };
