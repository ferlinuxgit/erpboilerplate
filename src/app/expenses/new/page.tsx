import type { Metadata } from "next";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import Link from "next/link";

import { CreateExpenseInvoiceForm, type RectifiedInvoicePrefill } from "@/components/expenses/create-expense-invoice-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { can } from "@/lib/rbac";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatSeriesNumber } from "@/lib/document-series-format";
import { listPostingAccounts } from "@/server/accounting/service";
import { listSelectableSeries } from "@/server/documents/series";
import { isModuleEnabled } from "@/server/modules/service";
import { countExpenseInbox } from "@/server/ocr/expense-ocr";
import { parseSupplierVatTreatment } from "@/lib/supplier-defaults";
import { rectificationLinesFrom } from "@/server/supplier-invoices/document-rules";
import { getExpenseInvoice, listSupplierInvoiceRelations, listSupplierPartners } from "@/server/supplier-invoices/service";

export const metadata: Metadata = { title: "Nueva factura de proveedor" };

type NewExpenseQuery = { supplierId?: string | string[]; rectifies?: string | string[]; kind?: string | string[] };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Cuentas de inmovilizado en las que se registra una compra (grupos 20 a 23 del PGC). */
const isFixedAssetPurchaseAccount = (account: { code: string; type: string }) => account.type === "ASSET" && /^2[0-3]/.test(account.code);

export default async function NewExpensePage({ searchParams }: { searchParams?: Promise<NewExpenseQuery> }) {
  const ctx = await requireContext("expense.write");
  const query = await searchParams;
  const taxTerritory = await getCompanyTaxTerritory(ctx.company.id);
  const initialSupplierId = first(query?.supplierId);
  // «Registrar abono / rectificativa» desde una factura: ?rectifies=<id>. Alta directa: ?kind=rectification.
  const rectifiesId = first(query?.rectifies);
  const rectified = rectifiesId ? await getExpenseInvoice(ctx.company.id, rectifiesId) : null;
  const rectifiedInvoice: RectifiedInvoicePrefill | undefined = rectified && rectified.status !== "VOID"
    ? {
        id: rectified.id,
        number: rectified.number,
        supplierDocumentNumber: rectified.supplierDocumentNumber,
        issueDate: rectified.issueDate.toISOString().slice(0, 10),
        supplierPartnerId: rectified.supplierPartnerId,
        vatTreatment: parseSupplierVatTreatment(rectified.vatTreatment),
        lines: rectificationLinesFrom(rectified.lines),
      }
    : undefined;
  const isRectification = Boolean(rectifiedInvoice) || first(query?.kind) === "rectification";
  const [accounts, suppliers, relations, pendingInboxCount, seriesRows] = await Promise.all([
    listPostingAccounts(ctx.company.id),
    listSupplierPartners(ctx.company.id),
    listSupplierInvoiceRelations(ctx.company.id),
    countExpenseInbox(ctx.company.id),
    listSelectableSeries(db, ctx.company.id, ctx.fiscalYear.id, "SUPPLIER_INVOICE"),
  ]);
  const expenseSeries = seriesRows.map((series) => ({
    id: series.id,
    code: series.code,
    name: series.name,
    isDefault: series.isDefault,
    preview: formatSeriesNumber({ format: series.format, nextNumber: series.nextNumber, prefix: series.prefix, referenceDate: new Date() }),
  }));
  // Gastos (grupo 6) e inmovilizado (20-23): un bien de inversión se registra en su cuenta del grupo 2.
  const usedAccountIds = new Set(rectifiedInvoice?.lines.map((line) => line.expenseAccountId));
  const expenseAccounts = accounts
    .filter((account) => account.type === "EXPENSE" || isFixedAssetPurchaseAccount(account) || usedAccountIds.has(account.id))
    .map((account) => ({ id: account.id, code: account.code, name: account.name }));
  const canWriteExpenses = can(ctx.membership.role, "expense.write");
  const readingEnabled = await isModuleEnabled(ctx.company.id, "invoice-reading");

  return (
    <PageShell>
      <PageHeader
        title={isRectification ? "Nueva rectificativa de proveedor" : "Nueva factura de proveedor"}
        description={isRectification
          ? `Registra un abono o una factura rectificativa recibida${rectifiedInvoice ? ` sobre ${rectifiedInvoice.supplierDocumentNumber || rectifiedInvoice.number}` : ""}.`
          : `Registra una factura recibida para ${ctx.company.name}, con o sin pedido previo.`}
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Facturas de proveedor", href: "/expenses" },
          { label: isRectification ? "Nueva rectificativa" : "Nueva factura de proveedor" },
        ]}
      />

      <PageSection title="Datos de la factura" description="Súbela o hazle una foto para que se lea sola, o escríbela a mano.">
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
            cashAccountingAvailable={getCountryFiscalProfile(taxTerritory).features.vatReturns}
            homeCountryCode={taxTerritory}
            expenseAccounts={expenseAccounts}
            expenseSeries={expenseSeries}
            goodsReceipts={relations.receipts}
            initialKind={isRectification ? "RECTIFICATION" : "INVOICE"}
            initialSupplierId={initialSupplierId}
            rectifiedInvoice={rectifiedInvoice}
            pendingInboxCount={readingEnabled ? pendingInboxCount : 0}
            readingEnabled={readingEnabled}
            purchaseOrders={relations.orders}
            suppliers={suppliers}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
