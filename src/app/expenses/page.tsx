import { CreateExpenseInvoiceForm } from "@/components/expenses/create-expense-invoice-form";
import { ExpenseInvoicesList } from "@/components/expenses/expense-invoices-list";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { listAccounts } from "@/server/accounting/service";
import { listExpenseInvoices, listSupplierPartners } from "@/server/supplier-invoices/service";

export default async function ExpensesPage() {
  const ctx = await requireContext("expense.read");
  const [invoices, accounts, suppliers] = await Promise.all([
    listExpenseInvoices(ctx.company.id),
    listAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
  ]);
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE")
    .map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const canWriteExpenses = can(ctx.membership.role, "expense.write");
  const totalAmount = invoices.reduce((total, invoice) => total + Number(invoice.totalAmount), 0);
  const pendingAmount = invoices.reduce((total, invoice) => total + Number(invoice.outstandingAmount), 0);
  const inputTaxAmount = invoices.reduce((total, invoice) => total + Number(invoice.taxAmount), 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Gastos"
        description="Facturas recibidas directas sin pedido de compra: suministros, combustible, alquileres, software y servicios profesionales."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone={canWriteExpenses ? "success" : "warning"}>{canWriteExpenses ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Gastos registrados" value={invoices.length} helper="Facturas directas sin pedido" />
        <MetricCard label="Total gastos" value={formatMoney(totalAmount)} helper="Base, IVA y retenciones incluidos" />
        <MetricCard label="Pendiente de pago" value={formatMoney(pendingAmount)} helper={`IVA soportado ${formatMoney(inputTaxAmount)}`} tone={pendingAmount > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Nuevo gasto" description="Registra una factura recibida directa y contabiliza el gasto, IVA soportado y proveedor.">
        {!canWriteExpenses ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite registrar gastos." />
        ) : expenseAccounts.length === 0 ? (
          <EmptyState title="Sin cuentas de gasto" description="Configura el plan contable antes de registrar gastos directos." />
        ) : (
          <CreateExpenseInvoiceForm expenseAccounts={expenseAccounts} suppliers={suppliers} />
        )}
      </PageSection>

      <PageSection title="Control de gastos" description="Seguimiento operativo de facturas directas, vencimientos y pagos.">
        <ExpenseInvoicesList canManage={canWriteExpenses} rows={invoices} />
      </PageSection>
    </PageShell>
  );
}
