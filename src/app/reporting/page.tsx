import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { listKpis } from "@/server/reporting/service";

export default async function ReportingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const kpis = await listKpis(ctx.company.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Reporting y BI</CardTitle>
          <CardDescription>KPIs y dashboards de negocio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/api/reporting/export">
            Exportar KPIs a Excel
          </Link>
          {kpis.length === 0 ? <p className="text-sm text-muted-foreground">Sin métricas calculadas aún.</p> : kpis.map((kpi) => <p key={kpi.id}>{kpi.metricKey}: {kpi.metricValue.toString()}</p>)}
        </CardContent>
      </Card>
    </main>
  );
}
