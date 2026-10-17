import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseSessionPanel } from "@/components/pos/close-session-panel";
import { KioskBar } from "@/components/pos/kiosk-bar";
import { SessionReport } from "@/components/pos/session-report";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageSection } from "@/components/ui/page";
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
      <div className="flex min-h-dvh flex-col bg-background">
        <KioskBar backHref={`/pos/${register.id}`} backLabel="Caja" title={register.name} />
        <main className="p-4"><EmptyState action={<Link className={buttonVariants()} href={`/pos/${register.id}`}>Volver a la caja</Link>} description="No hay ningún turno abierto en esta caja." title="La caja ya está cerrada" /></main>
      </div>
    );
  }
  const summary = await computeSessionSummary(ctx.company.id, session.id);
  return (
    <div className="flex h-dvh flex-col bg-background">
      <KioskBar backHref={`/pos/${register.id}`} backLabel="Caja" status="Arqueo e informe de cierre (Z)" title={`Cerrar ${register.name}`} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid max-w-5xl gap-4 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <PageSection title="Arqueo" description="Cuenta el efectivo del cajón: se compara con lo que debería haber."><CloseSessionPanel currencyCode={ctx.company.baseCurrencyCode} expectedCash={summary.expectedCash} sessionId={session.id} /></PageSection>
          <PageSection title="Resumen del turno (X)"><SessionReport compact currencyCode={ctx.company.baseCurrencyCode} summary={summary} /></PageSection>
        </div>
      </main>
    </div>
  );
}
