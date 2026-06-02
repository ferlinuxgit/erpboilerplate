"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";
import {
  buildPurchasePipelineStages,
  getGoodsReceiptInvoiceTransition,
  getInvoiceablePurchaseReceipts,
  getPayableSupplierInvoices,
  getPurchaseOrderReceiptTransition,
  getSupplierInvoicePaymentTransition,
  type TransitionResult,
} from "@/lib/document-pipelines";
import { Button } from "@/components/ui/button";

type Order = {
  id: string;
  number: string;
  status: string;
  supplierPartnerId: string;
  supplierName: string;
};

type OrderLine = {
  id: string;
  purchaseOrderId: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
};

type Receipt = { id: string; purchaseOrderId: string; receivedAt: Date };
type SupplierInvoice = {
  id: string;
  number: string;
  supplierPartnerId: string;
  purchaseOrderId: string | null;
  goodsReceiptId: string | null;
  issueDate?: Date | string;
  totalAmount: string;
};
type SupplierPayment = { id: string; supplierInvoiceId: string; amount: string };

function StageCards({ stages }: { stages: ReturnType<typeof buildPurchasePipelineStages> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {stages.map((stage) => (
        <div className="rounded-md border bg-muted/20 p-3" data-testid={`purchase-stage-${stage.key}`} key={stage.key}>
          <p className="text-xs uppercase text-muted-foreground">{stage.label}</p>
          <p className="text-2xl font-semibold">{stage.count}</p>
          {stage.nextActionLabel ? <p className="text-xs text-muted-foreground">Siguiente: {stage.nextActionLabel}</p> : null}
          {stage.count === 0 ? <p className="mt-2 text-xs text-amber-700">{stage.emptyState}</p> : null}
        </div>
      ))}
    </div>
  );
}

function PipelineSelect<T extends { id: string }>({
  emptyMessage,
  format,
  items,
  onChange,
  value,
}: {
  emptyMessage: string;
  format: (item: T) => string;
  items: T[];
  onChange: (value: string) => void;
  value: string;
}) {
  if (items.length === 0) return <p className="rounded-md border border-dashed p-2 text-sm text-amber-700">{emptyMessage}</p>;
  return (
    <select className="h-8 rounded-md border px-2 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {format(item)}
        </option>
      ))}
    </select>
  );
}

function DocumentRow({
  label,
  loading,
  onAction,
  status,
  testId,
  transition,
}: {
  label: string;
  loading: boolean;
  onAction?: () => void;
  status: string;
  testId?: string;
  transition: TransitionResult;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3 md:flex-row md:items-center md:justify-between" data-testid={testId}>
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

export function PurchaseFlowActions({
  invoices,
  orderLines,
  orders,
  payments,
  receipts,
}: {
  invoices: SupplierInvoice[];
  orderLines: OrderLine[];
  orders: Order[];
  payments: SupplierPayment[];
  receipts: Receipt[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const orderLinesByOrder = useMemo(() => {
    const groups = new Map<string, OrderLine[]>();
    orderLines.forEach((line) => groups.set(line.purchaseOrderId, [...(groups.get(line.purchaseOrderId) ?? []), line]));
    return groups;
  }, [orderLines]);
  const receiptByOrder = useMemo(() => new Map(receipts.map((receipt) => [receipt.purchaseOrderId, receipt])), [receipts]);
  const paidAmountByInvoice = useMemo(() => {
    const amounts = new Map<string, number>();
    payments.forEach((payment) => {
      amounts.set(payment.supplierInvoiceId, (amounts.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amount));
    });
    return amounts;
  }, [payments]);

  const receivableOrders = useMemo(
    () => orders.filter((order) => getPurchaseOrderReceiptTransition({ status: order.status, hasReceipt: receiptByOrder.has(order.id), hasLines: (orderLinesByOrder.get(order.id)?.length ?? 0) > 0 }).allowed),
    [orders, receiptByOrder, orderLinesByOrder],
  );
  const invoiceableReceipts = useMemo(
    () => getInvoiceablePurchaseReceipts({ receipts, orderLines, invoices }),
    [receipts, orderLines, invoices],
  );
  const payableInvoices = useMemo(() => getPayableSupplierInvoices({ invoices, payments }), [invoices, payments]);

  const [selectedOrderId, setSelectedOrderId] = useState(receivableOrders[0]?.id ?? "");
  const [selectedReceiptId, setSelectedReceiptId] = useState(invoiceableReceipts[0]?.id ?? "");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(payableInvoices[0]?.id ?? "");

  const activeOrderId = receivableOrders.some((order) => order.id === selectedOrderId) ? selectedOrderId : receivableOrders[0]?.id ?? "";
  const activeReceiptId = invoiceableReceipts.some((receipt) => receipt.id === selectedReceiptId)
    ? selectedReceiptId
    : invoiceableReceipts[0]?.id ?? "";
  const activeInvoiceId = payableInvoices.some((invoice) => invoice.id === selectedInvoiceId)
    ? selectedInvoiceId
    : payableInvoices[0]?.id ?? "";

  const post = async (url: string, body: unknown) => {
    setLoading(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo completar la transición.");
      }
      toast.success("Transición completada.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const receiveOrder = (orderId: string) => post("/api/goods-receipts", { purchaseOrderId: orderId, receivedAt: new Date().toISOString() });

  const invoiceReceipt = (receiptId: string) => {
    const receipt = receipts.find((candidate) => candidate.id === receiptId);
    const order = receipt ? orders.find((candidate) => candidate.id === receipt.purchaseOrderId) : null;
    const lines = receipt ? orderLinesByOrder.get(receipt.purchaseOrderId) ?? [] : [];
    if (!receipt || !order) {
      toast.error("No se encuentra el pedido de compra para esta recepción.");
      return;
    }
    if (lines.length === 0) {
      toast.error("El pedido necesita líneas para generar la factura proveedor.");
      return;
    }
    void post("/api/supplier-invoices", {
      supplierPartnerId: order.supplierPartnerId,
      purchaseOrderId: order.id,
      goodsReceiptId: receipt.id,
      issueDate: new Date().toISOString(),
      lines: lines.map((line) => ({
        description: line.description,
        itemId: line.itemId ?? undefined,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        taxRate: 21,
      })),
    });
  };

  const payInvoice = (invoiceId: string) => {
    const invoice = invoices.find((candidate) => candidate.id === invoiceId);
    if (!invoice) {
      toast.error("No se encuentra la factura proveedor.");
      return;
    }
    void post("/api/supplier-payments", {
      supplierInvoiceId: invoice.id,
      amountApplied: Number(invoice.totalAmount),
      postedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-4">
      <StageCards
        stages={buildPurchasePipelineStages({
          ordersCount: orders.length,
          receiptsCount: receipts.length,
          supplierInvoicesCount: invoices.length,
          supplierPaymentsCount: payments.length,
        })}
      />

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">1) Pedido a recepción</p>
        <div className="grid gap-2 md:grid-cols-2">
          <PipelineSelect
            emptyMessage="No hay pedidos pendientes de recepción. Crea un pedido con proveedor antes de recepcionar mercancía."
            format={(order) => `${order.number} · ${order.supplierName}`}
            items={receivableOrders}
            onChange={setSelectedOrderId}
            value={activeOrderId}
          />
          <Button disabled={loading || !activeOrderId} onClick={() => receiveOrder(activeOrderId)} type="button">
            Recepcionar mercancía
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">2) Recepción a factura proveedor</p>
        <div className="grid gap-2 md:grid-cols-2">
          <PipelineSelect
            emptyMessage="No hay recepciones facturables. Primero recepciona un pedido con líneas de compra."
            format={(receipt) => {
              const order = orders.find((candidate) => candidate.id === receipt.purchaseOrderId);
              return `${order?.number ?? "Pedido"} · recepción ${receipt.id.slice(0, 8)}`;
            }}
            items={invoiceableReceipts}
            onChange={setSelectedReceiptId}
            value={activeReceiptId}
          />
          <Button disabled={loading || !activeReceiptId} onClick={() => invoiceReceipt(activeReceiptId)} type="button">
            Generar factura proveedor
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 font-medium">3) Factura proveedor a pago</p>
        <div className="grid gap-2 md:grid-cols-2">
          <PipelineSelect
            emptyMessage="No hay facturas proveedor pendientes de pago. Genera primero la factura desde una recepción."
            format={(invoice) => `${invoice.number} · ${Number(invoice.totalAmount).toFixed(2)} €`}
            items={payableInvoices}
            onChange={setSelectedInvoiceId}
            value={activeInvoiceId}
          />
          <Button disabled={loading || !activeInvoiceId} onClick={() => payInvoice(activeInvoiceId)} type="button">
            Registrar pago
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="font-medium">Transiciones válidas por documento</p>
        {orders.length + receipts.length + invoices.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Crea un pedido de compra para ver la siguiente acción válida del ciclo.
          </p>
        ) : null}
        {orders.map((order) => {
          const transition = getPurchaseOrderReceiptTransition({
            status: order.status,
            hasReceipt: receiptByOrder.has(order.id),
            hasLines: (orderLinesByOrder.get(order.id)?.length ?? 0) > 0,
          });
          return (
            <DocumentRow
              key={order.id}
              label={`Pedido ${order.number} · ${order.supplierName}`}
              loading={loading}
              onAction={() => receiveOrder(order.id)}
              status={order.status}
              testId={`purchase-transition-order-${order.number}`}
              transition={transition}
            />
          );
        })}
        {receipts.map((receipt) => {
          const order = orders.find((candidate) => candidate.id === receipt.purchaseOrderId);
          const transition = getGoodsReceiptInvoiceTransition({
            hasLines: (orderLinesByOrder.get(receipt.purchaseOrderId)?.length ?? 0) > 0,
            hasSupplierInvoice: invoices.some((invoice) => invoice.goodsReceiptId === receipt.id),
          });
          return (
            <DocumentRow
              key={receipt.id}
              label={`Recepción ${receipt.id.slice(0, 8)}${order ? ` · pedido ${order.number}` : ""}`}
              loading={loading}
              onAction={() => invoiceReceipt(receipt.id)}
              status={transition.allowed ? "PENDIENTE FACTURA" : "FACTURADA/BLOQUEADA"}
              testId={`purchase-transition-receipt-${receipt.id}`}
              transition={transition}
            />
          );
        })}
        {invoices.map((invoice) => (
          <DocumentRow
            key={invoice.id}
            label={`Factura proveedor ${invoice.number}`}
            loading={loading}
            onAction={() => payInvoice(invoice.id)}
            status={(paidAmountByInvoice.get(invoice.id) ?? 0) >= Number(invoice.totalAmount) ? "PAGADA" : "PENDIENTE"}
            testId={`purchase-transition-invoice-${invoice.number}`}
            transition={getSupplierInvoicePaymentTransition({
              totalAmount: Number(invoice.totalAmount),
              paidAmount: paidAmountByInvoice.get(invoice.id) ?? 0,
            })}
          />
        ))}
      </div>
    </div>
  );
}
