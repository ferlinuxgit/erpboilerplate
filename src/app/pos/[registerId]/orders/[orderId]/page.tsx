import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OrderScreen } from "@/components/hospitality/order-screen";
import { requireContext } from "@/lib/current-context";
import { isModuleEnabled } from "@/server/modules/service";
import { getOrder } from "@/server/pos/hospitality";
import { getOrderingOptions } from "@/server/pos/ordering";
import { getOpenSession, listPosCatalog, listRegisters } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Mesa" };

export default async function PosOrderPage({ params }: { params: Promise<{ registerId: string; orderId: string }> }) {
  const ctx = await requireContext("pos.sell");
  const { registerId, orderId } = await params;
  const [register, order] = await Promise.all([
    listRegisters(ctx.company.id).then((rows) => rows.find((entry) => entry.id === registerId)),
    getOrder(ctx.company.id, orderId),
  ]);
  if (!register || !order || order.registerId !== register.id) notFound();
  // Para cobrar hace falta la caja abierta.
  if (!(await getOpenSession(ctx.company.id, register.id))) redirect(`/pos/${register.id}`);
  const [catalog, ordering] = await Promise.all([listPosCatalog(ctx.company.id, register.warehouseId, await isModuleEnabled(ctx.company.id, "inventory")), getOrderingOptions(ctx.company.id)]);
  return <OrderScreen cardEnabled={Boolean(register.cardPaymentMethodId)} catalog={catalog} currencyCode={ctx.company.baseCurrencyCode} initial={JSON.parse(JSON.stringify(order))} ordering={ordering} />;
}
