import { describe, expect, it } from "vitest";

import {
  buildPurchasePipelineStages,
  buildSalesPipelineStages,
  getDeliveryNoteTransition,
  getInvoiceablePurchaseReceipts,
  getPayableSupplierInvoices,
  getPurchaseOrderReceiptTransition,
  getSalesOrderTransition,
  getSalesQuoteTransition,
  getSupplierInvoicePaymentTransition,
} from "./document-pipelines";

describe("document pipeline transitions", () => {
  it("allows only the valid sales happy path transitions", () => {
    expect(getSalesQuoteTransition("DRAFT")).toMatchObject({ allowed: true, action: "quote-to-order" });
    expect(getSalesQuoteTransition("SENT")).toMatchObject({ allowed: true, action: "quote-to-order" });
    expect(getSalesQuoteTransition("CONFIRMED")).toMatchObject({
      allowed: false,
      reason: "Solo los presupuestos en borrador o enviados pueden convertirse en pedido.",
    });

    expect(getSalesOrderTransition("CONFIRMED")).toMatchObject({ allowed: true, action: "order-to-delivery" });
    expect(getSalesOrderTransition("DRAFT")).toMatchObject({
      allowed: false,
      reason: "Confirma el pedido antes de preparar el albarán.",
    });

    expect(getDeliveryNoteTransition("DELIVERED")).toMatchObject({ allowed: true, action: "delivery-to-invoice" });
    expect(getDeliveryNoteTransition("DRAFT")).toMatchObject({
      allowed: false,
      reason: "Marca el albarán como entregado antes de emitir factura.",
    });
  });

  it("surfaces purchase prerequisites before advancing the flow", () => {
    expect(getPurchaseOrderReceiptTransition({ status: "DRAFT", hasReceipt: false, hasLines: true })).toMatchObject({
      allowed: true,
      action: "order-to-receipt",
    });
    expect(getPurchaseOrderReceiptTransition({ status: "DRAFT", hasReceipt: false, hasLines: false })).toMatchObject({
      allowed: false,
      reason: "Añade al menos una línea al pedido antes de recepcionar mercancía.",
    });
    expect(getPurchaseOrderReceiptTransition({ status: "RECEIVED", hasReceipt: true, hasLines: true })).toMatchObject({
      allowed: false,
      reason: "El pedido ya tiene una recepción asociada.",
    });
    expect(getSupplierInvoicePaymentTransition({ totalAmount: 100, paidAmount: 0 })).toMatchObject({
      allowed: true,
      action: "invoice-to-payment",
    });
    expect(getSupplierInvoicePaymentTransition({ totalAmount: 100, paidAmount: 100 })).toMatchObject({
      allowed: false,
      reason: "La factura proveedor ya está pagada.",
    });
  });

  it("keeps purchase receipt to invoice actions valid per receipt", () => {
    const receipts = [
      { id: "receipt-open", purchaseOrderId: "po-1" },
      { id: "receipt-invoiced", purchaseOrderId: "po-2" },
      { id: "receipt-without-lines", purchaseOrderId: "po-3" },
    ];
    const orderLines = [
      { id: "line-1", purchaseOrderId: "po-1" },
      { id: "line-2", purchaseOrderId: "po-2" },
    ];
    const invoices = [{ id: "invoice-1", goodsReceiptId: "receipt-invoiced" }];

    expect(getInvoiceablePurchaseReceipts({ receipts, orderLines, invoices })).toEqual([
      expect.objectContaining({ id: "receipt-open" }),
    ]);
  });

  it("keeps partially paid supplier invoices payable and blocks fully paid ones", () => {
    const invoices = [
      { id: "invoice-open", totalAmount: "100.00" },
      { id: "invoice-partial", totalAmount: "100.00" },
      { id: "invoice-paid", totalAmount: "100.00" },
    ];
    const payments = [
      { id: "payment-1", supplierInvoiceId: "invoice-partial", amount: "40.00" },
      { id: "payment-2", supplierInvoiceId: "invoice-paid", amount: "70.00" },
      { id: "payment-3", supplierInvoiceId: "invoice-paid", amount: "30.00" },
    ];

    expect(getPayableSupplierInvoices({ invoices, payments })).toEqual([
      expect.objectContaining({ id: "invoice-open", paidAmount: 0, outstandingAmount: 100 }),
      expect.objectContaining({ id: "invoice-partial", paidAmount: 40, outstandingAmount: 60 }),
    ]);
  });

  it("builds stage summaries with counts and prerequisite copy", () => {
    const salesStages = buildSalesPipelineStages({ quotesCount: 1, ordersCount: 2, deliveryNotesCount: 3, invoicesCount: 4 });
    expect(salesStages.map((stage) => stage.count)).toEqual([1, 2, 3, 4]);
    expect(salesStages[0]?.nextActionLabel).toBe("Convertir en pedido");

    const salesStagesWithCustomers = buildSalesPipelineStages({
      customersCount: 0,
      quotesCount: 1,
      ordersCount: 2,
      deliveryNotesCount: 3,
      invoicesCount: 4,
    });
    expect(salesStagesWithCustomers[0]).toMatchObject({
      key: "customers",
      count: 0,
      emptyState: "Necesitas al menos un cliente para iniciar el ciclo de ventas.",
    });

    const purchaseStages = buildPurchasePipelineStages({
      ordersCount: 0,
      receiptsCount: 1,
      supplierInvoicesCount: 2,
      supplierPaymentsCount: 3,
    });
    expect(purchaseStages[0]).toMatchObject({ count: 0, emptyState: "Crea un pedido de compra con proveedor y líneas." });
    expect(purchaseStages[2]?.nextActionLabel).toBe("Registrar pago");
  });
});
