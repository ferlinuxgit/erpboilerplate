import type { Metadata } from "next";
import Link from "next/link";

import { ExpenseBatchUpload } from "@/components/expenses/expense-batch-upload";
import type { InboxJob } from "@/components/expenses/expense-batch-model";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listPostingAccounts } from "@/server/accounting/service";
import { listExpenseInbox } from "@/server/ocr/expense-ocr";
import { withDuplicateAssessment } from "@/server/ocr/inbox";
import { getExpenseOcrSettings } from "@/server/ocr/settings";
import { listSupplierInvoiceRelations, listSupplierPartners } from "@/server/supplier-invoices/service";

export const metadata: Metadata = { title: "Bandeja de facturas pendientes" };

export default async function ExpenseInboxPage() {
  const ctx = await requireContext("expense.write");
  const [accounts, suppliers, relations, inbox, aiSettings] = await Promise.all([
    listPostingAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
    listSupplierInvoiceRelations(ctx.company.id),
    listExpenseInbox(ctx.company.id),
    getExpenseOcrSettings(ctx.company.id, Boolean(process.env.OPENAI_API_KEY)),
  ]);
  const jobs = await withDuplicateAssessment(ctx.company.id, inbox);
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE")
    .map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const initialJobs: InboxJob[] = jobs.map((job) => ({
    id: job.id,
    batchId: job.batchId,
    status: job.status,
    fileName: job.fileName,
    fileUrl: job.fileUrl,
    contentType: job.contentType,
    sizeBytes: job.sizeBytes,
    extractionProvider: job.extractionProvider,
    errorMessage: job.errorMessage,
    extracted: job.extracted,
    duplicateAssessment: job.duplicateAssessment,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Bandeja de facturas"
        description="Facturas y tickets subidos que aún no has registrado. Se guardan aquí aunque cierres la página."
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Facturas de proveedor", href: "/expenses" },
          { label: "Bandeja pendiente" },
        ]}
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/expenses/new">
            Registrar a mano
          </Link>
        }
      />
      <PageSection title="Documentos" description="Sube, revisa junto al original y registra. «Registrar preparados» solo incluye los que no necesitan revisión.">
        {expenseAccounts.length === 0 ? (
          <EmptyState
            title="Sin cuentas de gasto"
            description="Configura el plan contable antes de registrar facturas de proveedor."
            action={<Link className={buttonVariants({ variant: "secondary" })} href="/accounting">Ir a contabilidad</Link>}
          />
        ) : (
          <ExpenseBatchUpload
            aiSettings={aiSettings}
            backHref="/expenses/new"
            baseCurrencyCode={ctx.company.baseCurrencyCode}
            canManageAiSettings={can(ctx.membership.role, "settings.manage")}
            expenseAccounts={expenseAccounts}
            goodsReceipts={relations.receipts}
            initialJobs={initialJobs}
            purchaseOrders={relations.orders}
            suppliers={suppliers}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
