export type SalesDocumentStatus = "DRAFT" | "SENT" | "CONFIRMED" | "DELIVERED" | "INVOICED" | "PAID" | "VOID";

export type PipelineStage = {
  key: string;
  label: string;
  count: number;
  nextActionLabel?: string;
  emptyState: string;
};

export type TransitionResult =
  | { allowed: true; action: string; actionLabel: string }
  | { allowed: false; reason: string };

export function getSalesQuoteTransition(status: SalesDocumentStatus): TransitionResult {
  if (status === "DRAFT" || status === "SENT") return { allowed: true, action: "quote-to-order", actionLabel: "Convertir a pedido" };
  if (status === "VOID") return { allowed: false, reason: "Presupuesto anulado; crea o reactiva un presupuesto antes de convertirlo." };
  return { allowed: false, reason: "Solo los presupuestos en borrador o enviados pueden convertirse en pedido." };
}

export function getSalesOrderTransition(status: SalesDocumentStatus): TransitionResult {
  if (status === "CONFIRMED") return { allowed: true, action: "order-to-delivery", actionLabel: "Generar albarán" };
  if (status === "DRAFT" || status === "SENT") {
    return { allowed: false, reason: "Confirma el pedido antes de preparar el albarán." };
  }
  if (status === "VOID") return { allowed: false, reason: "Pedido anulado; no se puede entregar." };
  return { allowed: false, reason: "Este pedido ya fue entregado o facturado." };
}

export function getDeliveryNoteTransition(status: SalesDocumentStatus): TransitionResult {
  if (status === "DELIVERED") return { allowed: true, action: "delivery-to-invoice", actionLabel: "Generar factura" };
  if (status === "VOID") return { allowed: false, reason: "Albarán anulado; no se puede facturar." };
  if (status === "INVOICED" || status === "PAID") return { allowed: false, reason: "Este albarán ya fue facturado." };
  return { allowed: false, reason: "Marca el albarán como entregado antes de emitir factura." };
}

export function assertSalesTransitionAllowed(result: TransitionResult) {
  if (result.allowed === false) throw new Error(result.reason);
}

export function buildSalesPipelineStages(input: {
  customersCount?: number;
  quotesCount: number;
  ordersCount: number;
  deliveryNotesCount: number;
  invoicesCount: number;
}): PipelineStage[] {
  const customerStage: PipelineStage[] =
    input.customersCount === undefined
      ? []
      : [
          {
            key: "customers",
            label: "Clientes",
            count: input.customersCount,
            nextActionLabel: "Crear presupuesto",
            emptyState: "Necesitas al menos un cliente para iniciar el ciclo de ventas.",
          },
        ];

  return [
    ...customerStage,
    {
      key: "quotes",
      label: "Presupuestos",
      count: input.quotesCount,
      nextActionLabel: "Convertir en pedido",
      emptyState: "Crea un presupuesto para poder generar el pedido de venta.",
    },
    {
      key: "orders",
      label: "Pedidos",
      count: input.ordersCount,
      nextActionLabel: "Pedido → albarán",
      emptyState: "Convierte un presupuesto confirmado para habilitar albaranes.",
    },
    {
      key: "delivery-notes",
      label: "Albaranes",
      count: input.deliveryNotesCount,
      nextActionLabel: "Albarán → factura",
      emptyState: "Genera un albarán entregado antes de facturar.",
    },
    {
      key: "invoices",
      label: "Facturas",
      count: input.invoicesCount,
      emptyState: "Las facturas aparecerán al completar el flujo de albarán.",
    },
  ];
}

export function getPurchaseOrderReceiptTransition(input: { status: string; hasReceipt: boolean; hasLines: boolean }): TransitionResult {
  if (input.hasReceipt) return { allowed: false, reason: "El pedido ya tiene una recepción asociada." };
  if (!input.hasLines) return { allowed: false, reason: "Añade al menos una línea al pedido antes de recepcionar mercancía." };
  if (input.status === "VOID" || input.status === "CANCELLED") return { allowed: false, reason: "Pedido de compra anulado; no se puede recepcionar." };
  return { allowed: true, action: "order-to-receipt", actionLabel: "Recepcionar mercancía" };
}

export function getGoodsReceiptInvoiceTransition(input: { hasSupplierInvoice: boolean; hasLines: boolean }): TransitionResult {
  if (input.hasSupplierInvoice) return { allowed: false, reason: "Ya existe una factura de proveedor para este tramo del ciclo." };
  if (!input.hasLines) return { allowed: false, reason: "La recepción necesita líneas de pedido para crear la factura del proveedor." };
  return { allowed: true, action: "receipt-to-invoice", actionLabel: "Crear factura proveedor" };
}

export function getSupplierInvoicePaymentTransition(input: { totalAmount: number; paidAmount: number }): TransitionResult {
  if (input.totalAmount <= 0) return { allowed: false, reason: "La factura debe tener importe positivo para registrar un pago." };
  if (input.paidAmount >= input.totalAmount) return { allowed: false, reason: "La factura proveedor ya está pagada." };
  return { allowed: true, action: "invoice-to-payment", actionLabel: "Registrar pago" };
}

type PurchaseReceiptRef = { id: string; purchaseOrderId: string };
type PurchaseOrderLineRef = { purchaseOrderId: string };
type SupplierInvoiceRef = { id: string; number?: string; totalAmount?: string | number; goodsReceiptId?: string | null };
type SupplierPaymentRef = { supplierInvoiceId: string; amount?: string | number; amountApplied?: string | number };

function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function getInvoiceablePurchaseReceipts(input: {
  receipts: PurchaseReceiptRef[];
  orderLines: PurchaseOrderLineRef[];
  invoices: SupplierInvoiceRef[];
}) {
  const orderIdsWithLines = new Set(input.orderLines.map((line) => line.purchaseOrderId));
  const invoicedReceiptIds = new Set(
    input.invoices.map((invoice) => invoice.goodsReceiptId).filter((receiptId): receiptId is string => Boolean(receiptId)),
  );

  return input.receipts.filter((receipt) => orderIdsWithLines.has(receipt.purchaseOrderId) && !invoicedReceiptIds.has(receipt.id));
}

export function getPayableSupplierInvoices(input: { invoices: SupplierInvoiceRef[]; payments: SupplierPaymentRef[] }) {
  const paidAmountByInvoice = new Map<string, number>();
  input.payments.forEach((payment) => {
    paidAmountByInvoice.set(
      payment.supplierInvoiceId,
      (paidAmountByInvoice.get(payment.supplierInvoiceId) ?? 0) + toAmount(payment.amountApplied ?? payment.amount),
    );
  });

  return input.invoices
    .map((invoice) => {
      const totalAmount = toAmount(invoice.totalAmount);
      const paidAmount = paidAmountByInvoice.get(invoice.id) ?? 0;
      return {
        ...invoice,
        paidAmount,
        outstandingAmount: Math.max(totalAmount - paidAmount, 0),
      };
    })
    .filter((invoice) => getSupplierInvoicePaymentTransition({ totalAmount: toAmount(invoice.totalAmount), paidAmount: invoice.paidAmount }).allowed);
}

export function buildPurchasePipelineStages(input: {
  ordersCount: number;
  receiptsCount: number;
  supplierInvoicesCount: number;
  supplierPaymentsCount: number;
}): PipelineStage[] {
  return [
    {
      key: "purchase-orders",
      label: "Pedidos compra",
      count: input.ordersCount,
      nextActionLabel: "Pedido → recepción",
      emptyState: "Crea un pedido de compra con proveedor y líneas.",
    },
    {
      key: "goods-receipts",
      label: "Recepciones",
      count: input.receiptsCount,
      nextActionLabel: "Recepción → factura proveedor",
      emptyState: "Recepciona mercancía antes de registrar la factura del proveedor.",
    },
    {
      key: "supplier-invoices",
      label: "Facturas proveedor",
      count: input.supplierInvoicesCount,
      nextActionLabel: "Registrar pago",
      emptyState: "Crea la factura desde una recepción validada.",
    },
    {
      key: "supplier-payments",
      label: "Pagos proveedor",
      count: input.supplierPaymentsCount,
      emptyState: "Los pagos aparecerán al liquidar facturas de proveedor.",
    },
  ];
}
