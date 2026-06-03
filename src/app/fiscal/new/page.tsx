import { CreateFiscalReportForm } from "@/components/fiscal/create-fiscal-report-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { canFromDb } from "@/lib/rbac";

export default async function NewFiscalReportPage() {
  const ctx = await requireContext("fiscal.write");
  const canWrite = await canFromDb(ctx.membership.role, "fiscal.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Nuevo modelo"
        description={`Crea un borrador fiscal para ${ctx.company.name}.`}
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
      />

      <PageSection title="Datos del modelo" description="Selecciona modelo, periodo y estado inicial del borrador.">
        {canWrite ? (
          <CreateFiscalReportForm redirectHref="/fiscal" />
        ) : (
          <EmptyState title="Solo lectura" description="Necesitas permisos de escritura para crear modelos fiscales." />
        )}
      </PageSection>
    </PageShell>
  );
}
