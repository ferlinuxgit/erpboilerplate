import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MastersPanel } from "@/components/settings/masters-panel";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";

export default async function MastersSettingsPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Maestros</CardTitle>
          <CardDescription>Configuración de catálogos base para {ctx.company.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          <MastersPanel />
        </CardContent>
      </Card>
    </main>
  );
}
