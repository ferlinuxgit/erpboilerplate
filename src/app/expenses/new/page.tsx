import Link from "next/link";

import { CreateExpenseInvoiceForm } from "@/components/expenses/create-expense-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { listPostingAccounts } from "@/server/accounting/service";
import { listSupplierInvoiceRelations, listSupplierPartners } from "@/server/supplier-invoices/service";

export default async function NewExpensePage({ searchParams }: { searchParams?: Promise<{ supplierId?: string | string[] }> }) {
  const ctx = await requireContext("expense.write");
  const query = await searchParams;
  const initialSupplierId = Array.isArray(query?.supplierId) ? query.supplierId[0] : query?.supplierId;
  const [accounts, suppliers, relations] = await Promise.all([
    listPostingAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
    listSupplierInvoiceRelations(ctx.company.id),
  ]);
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE")
    .map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const canWriteExpenses = can(ctx.membership.role, "expense.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas de proveedor"
        title="Nueva factura de proveedor"
        description={`Registra una factura recibida para ${ctx.company.name}, con o sin pedido previo.`}
        backHref="/expenses"
        backLabel="Volver a facturas de proveedor"
      />

      <PageSection title="Datos de la factura" description="Elige OCR o entrada manual, revisa el proveedor y relaciona el documento con un pedido o recepción si corresponde.">
        {!canWriteExpenses ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite registrar facturas de proveedor." />
        ) : expenseAccounts.length === 0 ? (
          <EmptyState
            title="Sin cuentas de gasto"
            description="Configura el plan contable antes de registrar facturas de proveedor."
            action={
              <Link className={buttonVariants({ variant: "secondary" })} href="/accounting">
                Ir a contabilidad
              </Link>
            }
          />
        ) : (
          <CreateExpenseInvoiceForm
            baseCurrencyCode={ctx.company.baseCurrencyCode}
            expenseAccounts={expenseAccounts}
            goodsReceipts={relations.receipts}
            initialSupplierId={initialSupplierId}
            purchaseOrders={relations.orders}
            suppliers={suppliers}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
