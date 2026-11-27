import { notFound } from "next/navigation";

import { FixedAssetForm } from "@/components/accounting/assets/fixed-asset-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { formatIsoDate } from "@/server/fixed-assets/schedule";
import { getFixedAsset, listFixedAssetAccountOptions, listSupplierInvoiceOptions } from "@/server/fixed-assets/service";

/** Número de la base de datos («25.0000») como texto editable («25»). */
const plainNumber = (value: string | null) => (value === null ? "" : String(Number(value)));

export default async function EditFixedAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("accounting.write");
  const { id } = await params;
  const [detail, accounts, invoices] = await Promise.all([getFixedAsset(ctx.company.id, id), listFixedAssetAccountOptions(ctx.company.id), listSupplierInvoiceOptions(ctx.company.id)]);
  if (!detail) notFound();
  const { asset } = detail;
  const supplierInvoices = invoices.map((row) => ({
    id: row.id,
    label: `${formatIsoDate(row.issueDate)} · ${row.supplierDocumentNumber ?? row.number} · ${row.supplierName} · ${formatMoney(row.totalAmount, ctx.company.baseCurrencyCode)}`,
  }));
  // La factura enlazada se mantiene en la lista aunque ya no esté entre las más recientes.
  if (detail.supplierInvoice?.id && !supplierInvoices.some((row) => row.id === detail.supplierInvoice?.id)) {
    supplierInvoices.unshift({ id: detail.supplierInvoice.id, label: detail.supplierInvoice.supplierDocumentNumber ?? detail.supplierInvoice.number });
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Inmovilizado"
        title={`Editar ${asset.code}`}
        description={asset.description}
        backHref={`/accounting/assets/${asset.id}`}
        backLabel="Volver a la ficha"
      />
      <PageSection title="Ficha del bien" description="Cuentas, fechas, valor y método de amortización.">
        <FixedAssetForm
          accounts={accounts}
          assetId={asset.id}
          currencyCode={ctx.company.baseCurrencyCode}
          economicsLocked={detail.economicsLocked}
          initialValues={{
            description: asset.description,
            notes: asset.notes ?? "",
            assetAccountCode: detail.assetAccount.code,
            accumulatedAccountCode: detail.accumulatedAccount?.code ?? "",
            expenseAccountCode: detail.expenseAccount?.code ?? "",
            isDepreciable: asset.isDepreciable,
            method: asset.method === "years" ? "years" : "percent",
            annualPct: plainNumber(asset.annualPct),
            usefulLifeYears: plainNumber(asset.usefulLifeYears),
            taxCoefficientKey: asset.taxCoefficientKey ?? "",
            acquisitionDate: asset.acquisitionDate,
            inServiceDate: asset.inServiceDate,
            depreciationStartDate: asset.depreciationStartDate ?? "",
            acquisitionCost: asset.acquisitionCost,
            residualValue: asset.residualValue,
            priorAccumulated: Number(asset.priorAccumulated) > 0 ? asset.priorAccumulated : "",
            supplierInvoiceId: detail.supplierInvoice?.id ?? "",
          }}
          supplierInvoices={supplierInvoices}
        />
      </PageSection>
    </PageShell>
  );
}
