import Link from "next/link";

import { FiscalReportsList } from "@/components/fiscal/fiscal-reports-list";
import { SpanishTaxSummary } from "@/components/fiscal/spanish-tax-summary";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { canFromDb } from "@/lib/rbac-server";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";

export default async function FiscalPage() {
  const ctx = await requireContext("fiscal.read");
  const [reports, canWrite] = await Promise.all([
    listFiscalReportsWithSummary(ctx.company.id),
    canFromDb(ctx.membership.role, "fiscal.write"),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Fiscalidad España"
        description="Modelos 303, 390, 347, 111 y 115, cálculo tributario y control de presentación desde los documentos contabilizados."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={
          <StatusBadge tone={canWrite ? "success" : "warning"}>
            {canWrite ? "Gestión habilitada" : "Solo lectura"}
          </StatusBadge>
        }
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/fiscal/calendar"
            >
              Calendario
            </Link>
            {canWrite ? (
              <Link className={buttonVariants()} href="/fiscal/new">
                Nuevo modelo
              </Link>
            ) : null}
          </>
        }
      />
      <PageSection
        title="Posición fiscal"
        description="Situación del periodo, impuestos y controles previos a presentación."
      >
        <SpanishTaxSummary reports={reports} />
      </PageSection>
      <PageSection
        title="Modelos fiscales"
        description="Borradores, preparados y declaraciones presentadas."
      >
        <FiscalReportsList canWrite={canWrite} reports={reports} />
      </PageSection>
    </PageShell>
  );
}
