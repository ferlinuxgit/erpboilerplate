import { notFound } from "next/navigation";

import { EditFiscalReportForm } from "@/components/fiscal/edit-fiscal-report-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getFiscalReport } from "@/server/fiscal/service";

export default async function EditFiscalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("fiscal.write");
  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) notFound();
  return (
    <PageShell>
      <PageHeader eyebrow="Fiscalidad" title="Editar modelo fiscal" description={`${report.code} - ${report.period}`} backHref="/fiscal" backLabel="Volver a fiscalidad" />
      <PageSection title="Datos del modelo" description="Ajusta periodo, estado y modelo del borrador español.">
        <EditFiscalReportForm id={report.id} defaultCode={report.code} defaultPeriod={report.period} defaultStatus={report.status} />
      </PageSection>
    </PageShell>
  );
}
