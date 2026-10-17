import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FloorScreen } from "@/components/hospitality/floor-screen";
import { KioskBar } from "@/components/pos/kiosk-bar";
import { OpenRegisterPanel } from "@/components/pos/open-register-panel";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { isModuleEnabled } from "@/server/modules/service";
import { getFloor } from "@/server/pos/hospitality";
import { getOpenSession, listBankAccountOptions, listPosCatalog, listRegisters, listSessionTickets } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Vender" };

export default async function PosRegisterPage({ params, searchParams }: { params: Promise<{ registerId: string }>; searchParams: Promise<{ counter?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const [{ registerId }, query] = await Promise.all([params, searchParams]);
  const register = (await listRegisters(ctx.company.id)).find((entry) => entry.id === registerId);
  if (!register) notFound();
  const session = await getOpenSession(ctx.company.id, register.id);
  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <KioskBar backHref="/pos?choose=1" backLabel="Cajas" status="Cerrada" title={register.name} />
        <main className="flex flex-1 items-start justify-center overflow-y-auto"><OpenRegisterPanel registerId={register.id} registerName={register.name} /></main>
      </div>
    );
  }
  // Bar o restaurante: el plano de mesas es la pantalla principal (con «Mostrador» para venta directa).
  const tablesMode = register.mode === "TABLES" && (await isModuleEnabled(ctx.company.id, "hospitality"));
  if (tablesMode && query.counter !== "1") {
    return <FloorScreen canManage={can(ctx.membership.role, "pos.manage")} currencyCode={ctx.company.baseCurrencyCode} initial={JSON.parse(JSON.stringify(await getFloor(ctx.company.id, register.id)))} registerId={register.id} registerName={register.name} />;
  }
  const inventoryEnabled = await isModuleEnabled(ctx.company.id, "inventory");
  const [catalog, tickets, bankAccounts] = await Promise.all([
    listPosCatalog(ctx.company.id, register.warehouseId, inventoryEnabled),
    listSessionTickets(ctx.company.id, session.id),
    listBankAccountOptions(ctx.company.id),
  ]);
  return (
    <PosTerminal
      backHref={tablesMode ? `/pos/${register.id}` : undefined}
        bankAccounts={bankAccounts.map((account) => ({ id: account.id, name: account.name }))}
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
          refundedAmount: Number(ticket.refundedAmount),
        }))}
    />
  );
}
