import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";

export default async function OnboardingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Onboarding</CardTitle>
          <CardDescription>Completa la configuración inicial de empresa y ejercicio.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            <p>Tenant: {ctx.tenant.name}</p>
            <p>Empresa: {ctx.company.name}</p>
            <p>Ejercicio: {ctx.fiscalYear.code}</p>
          </div>
          <OnboardingWizard />
        </CardContent>
      </Card>
    </main>
  );
}
