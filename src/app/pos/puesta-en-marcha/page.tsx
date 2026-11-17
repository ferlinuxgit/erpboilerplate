import type { Metadata } from "next";

import { SetupWizard } from "@/components/hospitality/setup-wizard";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { listAreasWithTables } from "@/server/pos/hospitality";
import { listRegisters } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Poner en marcha la sala" };

/** Asistente para bares y restaurantes: caja en modo Mesas y salas con sus mesas en tres pasos. */
export default async function HospitalitySetupPage() {
  const ctx = await requireContext("pos.manage");
  const [registers, areas] = await Promise.all([listRegisters(ctx.company.id), listAreasWithTables(ctx.company.id)]);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Poner en marcha la sala" }]} description="En tres pasos dejas la caja lista para trabajar por mesas. Después puedes dibujar el plano y retocarlo todo." title="Poner en marcha la sala" />
      <SetupWizard existingTables={areas.reduce((sum, area) => sum + area.tables.length, 0)} registers={registers.filter((register) => register.isActive).map((register) => ({ id: register.id, name: register.name, mode: register.mode }))} />
    </PageShell>
  );
}
