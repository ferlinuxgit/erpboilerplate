"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CustomerOption = { id: string; name: string };
type QuoteOption = { id: string; number: string };
type OrderOption = { id: string; number: string };
type DeliveryOption = { id: string; number: string };

export function SalesFlowActions({
  customers,
  deliveryNotes,
  orders,
  quotes,
}: {
  customers: CustomerOption[];
  deliveryNotes: DeliveryOption[];
  orders: OrderOption[];
  quotes: QuoteOption[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [quoteId, setQuoteId] = useState(quotes[0]?.id ?? "");
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [deliveryId, setDeliveryId] = useState(deliveryNotes[0]?.id ?? "");

  const post = async (url: string, body?: unknown) => {
    setLoading(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo completar la operación.");
      }
      toast.success("Operación completada.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">1) Crear presupuesto</p>
        <div className="grid gap-2 md:grid-cols-3">
          <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => setCustomerId(event.target.value)} value={customerId}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <Input onChange={(event) => setQuoteNumber(event.target.value)} placeholder="PRE-000001" value={quoteNumber} />
          <Button
            disabled={loading}
            onClick={() =>
              post("/api/sales-quotes", {
                customerId,
                number: quoteNumber,
                issueDate: new Date().toISOString(),
                lines: [{ quantity: 1, unitPrice: 100, taxRate: 21 }],
              })
            }
            type="button"
          >
            Crear presupuesto
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">2) Presupuesto a pedido</p>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => setQuoteId(event.target.value)} value={quoteId}>
            {quotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.number}
              </option>
            ))}
          </select>
          <Button disabled={loading || !quoteId} onClick={() => post(`/api/sales-quotes/${quoteId}/to-order`)} type="button">
            Convertir a pedido
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">3) Pedido a albarán</p>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => setOrderId(event.target.value)} value={orderId}>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.number}
              </option>
            ))}
          </select>
          <Button disabled={loading || !orderId} onClick={() => post(`/api/sales-orders/${orderId}/to-delivery`)} type="button">
            Generar albarán
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">4) Albarán a factura</p>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => setDeliveryId(event.target.value)} value={deliveryId}>
            {deliveryNotes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.number}
              </option>
            ))}
          </select>
          <Button disabled={loading || !deliveryId} onClick={() => post(`/api/delivery-notes/${deliveryId}/to-invoice`)} type="button">
            Generar factura
          </Button>
        </div>
      </div>
    </div>
  );
}
