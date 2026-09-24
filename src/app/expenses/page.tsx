import type { Metadata } from "next";
import Link from "next/link";

import { ExpenseInvoicesList } from "@/components/expenses/expense-invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { toServerListState } from "@/server/lists/paginate";
import { expenseInvoiceListConfig, listExpenseInvoicesPage, summarizeExpenseInvoices } from "@/server/supplier-invoices/list";

export const metadata: Metadata = { title: "Facturas de proveedor" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("expense.read");
  const params = parseListParams(await searchParams, expenseInvoiceListConfig);
  const [result, summary] = await Promise.all([
    listExpenseInvoicesPage(ctx.company.id, params),
    summarizeExpenseInvoices(ctx.company.id),
  ]);
  const canWriteExpenses = can(ctx.membership.role, "expense.write");

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
        <ExpenseInvoicesList
          canManage={canWriteExpenses}
          rows={result.rows}
          server={toServerListState(params, result, result.unfilteredTotal)}
          totals={result.totals}
        />
      </PageSection>
    </PageShell>
  );
}
