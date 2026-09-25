import type { Metadata } from "next";
import Link from "next/link";

import { RecurringExpenseForm } from "@/components/recurring/recurring-expense-form";
import { defaultScheduleDraft } from "@/components/recurring/schedule-draft";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { listPostingAccounts } from "@/server/accounting/service";
import { todayDateInput } from "@/server/invoices/due-dates";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export const metadata: Metadata = { title: "Nuevo gasto recurrente" };

export default async function NewRecurringExpensePage() {
  await requireUserSession();
  const ctx = await requireContext("expense.write");
  const [accounts, suppliers] = await Promise.all([listPostingAccounts(ctx.company.id), listSupplierPartners(ctx.company.id)]);
  const expenseAccounts = accounts.filter((account) => account.type === "EXPENSE" || account.code.startsWith("6")).map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Compras y gastos" }, { label: "Gastos", href: "/expenses" }, { label: "Recurrentes", href: "/expenses/recurring" }, { label: "Nuevo" }]}
        title="Nuevo gasto recurrente"
        description="Defínelo una vez: en cada fecha se prepara el gasto para que solo tengas que confirmarlo."
      />
      {activeSuppliers.length === 0 ? (
        <EmptyState action={<Link className={buttonVariants()} href="/suppliers/new">Crear proveedor</Link>} description="Necesitas al menos un proveedor (el casero, la gestoría, la Seguridad Social…)." title="Todavía no hay proveedores" />
      ) : (
        <RecurringExpenseForm
          accounts={expenseAccounts}
          initial={{
            name: "",
            supplierPartnerId: "",
            expenseAccountId: "",
            description: "",
            amount: null,
            taxRate: 21,
            retentionRate: 0,
            taxDeductiblePct: 100,
            issueMode: "DRAFT",
            schedule: defaultScheduleDraft(todayDateInput(ctx.company.timezone || undefined)),
          }}
          suppliers={activeSuppliers.map((supplier) => ({
            id: supplier.id,
            number: supplier.number,
            name: supplier.name,
            taxId: supplier.taxId,
            defaults: {
              defaultExpenseAccountId: supplier.defaults.defaultExpenseAccountId,
              defaultRetentionRate: supplier.defaults.defaultRetentionRate,
              defaultTaxDeductiblePct: supplier.defaults.defaultTaxDeductiblePct,
            },
          }))}
        />
      )}
    </PageShell>
  );
}
