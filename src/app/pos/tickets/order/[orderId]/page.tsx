import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPrint } from "@/components/pos/auto-print";
import { PrintButton } from "@/components/pos/print-button";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { unpaidLines } from "@/modules/hospitality/model";
import { cartTotals, grossPrice } from "@/modules/pos/model";
import { getOrder } from "@/server/pos/hospitality";

export const metadata: Metadata = { title: "Pre-cuenta" };

/** Pre-cuenta (80 mm): lo pendiente de la mesa, por persona y con la advertencia de que no es factura. */
export default async function PreBillPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ print?: string }> }) {
  const ctx = await requireContext("pos.sell");
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const order = await getOrder(ctx.company.id, orderId);
  if (!order) notFound();
  const money = (value: number) => formatMoney(value, ctx.company.baseCurrencyCode);
  const lines = unpaidLines(order.lines);
  const totals = cartTotals(lines.map((line) => ({ key: line.id, itemId: line.itemId, description: line.description, quantity: line.unpaid, unitPrice: line.unitPrice, taxRate: line.taxRate, taxId: line.taxId })));
  const pending = order.amounts.pending;
  return (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-[12px] leading-tight text-black print:w-full print:p-0" data-testid="pos-prebill">
      <style>{"@page { size: 80mm auto; margin: 3mm; } @media print { .no-print { display: none !important; } }"}</style>
      <AutoPrint enabled={query.print === "1"} />
      <div className="no-print mb-2 flex justify-center"><PrintButton label="Imprimir pre-cuenta" /></div>
      <p className="text-center text-sm font-bold">{ctx.company.name}</p>
      <p className="text-center text-base font-black">PRE-CUENTA · {order.name}</p>
      <p className="text-center">{new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })} · {order.guests} {order.guests === 1 ? "comensal" : "comensales"}</p>
      <hr className="my-1 border-dashed border-black" />
      <table className="w-full">
        <tbody>
          {lines.filter((line) => !line.parentLineId).flatMap((line) => [
            <tr key={line.id}><td className="pr-1 align-top">{line.unpaid.toLocaleString("es-ES")} × {line.description}</td><td className="whitespace-nowrap text-right align-top">{money(Math.round(grossPrice(line.unitPrice, line.taxRate) * line.unpaid * 100) / 100)}</td></tr>,
            // Platos del menú, debajo y sin precio.
            ...lines.filter((child) => child.parentLineId === line.id).map((child) => <tr key={child.id}><td className="pl-4 pr-1 align-top" colSpan={2}>· {child.description}</td></tr>),
          ])}
        </tbody>
      </table>
      <hr className="my-1 border-dashed border-black" />
      {order.amounts.paid > 0 ? <p className="flex justify-between"><span>Ya cobrado</span><span>{money(order.amounts.paid)}</span></p> : null}
      <p className="flex justify-between text-base font-black"><span>TOTAL (IVA incl.)</span><span data-testid="pos-prebill-total">{money(order.equalSplit ? pending : totals.total)}</span></p>
      {order.guests > 1 ? <p className="flex justify-between"><span>Por persona ({order.guests})</span><span>{money(Math.round((pending / order.guests) * 100) / 100)}</span></p> : null}
      <hr className="my-1 border-dashed border-black" />
      <p className="text-center font-bold">DOCUMENTO NO VÁLIDO COMO FACTURA</p>
      <p className="text-center">La factura simplificada se entrega al pagar.</p>
    </div>
  );
}
