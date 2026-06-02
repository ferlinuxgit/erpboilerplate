import { notFound } from "next/navigation";

import { EditFiscalReportForm } from "@/components/fiscal/edit-fiscal-report-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/current-context";
import { getFiscalReport } from "@/server/fiscal/service";

export default async function EditFiscalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("fiscal.write");
  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) notFound();
  return (
    <main className="container mx-auto px-4 py-10">
      <Card><CardHeader><CardTitle>Editar modelo fiscal</CardTitle><CardDescription>Ajusta el periodo, estado y modelo del borrador español.</CardDescription></CardHeader><CardContent>
        <EditFiscalReportForm id={report.id} defaultCode={report.code} defaultPeriod={report.period} defaultStatus={report.status} />
      </CardContent></Card>
    </main>
  );
}
