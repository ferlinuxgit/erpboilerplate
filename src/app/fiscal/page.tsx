import Link from "next/link";

import { CreateFiscalReportForm } from "@/components/fiscal/create-fiscal-report-form";
import { FiscalReportRowActions } from "@/components/fiscal/fiscal-report-row-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listFiscalReports } from "@/server/fiscal/service";

export default async function FiscalPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const reports = await listFiscalReports(ctx.company.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Fiscal Multi-país</CardTitle>
          <CardDescription>Motor fiscal pluggable por país con estados de presentación.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateFiscalReportForm />
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          {reports.length === 0 ? <p className="text-sm text-muted-foreground">Sin reportes fiscales.</p> : reports.map((report) => (
            <div key={report.id} className="flex items-center justify-between rounded-md border p-2">
              <p>{report.code} {report.period} - {report.status}</p>
              <FiscalReportRowActions id={report.id} />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
