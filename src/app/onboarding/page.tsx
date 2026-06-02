import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";

export default async function OnboardingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Configuración inicial"
        title="Onboarding"
        description="Completa la configuración inicial de empresa y ejercicio."
        meta={
          <>
            <StatusBadge tone="neutral">Tenant: {ctx.tenant.name}</StatusBadge>
            <StatusBadge tone="neutral">Empresa: {ctx.company.name}</StatusBadge>
            <StatusBadge tone="neutral">Ejercicio: {ctx.fiscalYear.code}</StatusBadge>
          </>
        }
      />
      <PageSection title="Asistente de configuración" description="Aplica seeds base, revisa contexto y prepara la operación inicial.">
        <OnboardingWizard />
      </PageSection>
    </PageShell>
  );
}
