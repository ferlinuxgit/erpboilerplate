import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPrint } from "@/components/pos/auto-print";
import { PrintButton } from "@/components/pos/print-button";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { getTicketPrint } from "@/server/pos/service";

export const metadata: Metadata = { title: "Ticket" };

function address(party: { address: string | null; postalCode: string | null; city: string | null } | null | undefined) {
  return party ? [party.address, [party.postalCode, party.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
}

/**
 * Ticket de 80 mm (factura simplificada, art. 7 RD 1619/2012): número y serie, fecha, emisor con NIF,
 * conceptos, tipo de IVA y desglose si hay varios, total; QR y leyenda VERI*FACTU si procede.
 */
export default async function TicketPrintPage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ print?: string }> }) {
  const ctx = await requireContext("pos.read");
  const [{ invoiceId }, query] = await Promise.all([params, searchParams]);
  const ticket = await getTicketPrint(ctx.company.id, invoiceId);
  if (!ticket) notFound();
  const currency = ctx.company.baseCurrencyCode;
  const money = (value: number) => formatMoney(value, currency);
  const issuer = ticket.invoice.issuerSnapshot;
  const customer = ticket.invoice.customerSnapshot;
  const isRefund = ticket.invoice.invoiceType === "CREDIT_NOTE";
  const identified = Boolean(customer?.taxId);
  const issued = new Date(ticket.invoice.issuedAt ?? ticket.invoice.issueDate);

  return (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-[11px] leading-tight text-black print:w-full print:p-0" data-testid="pos-ticket-print">
      <style>{"@page { size: 80mm auto; margin: 3mm; } @media print { .no-print { display: none !important; } body { background: white; } }"}</style>
      <AutoPrint enabled={query.print === "1"} />
      <div className="no-print mb-2 flex justify-center"><PrintButton label="Imprimir ticket" /></div>
      <header className="text-center">
        <p className="text-sm font-bold">{issuer?.name ?? ctx.company.name}</p>
        {issuer?.legalName && issuer.legalName !== issuer.name ? <p>{issuer.legalName}</p> : null}
        <p>NIF {issuer?.taxId ?? "—"}</p>
        {address(issuer) ? <p>{address(issuer)}</p> : null}
      </header>
      <hr className="my-1 border-dashed border-black" />
      <p className="font-bold">{isRefund ? "FACTURA RECTIFICATIVA" : identified ? "FACTURA" : "FACTURA SIMPLIFICADA"}</p>
      <p>Nº {ticket.invoice.number}</p>
      <p>{issued.toLocaleDateString("es-ES")} {issued.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{ticket.payment?.registerName ? ` · ${ticket.payment.registerName}` : ""}</p>
      {isRefund && ticket.originalNumber ? <p>Rectifica el ticket {ticket.originalNumber}</p> : null}
      {identified && customer ? (
        <div className="mt-1">
          <p>Cliente: {customer.name}</p>
          <p>NIF {customer.taxId}</p>
          {address(customer) ? <p>{address(customer)}</p> : null}
        </div>
      ) : null}
      <hr className="my-1 border-dashed border-black" />
      <table className="w-full">
        <tbody>
          {ticket.lines.map((line, index) => (
            <tr key={index}>
              <td className="pr-1 align-top">{line.quantity.toLocaleString("es-ES")} × {line.description}</td>
              <td className="whitespace-nowrap text-right align-top">{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-1 border-dashed border-black" />
      <table className="w-full">
        <tbody>
          {ticket.totals.breakdown.map((bucket) => (
            <tr key={bucket.rate}><td>Base {bucket.rate} %</td><td className="text-right">{money(bucket.base)}</td><td className="text-right">IVA {money(bucket.tax)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 flex justify-between text-sm font-bold"><span>TOTAL{ticket.totals.tax !== 0 ? " (IVA incluido)" : ""}</span><span>{money(ticket.totals.total)}</span></p>
      {ticket.payment ? (
        <div className="mt-1">
          {ticket.payment.cash !== 0 ? <p className="flex justify-between"><span>{isRefund ? "Devuelto en efectivo" : "Efectivo"}</span><span>{money(ticket.payment.cash)}</span></p> : null}
          {ticket.payment.card !== 0 ? <p className="flex justify-between"><span>{isRefund ? "Devuelto en tarjeta" : "Tarjeta"}</span><span>{money(ticket.payment.card)}</span></p> : null}
          {ticket.payment.cashReceived !== null && !isRefund ? <p className="flex justify-between"><span>Entregado</span><span>{money(ticket.payment.cashReceived)}</span></p> : null}
          {ticket.payment.change !== null && ticket.payment.change > 0 ? <p className="flex justify-between"><span>Cambio</span><span>{money(ticket.payment.change)}</span></p> : null}
          {ticket.payment.tip > 0 ? <p className="flex justify-between"><span>Propina (tarjeta)</span><span>{money(ticket.payment.tip)}</span></p> : null}
        </div>
      ) : null}
      {ticket.verifactu ? (
        <div className="mt-2 flex flex-col items-center text-center">
          <div className="size-[32mm] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: ticket.verifactu.svg }} />
          {ticket.verifactu.legends.map((legend) => <p key={legend}>{legend}</p>)}
        </div>
      ) : null}
      <p className="mt-2 text-center">¡Gracias por su visita!</p>
    </div>
  );
}
