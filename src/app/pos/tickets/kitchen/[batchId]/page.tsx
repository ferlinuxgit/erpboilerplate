import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPrint } from "@/components/pos/auto-print";
import { requireContext } from "@/lib/current-context";
import { stationLabels } from "@/modules/hospitality/model";
import { getKitchenBatch } from "@/server/pos/hospitality";

export const metadata: Metadata = { title: "Comanda" };

/** Comanda impresa para cocina o barra: mesa, hora y platos con sus notas, en letra grande. */
export default async function KitchenTicketPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ print?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const batch = await getKitchenBatch(ctx.company.id, batchId);
  if (!batch) notFound();
  return (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-black print:w-full print:p-0" data-testid="pos-kitchen-ticket">
      <style>{"@page { size: 80mm auto; margin: 3mm; }"}</style>
      <AutoPrint enabled={query.print === "1"} />
      <p className="text-center text-sm font-bold uppercase">{stationLabels[batch.station]}</p>
      <p className="text-center text-3xl font-black">{batch.name}</p>
      <p className="text-center text-sm">{batch.createdAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {batch.guests} pax{batch.waiterName ? ` · ${batch.waiterName}` : ""}</p>
      <hr className="my-2 border-dashed border-black" />
      <ul className="space-y-2">
        {batch.lines.map((line, index) => (
          <li className={line.status === "CANCELLED" ? "line-through" : ""} key={index}>
            <p className="text-xl font-black">{line.quantity.toLocaleString("es-ES")} × {line.description}</p>
            {line.note ? <p className="text-lg font-bold">→ {line.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
