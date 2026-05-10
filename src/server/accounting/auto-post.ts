import { and, eq, gte, ilike, lte, sql } from "drizzle-orm";

import { accountChart, companySettings, fiscalYear, journalEntry, journalLine } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { ensureDefaultJournal } from "@/server/accounting/service";
import { recordAudit } from "@/server/audit";

type PostingInput = {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  postedAt: Date;
  reference: string;
  dbClient?: DbClient;
};

type AccountsMap = {
  customer: string;
  supplier: string;
  sales: string;
  purchase: string;
  bank: string;
  vatOutput: string;
  vatInput: string;
  retention: string;
};

async function resolveAccountId(client: DbClient, companyId: string, code: string) {
  const [account] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code)))
    .limit(1);
  if (!account) {
    throw new Error(`No existe la cuenta contable ${code}.`);
  }
  return account.id;
}

async function resolveAccounts(companyId: string, client: DbClient = db): Promise<AccountsMap> {
  const [settings] = await client
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  const defaults = {
    customer: settings?.defaultCustomerAccountCode ?? "430000",
    supplier: settings?.defaultSupplierAccountCode ?? "410000",
    sales: settings?.defaultSalesAccountCode ?? "700000",
    purchase: settings?.defaultPurchaseAccountCode ?? "600000",
    bank: settings?.defaultBankAccountCode ?? "572000",
    vatOutput: "477000",
    vatInput: "472000",
    retention: "475100",
  };

  return {
    customer: await resolveAccountId(client, companyId, defaults.customer),
    supplier: await resolveAccountId(client, companyId, defaults.supplier),
    sales: await resolveAccountId(client, companyId, defaults.sales),
    purchase: await resolveAccountId(client, companyId, defaults.purchase),
    bank: await resolveAccountId(client, companyId, defaults.bank),
    vatOutput: await resolveAccountId(client, companyId, defaults.vatOutput),
    vatInput: await resolveAccountId(client, companyId, defaults.vatInput),
    retention: await resolveAccountId(client, companyId, defaults.retention),
  };
}

async function createEntry(
  input: PostingInput & {
    lines: Array<{ accountId: string; debit: string; credit: string }>;
    action: string;
    entityName: string;
    entityId: string;
  },
) {
  const client = input.dbClient ?? db;
  const defaultJournal = await ensureDefaultJournal(input.companyId, client);
  const [createdEntry] = await client
    .insert(journalEntry)
    .values({
      companyId: input.companyId,
      journalId: defaultJournal.id,
      postedAt: input.postedAt,
      reference: input.reference,
    })
    .returning({ id: journalEntry.id });

  await client.insert(journalLine).values(
    input.lines.map((line) => ({
      journalEntryId: createdEntry.id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
    })),
  );

  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityName: input.entityName,
      entityId: input.entityId,
      payload: { journalEntryId: createdEntry.id, reference: input.reference },
    },
    client,
  );
}

export async function postSalesInvoice(
  input: PostingInput & { invoiceId: string; subtotal: number; taxAmount: number; totalAmount: number; retentionAmount?: number },
) {
  const accounts = await resolveAccounts(input.companyId, input.dbClient ?? db);
  const retentionAmount = input.retentionAmount && input.retentionAmount > 0 ? input.retentionAmount : 0;
  const lines = [
    { accountId: accounts.customer, debit: input.totalAmount.toFixed(2), credit: "0.00" },
    { accountId: accounts.sales, debit: "0.00", credit: input.subtotal.toFixed(2) },
    { accountId: accounts.vatOutput, debit: "0.00", credit: input.taxAmount.toFixed(2) },
    ...(retentionAmount > 0 ? [{ accountId: accounts.retention, debit: retentionAmount.toFixed(2), credit: "0.00" }] : []),
  ];

  await createEntry({
    ...input,
    action: "accounting.autopost.salesInvoice",
    entityName: "invoice",
    entityId: input.invoiceId,
    lines,
  });
}

export async function postSupplierInvoice(
  input: PostingInput & { supplierInvoiceId: string; subtotal: number; taxAmount: number; totalAmount: number },
) {
  const accounts = await resolveAccounts(input.companyId, input.dbClient ?? db);
  await createEntry({
    ...input,
    action: "accounting.autopost.supplierInvoice",
    entityName: "supplierInvoice",
    entityId: input.supplierInvoiceId,
    lines: [
      { accountId: accounts.purchase, debit: input.subtotal.toFixed(2), credit: "0.00" },
      { accountId: accounts.vatInput, debit: input.taxAmount.toFixed(2), credit: "0.00" },
      { accountId: accounts.supplier, debit: "0.00", credit: input.totalAmount.toFixed(2) },
    ],
  });
}

export async function postCustomerPayment(input: PostingInput & { paymentId: string; amount: number }) {
  const accounts = await resolveAccounts(input.companyId, input.dbClient ?? db);
  await createEntry({
    ...input,
    action: "accounting.autopost.customerPayment",
    entityName: "payment",
    entityId: input.paymentId,
    lines: [
      { accountId: accounts.bank, debit: input.amount.toFixed(2), credit: "0.00" },
      { accountId: accounts.customer, debit: "0.00", credit: input.amount.toFixed(2) },
    ],
  });
}

export async function postSupplierPayment(input: PostingInput & { supplierPaymentId: string; amount: number }) {
  const accounts = await resolveAccounts(input.companyId, input.dbClient ?? db);
  await createEntry({
    ...input,
    action: "accounting.autopost.supplierPayment",
    entityName: "supplierPayment",
    entityId: input.supplierPaymentId,
    lines: [
      { accountId: accounts.supplier, debit: input.amount.toFixed(2), credit: "0.00" },
      { accountId: accounts.bank, debit: "0.00", credit: input.amount.toFixed(2) },
    ],
  });
}

export async function postBankTransaction(input: PostingInput & { bankTransactionId: string; amount: number }) {
  const accounts = await resolveAccounts(input.companyId, input.dbClient ?? db);
  const isDeposit = input.amount >= 0;
  await createEntry({
    ...input,
    action: "accounting.autopost.bankTransaction",
    entityName: "bankTransaction",
    entityId: input.bankTransactionId,
    lines: isDeposit
      ? [
          { accountId: accounts.bank, debit: Math.abs(input.amount).toFixed(2), credit: "0.00" },
          { accountId: accounts.customer, debit: "0.00", credit: Math.abs(input.amount).toFixed(2) },
        ]
      : [
          { accountId: accounts.supplier, debit: Math.abs(input.amount).toFixed(2), credit: "0.00" },
          { accountId: accounts.bank, debit: "0.00", credit: Math.abs(input.amount).toFixed(2) },
        ],
  });
}

export async function postYearEndClosing(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  fiscalYearId: string;
}) {
  const [fy] = await db
    .select({ id: fiscalYear.id, startsAt: fiscalYear.startsAt, endsAt: fiscalYear.endsAt })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.id, input.fiscalYearId), eq(fiscalYear.companyId, input.companyId)))
    .limit(1);
  if (!fy) {
    throw new Error("Ejercicio fiscal no encontrado.");
  }

  const revenueRows = await db
    .select({
      accountId: journalLine.accountId,
      balance: sql<string>`coalesce(sum(${journalLine.credit} - ${journalLine.debit}), '0')`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(
      and(
        eq(journalEntry.companyId, input.companyId),
        gte(journalEntry.postedAt, fy.startsAt),
        lte(journalEntry.postedAt, fy.endsAt),
        eq(accountChart.type, "REVENUE"),
      ),
    )
    .groupBy(journalLine.accountId);

  const expenseRows = await db
    .select({
      accountId: journalLine.accountId,
      balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), '0')`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(
      and(
        eq(journalEntry.companyId, input.companyId),
        gte(journalEntry.postedAt, fy.startsAt),
        lte(journalEntry.postedAt, fy.endsAt),
        eq(accountChart.type, "EXPENSE"),
      ),
    )
    .groupBy(journalLine.accountId);

  const [resultAccount] = await db
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, input.companyId), ilike(accountChart.code, "129%")))
    .limit(1);
  if (!resultAccount) {
    throw new Error("No existe la cuenta de resultado del ejercicio (129).");
  }

  const lines: Array<{ accountId: string; debit: string; credit: string }> = [];
  for (const row of revenueRows) {
    const amount = Number(row.balance);
    if (amount <= 0) continue;
    lines.push({ accountId: row.accountId, debit: amount.toFixed(2), credit: "0.00" });
  }
  for (const row of expenseRows) {
    const amount = Number(row.balance);
    if (amount <= 0) continue;
    lines.push({ accountId: row.accountId, debit: "0.00", credit: amount.toFixed(2) });
  }

  const totalDebit = lines.reduce((acc, line) => acc + Number(line.debit), 0);
  const totalCredit = lines.reduce((acc, line) => acc + Number(line.credit), 0);
  if (totalDebit === 0 && totalCredit === 0) return null;

  if (totalDebit > totalCredit) {
    lines.push({ accountId: resultAccount.id, debit: "0.00", credit: (totalDebit - totalCredit).toFixed(2) });
  } else if (totalCredit > totalDebit) {
    lines.push({ accountId: resultAccount.id, debit: (totalCredit - totalDebit).toFixed(2), credit: "0.00" });
  }

  await createEntry({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    postedAt: fy.endsAt,
    reference: `Cierre ejercicio ${input.fiscalYearId}`,
    action: "accounting.autopost.yearEndClosing",
    entityName: "fiscalYear",
    entityId: input.fiscalYearId,
    lines,
  });

  return { closed: true };
}
