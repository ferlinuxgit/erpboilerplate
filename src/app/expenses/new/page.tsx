import Link from "next/link";

import { CreateExpenseInvoiceForm } from "@/components/expenses/create-expense-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { listAccounts } from "@/server/accounting/service";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export default async function NewExpensePage() {
  const ctx = await requireContext("expense.write");
  const [accounts, suppliers] = await Promise.all([
    listAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
  ]);
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE")
    .map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const canWriteExpenses = can(ctx.membership.role, "expense.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Gastos"
        title="Registrar gasto"
        description={`Registra una factura recibida directa para ${ctx.company.name}.`}
        backHref="/expenses"
        backLabel="Volver a gastos"
      />

      <PageSection title="Datos del gasto" description="Elige OCR o entrada manual, selecciona el proveedor y completa las líneas del documento.">
        {!canWriteExpenses ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite registrar gastos." />
        ) : expenseAccounts.length === 0 ? (
          <EmptyState
            title="Sin cuentas de gasto"
            description="Configura el plan contable antes de registrar gastos directos."
            action={
              <Link className={buttonVariants({ variant: "secondary" })} href="/accounting">
                Ir a contabilidad
              </Link>
            }
          />
        ) : (
          <CreateExpenseInvoiceForm expenseAccounts={expenseAccounts} suppliers={suppliers} />
        )}
      </PageSection>
    </PageShell>
  );
}
