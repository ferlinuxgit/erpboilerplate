import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PriceListEditor } from "@/components/settings/price-list-editor";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getPriceListDetail } from "@/server/pricing/service";

export const metadata: Metadata = { title: "Tarifa" };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("settings.manage");
  const { id } = await params;
  const list = await getPriceListDetail(ctx.company.id, id);
  if (!list) notFound();
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Configuración", href: "/settings" }, { label: "Tarifas y descuentos", href: "/settings/pricing#tarifas" }, { label: list.name }]}
        description={`Código ${list.code}. Pon un precio propio a los artículos que lo tengan; el resto usa su precio de venta con el ajuste general.`}
        title={`Tarifa «${list.name}»`}
      />
      <PageSection title="Precios">
        <PriceListEditor currencyCode={ctx.company.baseCurrencyCode} list={list} />
      </PageSection>
    </PageShell>
  );
}
