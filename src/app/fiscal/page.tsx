import Link from "next/link";

import { FiscalYearLifecyclePanel } from "@/components/accounting/fiscal-year-lifecycle-panel";
import { FiscalObligationsCard } from "@/components/fiscal/fiscal-obligations-card";
import { FiscalPositionSummary } from "@/components/fiscal/fiscal-position-summary";
import { FiscalReportsList } from "@/components/fiscal/fiscal-reports-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { canFromDb } from "@/lib/rbac-server";
import { getFiscalYearLifecycle } from "@/server/accounting/fiscal-years";
import { getCurrentFiscalObligations } from "@/server/fiscal/obligations";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";
import { getFiscalSettings } from "@/server/fiscal/settings";

export default async function FiscalPage() {
  const ctx = await requireContext("fiscal.read");
  const [reports, canWrite, lifecycle, settings] = await Promise.all([
    listFiscalReportsWithSummary(ctx.company.id),
    canFromDb(ctx.membership.role, "fiscal.write"),
    getFiscalYearLifecycle(ctx.company.id, ctx.fiscalYear.id),
    getFiscalSettings(ctx.company.id),
  ]);
  const obligations = await getCurrentFiscalObligations(ctx.company.id, reports);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Fiscalidad España"
        description="Qué tienes que presentar y cuándo, con los importes calculados desde tus facturas. Modelos 303, 390, 347, 349, 111, 115 y 130, y registro VERI*FACTU."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={
          <StatusBadge tone={canWrite ? "success" : "warning"}>
            {canWrite ? "Gestión habilitada" : "Solo lectura"}
          </StatusBadge>
        }
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/calendar">
              Calendario
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/accounting/gestor">
              Paquete para el gestor
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/verifactu">
              VERI*FACTU
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/settings">
              Configuración
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/glossary">
              Ayuda
            </Link>
            {canWrite ? (
              <Link className={buttonVariants()} href="/fiscal/new">
                Nuevo modelo
              </Link>
            ) : null}
          </>
        }
      />
      {lifecycle ? (
        <FiscalYearLifecyclePanel canWrite={can(ctx.membership.role, "accounting.write")} lifecycle={{ ...lifecycle, companyId: ctx.company.id }} variant="alert" />
      ) : null}
      <PageSection
        title="Qué tengo que presentar"
        description="Según tu perfil fiscal y las facturas del periodo. Los importes son borradores: revísalos antes de presentarlos en la sede de la AEAT."
      >
        <FiscalObligationsCard canWrite={canWrite} obligations={obligations} />
      </PageSection>
      <PageSection
        title="Posición fiscal"
        description="Último modelo calculado desde tus facturas. Ábrelo para ver las casillas y copiarlas en la AEAT."
      >
        <FiscalPositionSummary currencyCode={ctx.company.baseCurrencyCode} profile={settings} reports={reports} />
      </PageSection>
      <PageSection
        title="Modelos"
        description="Borradores, preparados y declaraciones presentadas."
      >
        <FiscalReportsList canWrite={canWrite} reports={reports} />
      </PageSection>
    </PageShell>
  );
}
