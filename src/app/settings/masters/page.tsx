import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MastersPanel } from "@/components/settings/masters-panel";
import { requireContext } from "@/lib/current-context";

export default async function MastersSettingsPage() {
  const ctx = await requireContext("settings.manage");

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
