import Link from "next/link";

import { ExpenseInvoicesList } from "@/components/expenses/expense-invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { summarizeExpenses } from "@/lib/expense-summary";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { listExpenseInvoices } from "@/server/supplier-invoices/service";

export default async function ExpensesPage() {
  const ctx = await requireContext("expense.read");
  const invoices = await listExpenseInvoices(ctx.company.id);
  const canWriteExpenses = can(ctx.membership.role, "expense.write");
  const summary = summarizeExpenses(invoices);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Facturas de proveedor"
        description="Todas las facturas recibidas, con pedido y recepción opcionales y entrada manual u OCR."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone={canWriteExpenses ? "success" : "warning"}>{canWriteExpenses ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
        actions={
          canWriteExpenses ? (
            <Link className={buttonVariants()} href="/expenses/new">
              Nueva factura
            </Link>
          ) : null
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Facturas activas" value={summary.activeCount} helper={summary.voidCount > 0 ? `${summary.voidCount} anuladas excluidas` : "Documentos recibidos"} />
        <MetricCard label="Total facturado" value={formatMoney(summary.totalAmount)} helper="No incluye facturas anuladas" />
        <MetricCard label="Pendiente de pago" value={formatMoney(summary.pendingAmount)} helper={`IVA soportado ${formatMoney(summary.inputTaxAmount)}`} tone={summary.pendingAmount > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Facturas recibidas" description="Relaciona opcionalmente cada factura con su pedido o recepción y controla vencimientos y pagos.">
        <ExpenseInvoicesList canManage={canWriteExpenses} rows={invoices} />
      </PageSection>
    </PageShell>
  );
}
