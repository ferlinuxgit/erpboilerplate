"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";
import {
  buildSalesPipelineStages,
  getDeliveryNoteTransition,
  getSalesOrderTransition,
  getSalesQuoteTransition,
  type SalesDocumentStatus,
  type TransitionResult,
} from "@/lib/document-pipelines";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CustomerOption = { id: string; name: string };
type QuoteOption = { id: string; number: string; status: SalesDocumentStatus };
type OrderOption = { id: string; number: string; status: SalesDocumentStatus };
type DeliveryOption = { id: string; number: string; status: SalesDocumentStatus };

type RowProps = {
  label: string;
  status: string;
  testId?: string;
  transition: TransitionResult;
  onAction?: () => void;
  loading: boolean;
};

function PipelineCards({ stages }: { stages: ReturnType<typeof buildSalesPipelineStages> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {stages.map((stage) => (
        <div className="rounded-md border bg-muted/20 p-3" data-testid={`sales-stage-${stage.key}`} key={stage.key}>
          <p className="text-xs uppercase text-muted-foreground">{stage.label}</p>
          <p className="text-2xl font-semibold">{stage.count}</p>
          {stage.nextActionLabel ? <p className="text-xs text-muted-foreground">Siguiente: {stage.nextActionLabel}</p> : null}
          {stage.count === 0 ? <p className="mt-2 text-xs text-amber-700">{stage.emptyState}</p> : null}
        </div>
      ))}
    </div>
  );
}

function DocumentTransitionRow({ label, loading, onAction, status, testId, transition }: RowProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-background p-3 md:flex-row md:items-center md:justify-between"
      data-testid={testId}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">Estado: {status}</p>
        {!transition.allowed ? <p className="mt-1 text-xs text-amber-700">Bloqueado: {transition.reason}</p> : null}
      </div>
      {transition.allowed ? (
        <Button disabled={loading} onClick={onAction} size="sm" type="button">
          {transition.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function FirstEligibleSelect<T extends { id: string; number: string; status: SalesDocumentStatus }>({
  emptyMessage,
  items,
  onChange,
  value,
}: {
  emptyMessage: string;
  items: T[];
  onChange: (value: string) => void;
  value: string;
}) {
  if (items.length === 0) return <p className="rounded-md border border-dashed p-2 text-sm text-amber-700">{emptyMessage}</p>;
  return (
    <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.number} · {item.status}
        </option>
      ))}
    </select>
  );
}

export function SalesFlowActions({
  customers,
  deliveryNotes,
  initialCustomerId,
  invoicesCount,
  orders,
  quotes,
}: {
  customers: CustomerOption[];
  deliveryNotes: DeliveryOption[];
  initialCustomerId?: string;
  invoicesCount: number;
  orders: OrderOption[];
  quotes: QuoteOption[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const initialCustomer = customers.some((customer) => customer.id === initialCustomerId) ? initialCustomerId : customers[0]?.id;
  const [customerId, setCustomerId] = useState(initialCustomer ?? "");
  const [quoteNumber, setQuoteNumber] = useState("");

  const eligibleQuotes = useMemo(() => quotes.filter((quote) => getSalesQuoteTransition(quote.status).allowed), [quotes]);
  const eligibleOrders = useMemo(() => orders.filter((order) => getSalesOrderTransition(order.status).allowed), [orders]);
  const eligibleDeliveryNotes = useMemo(
    () => deliveryNotes.filter((note) => getDeliveryNoteTransition(note.status).allowed),
    [deliveryNotes],
  );

  const [quoteId, setQuoteId] = useState(eligibleQuotes[0]?.id ?? "");
  const [orderId, setOrderId] = useState(eligibleOrders[0]?.id ?? "");
  const [deliveryId, setDeliveryId] = useState(eligibleDeliveryNotes[0]?.id ?? "");

  const selectedQuoteId = eligibleQuotes.some((quote) => quote.id === quoteId) ? quoteId : eligibleQuotes[0]?.id ?? "";
  const selectedOrderId = eligibleOrders.some((order) => order.id === orderId) ? orderId : eligibleOrders[0]?.id ?? "";
  const selectedDeliveryId = eligibleDeliveryNotes.some((note) => note.id === deliveryId)
    ? deliveryId
    : eligibleDeliveryNotes[0]?.id ?? "";

  const stages = buildSalesPipelineStages({
    quotesCount: quotes.length,
    ordersCount: orders.length,
    deliveryNotesCount: deliveryNotes.length,
    invoicesCount,
  });

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
      <PipelineCards stages={stages} />

      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-3 text-sm">
        <span className="text-muted-foreground">Continuidad del journey:</span>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/customers">
          Clientes
        </Link>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/invoices">
          Ir a facturas
        </Link>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/treasury">
          Cobros
        </Link>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">1) Crear presupuesto</p>
        {customers.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-sm text-amber-700">
            Necesitas crear un cliente antes de iniciar presupuestos de venta.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            <label className="sr-only" htmlFor="sales-quote-customer">
              Cliente para presupuesto
            </label>
            <select
              id="sales-quote-customer"
              className="h-8 rounded-md border px-2 text-sm"
              onChange={(event) => setCustomerId(event.target.value)}
              value={customerId}
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <Input onChange={(event) => setQuoteNumber(event.target.value)} placeholder="PRE-000001" value={quoteNumber} />
            <Button
              disabled={loading || !customerId}
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
        )}
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">2) Presupuesto a pedido</p>
        <div className="grid gap-2 md:grid-cols-2">
          <FirstEligibleSelect
            emptyMessage="No hay presupuestos convertibles: crea un presupuesto nuevo o revisa que no esté anulado/ya convertido."
            items={eligibleQuotes}
            onChange={setQuoteId}
            value={selectedQuoteId}
          />
          <Button disabled={loading || !selectedQuoteId} onClick={() => post(`/api/sales-quotes/${selectedQuoteId}/to-order`)} type="button">
            Convertir a pedido
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">3) Pedido a albarán</p>
        <div className="grid gap-2 md:grid-cols-2">
          <FirstEligibleSelect
            emptyMessage="No hay pedidos confirmados pendientes de entregar. Convierte primero un presupuesto a pedido."
            items={eligibleOrders}
            onChange={setOrderId}
            value={selectedOrderId}
          />
          <Button disabled={loading || !selectedOrderId} onClick={() => post(`/api/sales-orders/${selectedOrderId}/to-delivery`)} type="button">
            Generar albarán
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">4) Albarán a factura</p>
        <div className="grid gap-2 md:grid-cols-2">
          <FirstEligibleSelect
            emptyMessage="No hay albaranes entregados pendientes de factura. Genera un albarán desde un pedido confirmado."
            items={eligibleDeliveryNotes}
            onChange={setDeliveryId}
            value={selectedDeliveryId}
          />
          <Button disabled={loading || !selectedDeliveryId} onClick={() => post(`/api/delivery-notes/${selectedDeliveryId}/to-invoice`)} type="button">
            Generar factura
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Transiciones válidas por documento</p>
        {[...quotes, ...orders, ...deliveryNotes].length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Aún no hay documentos en el ciclo. Crea un presupuesto para ver la siguiente acción permitida.
          </p>
        ) : null}
        {quotes.map((quote) => (
          <DocumentTransitionRow
            key={quote.id}
            label={`Presupuesto ${quote.number}`}
            loading={loading}
            onAction={() => post(`/api/sales-quotes/${quote.id}/to-order`)}
            status={quote.status}
            testId={`sales-transition-quote-${quote.number}`}
            transition={getSalesQuoteTransition(quote.status)}
          />
        ))}
        {orders.map((order) => (
          <DocumentTransitionRow
            key={order.id}
            label={`Pedido ${order.number}`}
            loading={loading}
            onAction={() => post(`/api/sales-orders/${order.id}/to-delivery`)}
            status={order.status}
            testId="sales-transition-order"
            transition={getSalesOrderTransition(order.status)}
          />
        ))}
        {deliveryNotes.map((note) => (
          <DocumentTransitionRow
            key={note.id}
            label={`Albarán ${note.number}`}
            loading={loading}
            onAction={() => post(`/api/delivery-notes/${note.id}/to-invoice`)}
            status={note.status}
            testId="sales-transition-delivery"
            transition={getDeliveryNoteTransition(note.status)}
          />
        ))}
      </div>
    </div>
  );
}
