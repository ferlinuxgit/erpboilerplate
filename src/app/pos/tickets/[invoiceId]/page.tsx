import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPrint } from "@/components/pos/auto-print";
import { PrintButton } from "@/components/pos/print-button";
import { invoice } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { documentClassTitle, effectiveDocumentClass } from "@/server/invoices/document-class";
import { commercialReasonLabels, isCommercialReason } from "@/server/invoices/lifecycle";
import { getTicketPrint } from "@/server/pos/service";

export const metadata: Metadata = { title: "Ticket" };

function address(party: { address: string | null; postalCode: string | null; city: string | null } | null | undefined) {
  return party ? [party.address, [party.postalCode, party.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
}

/**
 * Ticket de 80 mm (factura simplificada, art. 7 RD 1619/2012): número y serie, fecha, emisor con NIF,
 * conceptos, tipo de IVA y desglose si hay varios, total; QR y leyenda VERI*FACTU si procede.
 * El título sale de la clase de documento congelada al emitir: con los datos del cliente sigue
 * siendo una factura simplificada (arts. 7.2 y 7.3) salvo que se emitiera como factura completa.
 * El ticket de devolución (rectificativa) imprime el motivo (art. 15.3: causa de la rectificación).
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
  const [extra] = await db
    .select({ documentClass: invoice.documentClass, rectificationDescription: invoice.rectificationDescription, commercialReason: invoice.commercialReason })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, ctx.company.id)))
    .limit(1);
  const title = documentClassTitle(effectiveDocumentClass({ documentClass: extra?.documentClass, customerTaxId: customer?.taxId })).toUpperCase();
  // El motivo guardado lleva al final una marca técnica «[xxxxxxxx]» (evita devoluciones duplicadas): no se imprime.
  const refundReason = isRefund ? (extra?.rectificationDescription ?? "").replace(/\s*\[[0-9a-f-]{6,}\]\s*$/i, "").trim() : "";

  return (
    <div className="mx-auto w-[80mm] bg-white p-2 font-mono text-[11px] leading-tight text-black print:w-full print:p-0" data-testid="pos-ticket-print">
      <style>{"@page { size: 80mm auto; margin: 3mm; } @media print { .no-print { display: none !important; } body { background: white; } }"}</style>
      <AutoPrint enabled={query.print === "1"} />
      <div className="no-print mb-2 flex justify-center"><PrintButton label="Imprimir ticket" /></div>
      {/*
        QR tributario: al principio del ticket, centrado y antes de cualquier otro contenido (documento
        técnico de la AEAT). El SVG ya trae 4 módulos en blanco por lado: en 38 mm son más de 2 mm de
        margen y un código de más de 30 mm. Rótulo y leyenda, con la misma letra que el resto.
      */}
      {ticket.verifactu ? (
        <div className="mb-2 flex flex-col items-center text-center" data-testid="pos-ticket-qr">
          <p>{ticket.verifactu.caption}</p>
          <div className="size-[38mm] bg-white [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: ticket.verifactu.svg }} />
          {ticket.verifactu.legends.map((legend) => <p className="font-bold" key={legend}>{legend}</p>)}
        </div>
      ) : null}
      <header className="text-center">
        <p className="text-sm font-bold">{issuer?.name ?? ctx.company.name}</p>
        {issuer?.legalName && issuer.legalName !== issuer.name ? <p>{issuer.legalName}</p> : null}
        <p>NIF {issuer?.taxId ?? "—"}</p>
        {address(issuer) ? <p>{address(issuer)}</p> : null}
      </header>
      <hr className="my-1 border-dashed border-black" />
      <p className="font-bold" data-testid="pos-ticket-title">{isRefund ? "FACTURA RECTIFICATIVA" : title}</p>
      <p>Nº {ticket.invoice.number}</p>
      <p>{issued.toLocaleDateString("es-ES")} {issued.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{ticket.payment?.registerName ? ` · ${ticket.payment.registerName}` : ""}</p>
      {isRefund && ticket.originalNumber ? <p>Rectifica el ticket {ticket.originalNumber}</p> : null}
      {isRefund && (refundReason || isCommercialReason(extra?.commercialReason)) ? (
        <p data-testid="pos-ticket-refund-reason">
          Motivo: {refundReason || (isCommercialReason(extra?.commercialReason) ? commercialReasonLabels[extra.commercialReason] : "")}
        </p>
      ) : null}
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
          {ticket.lines.filter((line) => !line.isDisbursement).map((line, index) => (
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
      {ticket.totals.disbursements !== 0 ? (
        // Suplidos (art. 78.Tres.3.º LIVA): pagados por cuenta del cliente, fuera de la base y del IVA.
        <div className="mt-1" data-testid="pos-ticket-disbursements">
          <p className="flex justify-between"><span>Total factura</span><span>{money(ticket.totals.total - ticket.totals.disbursements)}</span></p>
          <p className="font-bold">SUPLIDOS</p>
          {ticket.lines.filter((line) => line.isDisbursement).map((line, index) => (
            <p className="flex justify-between" key={index}><span>{line.description}</span><span>{money(line.total)}</span></p>
          ))}
        </div>
      ) : null}
      <p className="mt-1 flex justify-between text-sm font-bold"><span>{ticket.totals.disbursements !== 0 ? "TOTAL A PAGAR" : "TOTAL"}{ticket.totals.tax !== 0 && ticket.totals.disbursements === 0 ? " (IVA incluido)" : ""}</span><span>{money(ticket.totals.total)}</span></p>
      {ticket.payment ? (
        <div className="mt-1">
          {ticket.payment.cash !== 0 ? <p className="flex justify-between"><span>{isRefund ? "Devuelto en efectivo" : "Efectivo"}</span><span>{money(ticket.payment.cash)}</span></p> : null}
          {ticket.payment.card !== 0 ? <p className="flex justify-between"><span>{isRefund ? "Devuelto en tarjeta" : "Tarjeta"}</span><span>{money(ticket.payment.card)}</span></p> : null}
          {ticket.payment.cashReceived !== null && !isRefund ? <p className="flex justify-between"><span>Entregado</span><span>{money(ticket.payment.cashReceived)}</span></p> : null}
          {ticket.payment.change !== null && ticket.payment.change > 0 ? <p className="flex justify-between"><span>Cambio</span><span>{money(ticket.payment.change)}</span></p> : null}
          {ticket.payment.tip > 0 ? <p className="flex justify-between"><span>Propina (tarjeta)</span><span>{money(ticket.payment.tip)}</span></p> : null}
        </div>
      ) : null}
      <p className="mt-2 text-center">¡Gracias por su visita!</p>
    </div>
  );
}
