import type { Metadata } from "next";

import { PlatformTenants } from "@/components/platform/platform-tenants";
import { MetricCard, PageHeader, PageShell } from "@/components/ui/page";
import { listPlatformTenants, requirePlatformAdminPage, summarizePlatform } from "@/server/platform/service";

export const metadata: Metadata = { title: "Plataforma" };

/** Panel interno de la plataforma (solo administradores): clientes, estado, uso de IA y acciones. */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await requirePlatformAdminPage();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const tenants = await listPlatformTenants({ q, limit: 200 });
  const summary = summarizePlatform(tenants);
  return (
    <PageShell>
      <PageHeader title="Plataforma" description="Todos los espacios del SaaS: estado de cobro, uso de la IA y acciones de soporte. Todo queda auditado en el espacio afectado." />
      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Espacios" value={String(summary.tenants)} helper={q ? "con el filtro actual" : "los 200 más recientes"} />
        <MetricCard label="De pago" value={String(summary.paying)} />
        <MetricCard label="En prueba" value={String(summary.trial)} />
        <MetricCard label="Solo lectura" value={String(summary.readOnly)} />
        <MetricCard label="Suspendidos" value={String(summary.suspended)} />
        <MetricCard label="Coste IA del mes" value={`${summary.monthOcrCostUsd.toFixed(2)} $`} helper={`${summary.monthReadings} lecturas`} />
      </section>
      <PlatformTenants initialQuery={q} tenants={tenants.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        deletionRequestedAt: row.deletionRequestedAt?.toISOString() ?? null,
        pastDueSince: row.pastDueSince?.toISOString() ?? null,
        currentPeriodEndsAt: row.currentPeriodEndsAt?.toISOString() ?? null,
      }))} />
    </PageShell>
  );
}
