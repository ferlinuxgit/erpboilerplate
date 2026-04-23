import { notFound } from "next/navigation";

import { EditFiscalReportForm } from "@/components/fiscal/edit-fiscal-report-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getFiscalReport } from "@/server/fiscal/service";

export default async function EditFiscalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "fiscal.write")) notFound();
  const { id } = await params;
  const report = await getFiscalReport(ctx.company.id, id);
  if (!report) notFound();
  return (
    <main className="container mx-auto px-4 py-10">
      <Card><CardHeader><CardTitle>Editar reporte fiscal</CardTitle></CardHeader><CardContent>
        <EditFiscalReportForm id={report.id} defaultCode={report.code} defaultPeriod={report.period} defaultStatus={report.status} />
      </CardContent></Card>
    </main>
  );
}
