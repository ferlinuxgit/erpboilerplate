import type { Metadata } from "next";
import Link from "next/link";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { DEFAULT_COMPANY_NAME } from "@/lib/tenant";
import { getCompanySetupState } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Puesta en marcha" };

export default async function OnboardingPage() {
  await requireUserSession();
  const ctx = await requireContext();
  const canConfigure = can(ctx.membership.role, "settings.manage");
  const state = canConfigure ? await getCompanySetupState(ctx.company.id, ctx.fiscalYear.id) : null;
  const profile = state?.profile;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Configuración inicial"
        title="Puesta en marcha"
        description="Cuatro pasos para dejar tu empresa lista para facturar. Lo que guardes se conserva aunque lo dejes a medias."
        meta={
          <>
            <StatusBadge tone="neutral">Empresa: {ctx.company.name}</StatusBadge>
            <StatusBadge tone="neutral">Ejercicio: {ctx.fiscalYear.code}</StatusBadge>
            {state?.onboardingCompletedAt ? <StatusBadge tone="success">Completada</StatusBadge> : null}
          </>
        }
      />
      {!canConfigure || !state ? (
        <InlineAlert title="Solo el propietario o un administrador puede configurar la empresa" tone="info">
          <p>Pídeselo a quien te invitó. Mientras tanto, puedes consultar el panel.</p>
          <Link className={buttonVariants({ className: "mt-2", variant: "outline" })} href="/dashboard">Ir al panel</Link>
        </InlineAlert>
      ) : (
        <PageSection title="Asistente de configuración" description="Datos fiscales, dirección, serie de facturas, banco e invitación a tu gestor.">
          <OnboardingWizard
            companyId={ctx.company.id}
            initialValues={{
              legalName: profile?.legalName ?? (profile?.name && profile.name !== DEFAULT_COMPANY_NAME ? profile.name : ""),
              vatNumber: profile?.vatNumber ?? "",
              // El primer paso guarda nombre y tipo de negocio a la vez: sin nombre, la pregunta sigue sin responder.
              businessType: profile?.legalName || state.onboardingCompletedAt ? state.businessType : "",
              fiscalAddress: profile?.fiscalAddress ?? "",
              postalCode: profile?.postalCode ?? "",
              city: profile?.city ?? "",
              province: profile?.province ?? "",
              invoicePrefix: state.invoiceSeries?.prefix ?? "FA",
              iban: state.firstIban ?? "",
              bankName: "",
            }}
            workspaceName={ctx.company.name}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
