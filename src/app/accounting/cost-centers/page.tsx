import type { Metadata } from "next";

import { CostCentersManager } from "@/components/accounting/cost-centers-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listCostCenters } from "@/server/cost-centers/service";

export const metadata: Metadata = { title: "Centros de coste" };

export default async function CostCentersPage() {
  const ctx = await requireContext("accounting.read");
  const centers = await listCostCenters(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad · Analítica"
        title="Centros de coste"
        description={`Departamentos, obras o proyectos de ${ctx.company.name} entre los que repartir los gastos.`}
        backHref="/accounting"
        backLabel="Volver a contabilidad"
      />
      <PageSection
        title="Centros"
        description="Asigna un centro a cada bien de inmovilizado en su ficha: sus amortizaciones se contabilizan con ese centro. Un centro con apuntes no se borra, se desactiva."
      >
        <CostCentersManager canWrite={can(ctx.membership.role, "accounting.write")} centers={centers} />
      </PageSection>
    </PageShell>
  );
}
