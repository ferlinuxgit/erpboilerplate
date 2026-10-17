import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseSessionPanel } from "@/components/pos/close-session-panel";
import { SessionReport } from "@/components/pos/session-report";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { computeSessionSummary, getOpenSession, listRegisters } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Cerrar caja" };

export default async function PosClosePage({ params }: { params: Promise<{ registerId: string }> }) {
  const ctx = await requireContext("pos.sell");
  const { registerId } = await params;
  const register = (await listRegisters(ctx.company.id)).find((entry) => entry.id === registerId);
  if (!register) notFound();
  const session = await getOpenSession(ctx.company.id, register.id);
  if (!session) {
    return (
      <PageShell>
        <EmptyState action={<Link className={buttonVariants()} href={`/pos/${register.id}`}>Volver a la caja</Link>} description="No hay ningún turno abierto en esta caja." title="La caja ya está cerrada" />
      </PageShell>
    );
  }
  const summary = await computeSessionSummary(ctx.company.id, session.id);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: `/pos/${register.id}` }, { label: `Cerrar ${register.name}` }]} description="Cuenta el efectivo del cajón: se compara con lo que debería haber y se guarda el informe de cierre (Z)." title={`Cerrar ${register.name}`} />
      <PageSection title="Resumen del turno (X)"><SessionReport currencyCode={ctx.company.baseCurrencyCode} summary={summary} /></PageSection>
      <PageSection title="Arqueo"><CloseSessionPanel currencyCode={ctx.company.baseCurrencyCode} expectedCash={summary.expectedCash} sessionId={session.id} /></PageSection>
    </PageShell>
  );
}
