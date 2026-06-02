import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { BankAccountsList } from "@/components/treasury/bank-accounts-list";
import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { CreateBankTransactionForm } from "@/components/treasury/create-bank-transaction-form";
import { CustomerCashActions } from "@/components/treasury/customer-cash-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customer, invoice } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listBankAccounts, listBankTransactions } from "@/server/treasury/service";

type TreasuryPageProps = {
  searchParams?: Promise<{ invoiceId?: string | string[] }>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TreasuryPage({ searchParams }: TreasuryPageProps) {
  const ctx = await requireContext("treasury.read");
  const params = await searchParams;
  const requestedInvoiceId = firstQueryValue(params?.invoiceId);
  const accounts = await listBankAccounts(ctx.company.id);
  const rows = await listBankTransactions(ctx.company.id);
  const customerInvoices = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      totalAmount: invoice.totalAmount,
      paymentStatus: invoice.paymentStatus,
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(invoice.customerId, customer.id))
    .where(eq(invoice.companyId, ctx.company.id))
    .orderBy(desc(invoice.createdAt));
  const selectedInvoice =
    customerInvoices.find((candidate) => candidate.id === requestedInvoiceId) ??
    customerInvoices.find((candidate) => candidate.paymentStatus !== "PAID") ??
    customerInvoices[0];
  const paidInvoicesCount = customerInvoices.filter((candidate) => candidate.paymentStatus === "PAID").length;
  const canWriteTreasury = can(ctx.membership.role, "treasury.write");

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Tesorería y Bancos</CardTitle>
          <CardDescription>CRUD de cuentas bancarias, movimientos y cobros de clientes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWriteTreasury ? (
            <>
              <CreateBankAccountForm />
              {accounts.length > 0 ? <CreateBankTransactionForm accounts={accounts} /> : null}
            </>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Tu rol actual es de solo lectura para tesorería.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
              Volver
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="#customer-to-cash-report">
              Ver reporting de cobros
            </Link>
          </div>
          {selectedInvoice && canWriteTreasury ? (
            <CustomerCashActions
              invoice={{
                id: selectedInvoice.id,
                number: selectedInvoice.number,
                customerName: selectedInvoice.customerName,
                totalAmount: Number(selectedInvoice.totalAmount),
                totalAmountLabel: formatMoney(selectedInvoice.totalAmount.toString(), ctx.company.baseCurrencyCode),
                paymentStatus: selectedInvoice.paymentStatus,
              }}
            />
          ) : !selectedInvoice ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay facturas pendientes de cobro.</p>
          ) : null}
          <div className="space-y-2" data-testid="customer-to-cash-report" id="customer-to-cash-report">
            <p className="font-medium">Reporting de cobros</p>
            <p className="text-sm">Facturas cobradas: {paidInvoicesCount}</p>
            <p className="text-sm text-muted-foreground">Facturas en seguimiento: {customerInvoices.length}</p>
          </div>
          <BankAccountsList canManage={canWriteTreasury} rows={accounts} />
          <BankTransactionsList canManage={canWriteTreasury} currencyCode={ctx.company.baseCurrencyCode} rows={rows} />
        </CardContent>
      </Card>
    </main>
  );
}
