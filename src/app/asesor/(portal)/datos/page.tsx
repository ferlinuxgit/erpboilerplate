import type { Metadata } from "next";

import { AdvisorDownloadList } from "@/components/advisor/advisor-download-list";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { ADVISOR_DATASETS, type AdvisorDatasetKey } from "@/server/advisor/exports";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "../load";

export const metadata: Metadata = { title: "Otros datos" };

export default async function AdvisorDataPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { context, years, period } = await loadPortalPage(searchParams);
  if (!period) return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables.</InlineAlert>;
  const query = advisorPeriodQuery(period);
  const scopes = new Set(context.access.scopes);
  const datasets = (Object.entries(ADVISOR_DATASETS) as Array<[AdvisorDatasetKey, (typeof ADVISOR_DATASETS)[AdvisorDatasetKey]]>).filter(([, dataset]) => scopes.has(dataset.scope));
  return (
    <>
      <AdvisorPeriodBar action="/asesor/datos" period={period} years={years} />
      <PageSection description="Listados en Excel del periodo para cuadrar bancos, cobros y pagos, revisar terceros (347) y la caja." title={`Otros datos · ${period.period.label}`}>
        {datasets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tu acceso no incluye estos listados.</p>
        ) : (
          <AdvisorDownloadList items={datasets.map(([key, dataset]) => ({ key, title: dataset.label, description: dataset.description, href: `/api/advisor/data/${key}?${query}`, kind: "xlsx" }))} testId="advisor-datasets" />
        )}
      </PageSection>
    </>
  );
}
