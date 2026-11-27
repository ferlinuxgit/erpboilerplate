import { FixedAssetForm } from "@/components/accounting/assets/fixed-asset-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { formatIsoDate } from "@/server/fixed-assets/schedule";
import { listFixedAssetAccountOptions, listSupplierInvoiceOptions } from "@/server/fixed-assets/service";

export default async function NewFixedAssetPage({ searchParams }: { searchParams: Promise<{ supplierInvoiceId?: string | string[] }> }) {
  const ctx = await requireContext("accounting.read");
  const canWrite = can(ctx.membership.role, "accounting.write");
  const [accounts, invoices, params] = await Promise.all([listFixedAssetAccountOptions(ctx.company.id), listSupplierInvoiceOptions(ctx.company.id), searchParams]);
  const today = dateInputValue(new Date(), ctx.company.timezone);
  // Alta desde una factura de compra (?supplierInvoiceId=): se propone su fecha y queda enlazada.
  const requestedInvoiceId = typeof params.supplierInvoiceId === "string" ? params.supplierInvoiceId : "";
  const invoice = invoices.find((row) => row.id === requestedInvoiceId) ?? null;
  const acquisitionDate = invoice?.issueDate ?? today;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Inmovilizado"
        title="Nuevo bien"
        description={`Da de alta un bien de inversión de ${ctx.company.name} y su plan de amortización.`}
        backHref="/accounting/assets"
        backLabel="Volver a inmovilizado"
      />
      <PageSection title="Ficha del bien" description="Cuentas, fechas, valor y método de amortización. La compra en sí se contabiliza con su factura de proveedor: aquí solo se define cómo se amortiza.">
        {!canWrite ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite dar de alta bienes de inmovilizado." />
        ) : accounts.asset.length === 0 ? (
          <EmptyState title="Sin cuentas de inmovilizado" description="El plan contable de la empresa no tiene cuentas de los grupos 20, 21 o 22. Revisa el plan contable antes de registrar bienes." />
        ) : (
          <FixedAssetForm
            accounts={accounts}
            currencyCode={ctx.company.baseCurrencyCode}
            initialValues={{
              description: "",
              notes: "",
              assetAccountCode: "",
              accumulatedAccountCode: "",
              expenseAccountCode: "",
              isDepreciable: true,
              method: "percent",
              annualPct: "",
              usefulLifeYears: "",
              taxCoefficientKey: "",
              acquisitionDate,
              inServiceDate: acquisitionDate,
              depreciationStartDate: "",
              acquisitionCost: "",
              residualValue: "",
              priorAccumulated: "",
              supplierInvoiceId: invoice?.id ?? "",
            }}
            supplierInvoices={invoices.map((row) => ({
              id: row.id,
              label: `${formatIsoDate(row.issueDate)} · ${row.supplierDocumentNumber ?? row.number} · ${row.supplierName} · ${formatMoney(row.totalAmount, ctx.company.baseCurrencyCode)}`,
            }))}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
