"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
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
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { purchaseOrderStatusLabels, statusLabel } from "@/lib/status-labels";

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

type Receipt = { id: string; number: string; purchaseOrderId: string; receivedAt: Date };
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
type Step = "receive" | "invoice" | "pay";

function StageCards({ stages }: { stages: ReturnType<typeof buildPurchasePipelineStages> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {stages.map((stage) => (
        <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3" data-testid={`purchase-stage-${stage.key}`} key={stage.key}>
          <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.04em] text-window-muted">{stage.label}</p>
          <p className="font-mono text-2xl font-bold tabular-nums">{stage.count}</p>
          {stage.nextActionLabel ? <p className="text-xs text-muted-foreground">Siguiente: {stage.nextActionLabel}</p> : null}
          {stage.count === 0 ? <p className="mt-2 text-xs text-warning">{stage.emptyState}</p> : null}
        </div>
      ))}
    </div>
  );
}

function PipelineSelect<T extends { id: string }>({
  emptyMessage,
  format,
  id,
  items,
  label,
  onChange,
  value,
}: {
  emptyMessage: string;
  format: (item: T) => string;
  id: string;
  items: T[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-2 text-xs text-warning" role="status">{emptyMessage}</p>;
  }
  return (
    <AccessibleField id={id} label={label} required>
      <Select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {format(item)}
          </option>
        ))}
      </Select>
    </AccessibleField>
  );
}

function PipelineStep({
  children,
  error,
  id,
  loading,
  onSubmit,
  submitDisabled,
  submitLabel,
  title,
}: {
  children: ReactNode;
  error: string | null;
  id: string;
  loading: boolean;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitLabel: string;
  title: string;
}) {
  return (
    <form
      aria-labelledby={`${id}-title`}
      className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!submitDisabled) onSubmit();
      }}
    >
      <h3 className="mb-2 font-mono text-xs font-bold" id={`${id}-title`}>
        {title}
      </h3>
      <div className="grid items-end gap-2 md:grid-cols-2">
        {children}
        <SubmitButton disabled={submitDisabled} pending={loading} pendingLabel="Procesando…">
          {submitLabel}
        </SubmitButton>
      </div>
      <FormErrorMessage className="mt-2">{error}</FormErrorMessage>
    </form>
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
    <div className="flex flex-col gap-2 rounded-[2px] border border-window-shadow bg-window-surface p-3 md:flex-row md:items-center md:justify-between" data-testid={testId}>
      <div>
        <p className="font-mono text-xs font-bold">{label}</p>
        <p className="text-xs text-muted-foreground">Estado: {status}</p>
        {!transition.allowed ? <p className="mt-1 text-xs text-warning">Bloqueado: {transition.reason}</p> : null}
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
  const [stepErrors, setStepErrors] = useState<Record<Step, string | null>>({ receive: null, invoice: null, pay: null });

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

  const setStepError = (step: Step, message: string | null) => setStepErrors((current) => ({ ...current, [step]: message }));

  const fail = (step: Step, message: string) => {
    setStepError(step, message);
    toast.error(message);
  };

  const post = async (step: Step, url: string, body: unknown, { failure, success }: { failure: string; success: string }) => {
    setLoading(true);
    setStepError(step, null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, failure));
      }
      toast.success(success);
      router.refresh();
    } catch (error) {
      fail(step, errorMessage(error, `${failure} Inténtalo de nuevo.`));
    } finally {
      setLoading(false);
    }
  };

  const receiveOrder = (orderId: string) =>
    void post("receive", "/api/goods-receipts", { purchaseOrderId: orderId, receivedAt: new Date().toISOString() }, {
      failure: "No se pudo registrar la recepción.",
      success: "Recepción registrada.",
    });

  const invoiceReceipt = (receiptId: string) => {
    const receipt = receipts.find((candidate) => candidate.id === receiptId);
    const order = receipt ? orders.find((candidate) => candidate.id === receipt.purchaseOrderId) : null;
    const lines = receipt ? orderLinesByOrder.get(receipt.purchaseOrderId) ?? [] : [];
    if (!receipt || !order) {
      fail("invoice", "No se encuentra el pedido de compra para esta recepción.");
      return;
    }
    if (lines.length === 0) {
      fail("invoice", "El pedido necesita líneas para generar la factura proveedor.");
      return;
    }
    void post(
      "invoice",
      "/api/supplier-invoices",
      {
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
      },
      { failure: "No se pudo generar la factura de proveedor.", success: "Factura de proveedor generada." },
    );
  };

  const payInvoice = (invoiceId: string) => {
    const invoice = invoices.find((candidate) => candidate.id === invoiceId);
    if (!invoice) {
      fail("pay", "No se encuentra la factura proveedor.");
      return;
    }
    void post(
      "pay",
      "/api/supplier-payments",
      {
        supplierInvoiceId: invoice.id,
        amountApplied: Number(invoice.totalAmount),
        postedAt: new Date().toISOString(),
      },
      { failure: "No se pudo registrar el pago.", success: `Pago de ${formatMoney(invoice.totalAmount)} registrado.` },
    );
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

      <PipelineStep
        error={stepErrors.receive}
        id="purchase-flow-receive"
        loading={loading}
        onSubmit={() => receiveOrder(activeOrderId)}
        submitDisabled={loading || !activeOrderId}
        submitLabel="Recepcionar mercancía"
        title="1) Pedido a recepción"
      >
        <PipelineSelect
          emptyMessage="No hay pedidos pendientes de recepción. Crea un pedido con proveedor antes de recepcionar mercancía."
          format={(order) => `${order.number} · ${order.supplierName}`}
          id="purchase-flow-order"
          items={receivableOrders}
          label="Pedido de compra"
          onChange={setSelectedOrderId}
          value={activeOrderId}
        />
      </PipelineStep>

      <PipelineStep
        error={stepErrors.invoice}
        id="purchase-flow-invoice"
        loading={loading}
        onSubmit={() => invoiceReceipt(activeReceiptId)}
        submitDisabled={loading || !activeReceiptId}
        submitLabel="Generar factura proveedor"
        title="2) Recepción a factura proveedor"
      >
        <PipelineSelect
          emptyMessage="No hay recepciones facturables. Primero recepciona un pedido con líneas de compra."
          format={(receipt) => {
            const order = orders.find((candidate) => candidate.id === receipt.purchaseOrderId);
            return `${order?.number ?? "Pedido"} · recepción ${receipt.number}`;
          }}
          id="purchase-flow-receipt"
          items={invoiceableReceipts}
          label="Recepción"
          onChange={setSelectedReceiptId}
          value={activeReceiptId}
        />
      </PipelineStep>

      <PipelineStep
        error={stepErrors.pay}
        id="purchase-flow-pay"
        loading={loading}
        onSubmit={() => payInvoice(activeInvoiceId)}
        submitDisabled={loading || !activeInvoiceId}
        submitLabel="Registrar pago"
        title="3) Factura proveedor a pago"
      >
        <PipelineSelect
          emptyMessage="No hay facturas proveedor pendientes de pago. Genera primero la factura desde una recepción."
          format={(invoice) => `${invoice.number} · ${formatMoney(invoice.totalAmount ?? 0)}`}
          id="purchase-flow-supplier-invoice"
          items={payableInvoices}
          label="Factura de proveedor"
          onChange={setSelectedInvoiceId}
          value={activeInvoiceId}
        />
      </PipelineStep>

      <div className="space-y-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3">
        <h3 className="font-mono text-xs font-bold">Transiciones válidas por documento</h3>
        {orders.length + receipts.length + invoices.length === 0 ? (
          <p className="rounded-[2px] border border-dashed border-window-shadow bg-window-surface p-3 text-xs text-muted-foreground">
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
              status={statusLabel(purchaseOrderStatusLabels, order.status)}
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
              label={`Recepción ${receipt.number}${order ? ` · pedido ${order.number}` : ""}`}
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
