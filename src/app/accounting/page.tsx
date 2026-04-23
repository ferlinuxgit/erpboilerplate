import Link from "next/link";

import { AccountRowActions } from "@/components/accounting/account-row-actions";
import { CreateAccountForm } from "@/components/accounting/create-account-form";
import { CreateJournalEntryForm } from "@/components/accounting/create-journal-entry-form";
import { JournalEntryRowActions } from "@/components/accounting/journal-entry-row-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getTrialBalance, listAccounts, listJournalEntries } from "@/server/accounting/service";

export default async function AccountingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const [balance] = await getTrialBalance(ctx.company.id);
  const accounts = await listAccounts(ctx.company.id);
  const entries = await listJournalEntries(ctx.company.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Contabilidad</CardTitle>
          <CardDescription>Plan contable, asientos y balance de comprobacion.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateAccountForm />
          {accounts.length > 0 ? <CreateJournalEntryForm accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))} /> : null}
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          <div className="space-y-2">
            <p className="font-medium">Plan contable</p>
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-md border p-2">
                <p>{account.code} - {account.name} ({account.type})</p>
                <AccountRowActions id={account.id} />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="font-medium">Asientos</p>
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-md border p-2">
                <p>{entry.postedAt.toISOString().slice(0, 10)} - {entry.reference ?? "-"} - {entry.debit}/{entry.credit}</p>
                <JournalEntryRowActions id={entry.id} />
              </div>
            ))}
          </div>
          <p>Asientos: {balance?.entries ?? 0}</p>
          <p>Debe: {balance?.debit ?? "0"}</p>
          <p>Haber: {balance?.credit ?? "0"}</p>
        </CardContent>
      </Card>
    </main>
  );
}
