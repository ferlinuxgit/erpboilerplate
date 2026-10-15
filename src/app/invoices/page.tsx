import type { Metadata } from "next";
import Link from "next/link";

import { InvoicesList } from "@/components/invoices/invoices-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { canManageInvoices } from "@/lib/rbac";
import { invoiceListConfig, listInvoicesPage } from "@/server/invoices/list";
import { listPaymentMethodsForCollection } from "@/server/treasury/payment-methods";
import { toServerListState } from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Facturas" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUserSession();
  const tenantContext = await requireContext("invoice.read");
  const companyId = tenantContext.company.id;
  const params = parseListParams(await searchParams, invoiceListConfig);
  const currencyCode = tenantContext.company.baseCurrencyCode;

  const [list, paymentMethods] = await Promise.all([
    listInvoicesPage(companyId, params, { timezone: tenantContext.company.timezone || undefined, currencyCode }),
    listPaymentMethodsForCollection(db, companyId),
  ]);
  const { result, recordCount, totals } = list;

  const canCreateInvoice = canManageInvoices(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Facturas"
        title="Facturas"
        description={`Emisión y seguimiento de facturas de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {statusLabel(roleLabels, tenantContext.membership.role)}</StatusBadge>}
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices/collections">
              Cobros pendientes
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices/recurring">
              Recurrentes
            </Link>
            {canCreateInvoice ? (
              <Link className={buttonVariants()} href="/invoices/new">
                Nueva factura
              </Link>
            ) : null}
          </>
        }
      />

      <PageSection
        title="Facturas"
        description={
          totals.draftCount > 0
            ? `Emitidas, rectificativas y borradores. Los totales solo suman facturas emitidas; hay ${totals.draftCount} ${totals.draftCount === 1 ? "borrador" : "borradores"} por ${formatMoney(totals.draftAmount, currencyCode)} sin emitir.`
            : "Emitidas y rectificativas. Abre una factura para ver sus datos, el PDF o registrar un cobro."
        }
      >
        <InvoicesList
          currencyCode={currencyCode}
          paymentMethods={paymentMethods}
          server={toServerListState(params, result, recordCount)}
          totals={totals}
          rows={list.rows}
        />
      </PageSection>
    </PageShell>
  );
}
