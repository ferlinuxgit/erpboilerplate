import Link from "next/link";

import { ExpenseInvoicesList } from "@/components/expenses/expense-invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { listExpenseInvoices } from "@/server/supplier-invoices/service";

export default async function ExpensesPage() {
  const ctx = await requireContext("expense.read");
  const invoices = await listExpenseInvoices(ctx.company.id);
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
        actions={
          canWriteExpenses ? (
            <Link className={buttonVariants()} href="/expenses/new">
              Nuevo gasto
            </Link>
          ) : null
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Gastos registrados" value={invoices.length} helper="Facturas directas sin pedido" />
        <MetricCard label="Total gastos" value={formatMoney(totalAmount)} helper="Base, IVA y retenciones incluidos" />
        <MetricCard label="Pendiente de pago" value={formatMoney(pendingAmount)} helper={`IVA soportado ${formatMoney(inputTaxAmount)}`} tone={pendingAmount > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Control de gastos" description="Seguimiento operativo de facturas directas, vencimientos y pagos.">
        <ExpenseInvoicesList canManage={canWriteExpenses} rows={invoices} />
      </PageSection>
    </PageShell>
  );
}
