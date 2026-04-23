import Link from "next/link";

import { BankAccountRowActions } from "@/components/treasury/bank-account-row-actions";
import { BankTransactionRowActions } from "@/components/treasury/bank-transaction-row-actions";
import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { CreateBankTransactionForm } from "@/components/treasury/create-bank-transaction-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listBankAccounts, listBankTransactions } from "@/server/treasury/service";

export default async function TreasuryPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const accounts = await listBankAccounts(ctx.company.id);
  const rows = await listBankTransactions(ctx.company.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Tesorería y Bancos</CardTitle>
          <CardDescription>CRUD de cuentas bancarias y movimientos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateBankAccountForm />
          {accounts.length > 0 ? <CreateBankTransactionForm accounts={accounts} /> : null}
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          <div className="space-y-2">
            <p className="font-medium">Cuentas bancarias</p>
            {accounts.length === 0 ? <p className="text-sm text-muted-foreground">Sin cuentas.</p> : accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-md border p-2">
                <p>{account.bankName} - {account.iban}</p>
                <BankAccountRowActions id={account.id} />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="font-medium">Movimientos</p>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">Sin movimientos.</p> : rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-md border p-2">
                <p>{row.bankName} - {row.description} - {row.amount.toString()}</p>
                <BankTransactionRowActions id={row.id} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
