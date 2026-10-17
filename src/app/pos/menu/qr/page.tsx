import type { Metadata } from "next";
import QRCode from "qrcode";

import { PrintSheetButton } from "@/components/menu/print-sheet-button";
import { requireContext } from "@/lib/current-context";
import { appBaseUrl } from "@/server/email/templates";
import { getMenuSettings, listQrTables } from "@/server/pos/menu";

export const metadata: Metadata = { title: "QR de la carta" };

/** Hoja para imprimir (A4, 6 por página): QR general y uno por mesa, que abre la carta con su nombre. */
export default async function MenuQrSheetPage() {
  const ctx = await requireContext("pos.read");
  const [settings, tables] = await Promise.all([getMenuSettings(ctx.company.id), listQrTables(ctx.company.id)]);
  const base = `${appBaseUrl()}/carta/${settings.slug}`;
  const cards = await Promise.all(
    [{ id: "general", title: "Carta", subtitle: ctx.company.name, url: base }, ...tables.map((table) => ({ id: table.id, title: table.name, subtitle: table.areaName, url: `${base}?mesa=${table.id}` }))].map(async (card) => ({ ...card, qr: await QRCode.toDataURL(card.url, { margin: 1, width: 480, errorCorrectionLevel: "M" }) })),
  );
  return (
    <main className="mx-auto max-w-[210mm] bg-white p-4 text-black print:p-0" data-testid="menu-qr-sheet">
      <style>{"@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } }"}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-black/20 pb-3">
        <div>
          <h1 className="font-mono text-lg font-bold">QR de la carta</h1>
          <p className="text-sm text-black/70">{settings.enabled ? "Imprime y recorta. Cada QR de mesa abre la carta con el nombre de la mesa." : "La carta aún no está publicada: actívala en TPV → Carta antes de poner los QR en las mesas."}</p>
        </div>
        <PrintSheetButton />
      </div>
      <ul className="grid grid-cols-2 gap-[6mm]">
        {cards.map((card) => (
          <li className="flex h-[85mm] break-inside-avoid flex-col items-center justify-center gap-1 border-2 border-dashed border-black/40 p-3 text-center" data-testid={`menu-qr-${card.title}`} key={card.id}>
            <p className="font-mono text-2xl font-black leading-none">{card.title}</p>
            <p className="text-xs text-black/60">{card.subtitle}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generado en el servidor */}
            <img alt={`QR de ${card.title}`} className="size-[48mm]" src={card.qr} />
            <p className="text-sm font-semibold">Escanea para ver la carta</p>
            <p className="text-xs text-black/60">Scan for the menu · Alérgenos / Allergens</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
