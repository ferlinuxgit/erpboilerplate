import Link from "next/link";

import { CreateExpenseInvoiceForm } from "@/components/expenses/create-expense-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listPostingAccounts } from "@/server/accounting/service";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export default async function NewSupplierInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string | string[] }>;
}) {
  const ctx = await requireContext("expense.write");
  const query = await searchParams;
  const initialSupplierId = Array.isArray(query.supplierId)
    ? query.supplierId[0]
    : query.supplierId;
  const [accounts, suppliers] = await Promise.all([
    listPostingAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
  ]);
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE")
    .map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
    }));
  const canWrite = can(ctx.membership.role, "expense.write");

  return (
    <PageShell>
      <PageHeader
        backHref="/purchases/supplier-invoices"
        backLabel="Volver a facturas de proveedor"
        description={`Registra una factura recibida directamente para ${ctx.company.name}.`}
        eyebrow="Facturas de proveedor"
        title="Nueva factura de proveedor"
      />
      <PageSection
        description="Adjunta el documento para usar OCR o completa manualmente proveedor, fechas, impuestos y líneas."
        title="Datos de la factura"
      >
        {!canWrite ? (
          <EmptyState
            description="Tu rol actual no permite registrar facturas de proveedor."
            title="Solo lectura"
          />
        ) : expenseAccounts.length === 0 ? (
          <EmptyState
            action={
              <Link
                className={buttonVariants({ variant: "secondary" })}
                href="/accounting/accounts"
              >
                Ir al plan contable
              </Link>
            }
            description="Configura al menos una cuenta de gasto antes de registrar facturas."
            title="Sin cuentas de gasto"
          />
        ) : (
          <CreateExpenseInvoiceForm
            baseCurrencyCode={ctx.company.baseCurrencyCode}
            expenseAccounts={expenseAccounts}
            initialSupplierId={initialSupplierId}
            suppliers={suppliers}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
