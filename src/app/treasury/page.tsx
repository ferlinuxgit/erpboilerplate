import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { BankAccountsList } from "@/components/treasury/bank-accounts-list";
import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { CreateBankTransactionForm } from "@/components/treasury/create-bank-transaction-form";
import { CustomerCashActions } from "@/components/treasury/customer-cash-actions";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
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
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Tesorería y bancos"
        description="Cuentas bancarias, movimientos, conciliación y cobros de clientes."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone={canWriteTreasury ? "success" : "warning"}>{canWriteTreasury ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="#customer-to-cash-report">
            Ver cobros
          </Link>
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Cuentas bancarias" value={accounts.length} helper="Cuentas activas en el tenant" />
        <MetricCard label="Movimientos" value={rows.length} helper="Transacciones registradas" />
        <MetricCard label="Facturas cobradas" value={paidInvoicesCount} helper={`${customerInvoices.length} facturas en seguimiento`} />
      </section>

      <PageSection title="Alta y movimientos" description="Registra cuentas bancarias y movimientos para alimentar conciliación y reporting." contentClassName="space-y-4">
        {canWriteTreasury ? (
          <>
            <CreateBankAccountForm />
            {accounts.length > 0 ? (
              <CreateBankTransactionForm accounts={accounts} />
            ) : (
              <EmptyState title="Falta una cuenta bancaria" description="Crea una cuenta antes de registrar movimientos." />
            )}
          </>
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas ni movimientos de tesorería." />
        )}
      </PageSection>

      <PageSection title="Cobro de clientes" description="Aplica cobros contra facturas pendientes y actualiza el estado de caja.">
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
          <EmptyState title="Sin facturas pendientes" description="No hay facturas disponibles para registrar cobros." />
        ) : (
          <EmptyState title="Solo lectura" description="Necesitas permisos de escritura para registrar cobros." />
        )}
      </PageSection>

      <PageSection title="Informes de cobros" description="Resumen customer-to-cash de la empresa activa." contentClassName="grid gap-3 md:grid-cols-2" className="scroll-mt-20">
        <div data-testid="customer-to-cash-report" id="customer-to-cash-report">
          <MetricCard label="Facturas cobradas" value={paidInvoicesCount} helper="Cobros completados" />
        </div>
        <MetricCard label="Facturas en seguimiento" value={customerInvoices.length} helper="Incluye pagadas, parciales y pendientes" />
      </PageSection>

      <PageSection title="Cuentas bancarias" description="Cuentas operativas disponibles para movimientos y conciliación.">
        <BankAccountsList canManage={canWriteTreasury} rows={accounts} />
      </PageSection>

      <PageSection title="Movimientos bancarios" description="Histórico de transacciones bancarias y estado de conciliación.">
        <BankTransactionsList canManage={canWriteTreasury} currencyCode={ctx.company.baseCurrencyCode} rows={rows} />
      </PageSection>
    </PageShell>
  );
}
