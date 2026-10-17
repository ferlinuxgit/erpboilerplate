import type { Metadata } from "next";

import { AllergenIcon, AllergenLegend, AllergenMatrix } from "@/components/menu/allergen-icons";
import { PrintSheetButton } from "@/components/menu/print-sheet-button";
import { requireContext } from "@/lib/current-context";
import { getMenuAdmin } from "@/server/pos/menu";

export const metadata: Metadata = { title: "Tabla de alérgenos" };

/** Tabla de alérgenos de la carta para imprimir: platos × 14 alérgenos (Reglamento UE 1169/2011). */
export default async function AllergenSheetPage() {
  const ctx = await requireContext("pos.read");
  const data = await getMenuAdmin(ctx.company.id);
  const sectionName = new Map(data.sections.map((section) => [section.id, section.name]));
  const dishes = data.items
    .filter((dish) => dish.visible)
    .map((dish) => ({ id: dish.itemId, name: dish.displayName ?? dish.name, group: (dish.sectionId && sectionName.get(dish.sectionId)) || "Otros", allergens: dish.allergens, traces: dish.traces, reviewed: dish.reviewed, order: dish.sectionId ? data.sections.findIndex((section) => section.id === dish.sectionId) : data.sections.length }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
  const unreviewed = dishes.filter((dish) => !dish.reviewed).length;
  const today = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: ctx.company.timezone }).format(new Date());
  return (
    <main className="mx-auto max-w-[297mm] bg-white p-4 text-black print:p-0" data-testid="allergen-sheet">
      <style>{"@page { size: A4 landscape; margin: 8mm; } @media print { .no-print { display: none !important; } }"}</style>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b-2 border-black pb-2">
        <div>
          <h1 className="font-mono text-xl font-black">Información sobre alérgenos · {ctx.company.name}</h1>
          <p className="text-sm">Reglamento (UE) 1169/2011 y Real Decreto 126/2015. Actualizada el {today}.</p>
        </div>
        <div className="no-print"><PrintSheetButton /></div>
      </header>
      {unreviewed > 0 ? <p className="no-print mb-3 border-2 border-amber-600 bg-amber-50 p-2 text-sm">{unreviewed} {unreviewed === 1 ? "plato no tiene" : "platos no tienen"} los alérgenos revisados (salen como «consultar»). Revísalos en TPV → Carta antes de imprimir.</p> : null}
      {dishes.length === 0 ? <p className="text-sm">No hay platos en la carta todavía.</p> : <AllergenMatrix dishes={dishes} printable />}
      <footer className="mt-4 grid gap-3 border-t border-black/30 pt-3 text-xs sm:grid-cols-[1fr_auto]">
        <AllergenLegend />
        <div className="max-w-xs space-y-1">
          <p className="flex items-center gap-2"><span className="inline-block size-4 rounded-full bg-neutral-700" /> El plato contiene el alérgeno.</p>
          <p className="flex items-center gap-2"><AllergenIcon decorative id="SESAME" size="sm" variant="traces" /> «T»: puede contener trazas.</p>
          <p>Si tiene alguna alergia o intolerancia, consulte al personal antes de pedir.</p>
        </div>
      </footer>
    </main>
  );
}
