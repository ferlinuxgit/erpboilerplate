import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPrint } from "@/components/pos/auto-print";
import { requireContext } from "@/lib/current-context";
import { stationLabels } from "@/modules/hospitality/model";
import { courseLongLabels } from "@/modules/hospitality/ordering";
import { getKitchenBatch } from "@/server/pos/hospitality";

export const metadata: Metadata = { title: "Comanda" };

/** Comanda impresa para cocina o barra: mesa, hora y platos con sus notas, en letra grande. */
export default async function KitchenTicketPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ print?: string; course?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const batch = await getKitchenBatch(ctx.company.id, batchId);
  if (!batch) notFound();
  // ?course=2: comanda de «marchar» (solo ese tiempo).
  const marching = query.course ? Number(query.course) : null;
  const lines = marching ? batch.lines.filter((line) => line.course === marching) : batch.lines;
  const courses = [...new Set(lines.map((line) => line.course))];
  return (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-black print:w-full print:p-0" data-testid="pos-kitchen-ticket">
      <style>{"@page { size: 80mm auto; margin: 3mm; }"}</style>
      <AutoPrint enabled={query.print === "1"} />
      <p className="text-center text-sm font-bold uppercase">{stationLabels[batch.station]}</p>
      {marching ? <p className="my-1 bg-black py-1 text-center text-2xl font-black text-white">MARCHAR {courseLongLabels[marching].toUpperCase()}</p> : null}
      <p className="text-center text-3xl font-black">{batch.name}</p>
      <p className="text-center text-sm">{batch.createdAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {batch.guests} pax{batch.waiterName ? ` · ${batch.waiterName}` : ""}</p>
      <hr className="my-2 border-dashed border-black" />
      {courses.map((course) => (
        <section key={course}>
          {courses.length > 1 || course > 0 ? <p className="mt-2 border-b border-black text-sm font-black uppercase">{courseLongLabels[course]}{!marching && lines.some((line) => line.course === course && line.held) ? " · EN ESPERA" : ""}</p> : null}
          <ul className="space-y-2">
            {lines.filter((line) => line.course === course).map((line, index) => (
              <li className={line.status === "CANCELLED" ? "line-through" : ""} key={index}>
                <p className="text-xl font-black">{line.quantity.toLocaleString("es-ES")} × {line.description}{line.inMenu ? " (menú)" : ""}</p>
                {line.note ? <p className="text-lg font-bold">→ {line.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
