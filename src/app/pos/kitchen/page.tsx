import type { Metadata } from "next";

import { KitchenBoard } from "@/components/hospitality/kitchen-board";
import { requireContext } from "@/lib/current-context";
import { getKitchenBoard } from "@/server/pos/hospitality";

export const metadata: Metadata = { title: "Cocina" };

/** Pantalla de cocina o barra (?station=BAR). */
export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const station = (await searchParams).station === "BAR" ? "BAR" : "KITCHEN";
  return <KitchenBoard initial={JSON.parse(JSON.stringify(await getKitchenBoard(ctx.company.id, station)))} initialStation={station} />;
}
