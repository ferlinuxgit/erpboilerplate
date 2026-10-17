import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpenRegisterPanel } from "@/components/pos/open-register-panel";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { isModuleEnabled } from "@/server/modules/service";
import { getOpenSession, listPosCatalog, listRegisters, listSessionTickets } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Vender" };

export default async function PosRegisterPage({ params }: { params: Promise<{ registerId: string }> }) {
  const ctx = await requireContext("pos.sell");
  const { registerId } = await params;
  const register = (await listRegisters(ctx.company.id)).find((entry) => entry.id === registerId);
  if (!register) notFound();
  const session = await getOpenSession(ctx.company.id, register.id);
  if (!session) {
    return <PageShell><OpenRegisterPanel registerId={register.id} registerName={register.name} /></PageShell>;
  }
  const inventoryEnabled = await isModuleEnabled(ctx.company.id, "inventory");
  const [catalog, tickets] = await Promise.all([
    listPosCatalog(ctx.company.id, register.warehouseId, inventoryEnabled),
    listSessionTickets(ctx.company.id, session.id),
  ]);
  return (
    <PageShell className="max-w-none">
      <PosTerminal
        canManage={can(ctx.membership.role, "pos.manage")}
        catalog={catalog}
        currencyCode={ctx.company.baseCurrencyCode}
        register={{ id: register.id, name: register.name, cardEnabled: Boolean(register.cardPaymentMethodId), simplifiedLimit: register.simplifiedLimit, warehouseName: register.warehouseName }}
        session={{ id: session.id, openedAt: session.openedAt.toISOString(), openingCash: Number(session.openingCash) }}
        tickets={tickets.map((ticket) => ({
          id: ticket.id,
          kind: ticket.kind as "SALE" | "REFUND",
          invoiceId: ticket.invoiceId,
          number: ticket.number,
          totalAmount: Number(ticket.totalAmount),
          cashAmount: Number(ticket.cashAmount),
          cardAmount: Number(ticket.cardAmount),
          createdAt: ticket.createdAt.toISOString(),
          refunded: Boolean(ticket.refunded),
        }))}
      />
    </PageShell>
  );
}
