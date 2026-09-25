/**
 * Factura de proveedor a partir de una o varias recepciones de un pedido de compra.
 * La trazabilidad es por línea de pedido (no por artículo): un pedido puede repetir un
 * artículo en varias líneas con precios distintos. Módulo puro, compartido por cliente y servidor.
 */

export type OrderLineRef = {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
};

/** Cantidad registrada contra el pedido (recibida o facturada). */
export type QuantityRecord = {
  purchaseOrderLineId: string | null;
  itemId: string | null;
  quantity: number;
};

const EPSILON = 0.0005;

/**
 * Suma cantidades por línea de pedido. Los registros antiguos sin línea de pedido se reparten
 * por artículo entre las líneas que aún admiten cantidad, en el orden del pedido.
 */
export function quantitiesByOrderLine(orderLines: readonly OrderLineRef[], records: readonly QuantityRecord[]) {
  const byLine = new Map<string, number>();
  const legacyByItem = new Map<string, number>();
  const known = new Set(orderLines.map((line) => line.id));
  for (const record of records) {
    if (record.purchaseOrderLineId && known.has(record.purchaseOrderLineId)) {
      byLine.set(record.purchaseOrderLineId, (byLine.get(record.purchaseOrderLineId) ?? 0) + record.quantity);
    } else if (record.itemId) {
      legacyByItem.set(record.itemId, (legacyByItem.get(record.itemId) ?? 0) + record.quantity);
    }
  }
  for (const line of orderLines) {
    if (!line.itemId) continue;
    const pending = legacyByItem.get(line.itemId) ?? 0;
    if (pending <= EPSILON) continue;
    const room = Math.max(line.quantity - (byLine.get(line.id) ?? 0), 0);
    const allocated = Math.min(pending, room);
    if (allocated <= 0) continue;
    byLine.set(line.id, (byLine.get(line.id) ?? 0) + allocated);
    legacyByItem.set(line.itemId, pending - allocated);
  }
  return byLine;
}

/**
 * Comprueba que lo facturado (antes + ahora) no supera lo pedido ni lo recibido en cada línea.
 * Devuelve el mensaje de error para el usuario o `null` si todo cuadra.
 */
export function invoiceQuantityProblem(input: {
  orderLines: readonly OrderLineRef[];
  received: ReadonlyMap<string, number>;
  alreadyInvoiced: ReadonlyMap<string, number>;
  requested: ReadonlyMap<string, number>;
}): string | null {
  for (const [lineId, requested] of input.requested) {
    const line = input.orderLines.find((candidate) => candidate.id === lineId);
    if (!line) return "Una línea de la factura no pertenece al pedido de compra.";
    const cumulative = (input.alreadyInvoiced.get(lineId) ?? 0) + requested;
    if (cumulative > line.quantity + EPSILON) return `«${line.description}»: la cantidad facturada acumulada supera la pedida.`;
    if (cumulative > (input.received.get(lineId) ?? 0) + EPSILON) return `«${line.description}»: la cantidad facturada acumulada supera la recibida.`;
  }
  return null;
}

export function isOrderFullyInvoiced(orderLines: readonly OrderLineRef[], invoicedAfter: ReadonlyMap<string, number>) {
  const stockLines = orderLines.filter((line) => line.quantity > 0);
  return stockLines.length > 0 && stockLines.every((line) => (invoicedAfter.get(line.id) ?? 0) >= line.quantity - EPSILON);
}

export type ReceiptLineRef = {
  id: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  purchaseOrderLineId: string | null;
  itemId: string | null;
  itemName: string | null;
  quantity: number;
};

export type ReceiptInvoiceLineDraft = {
  goodsReceiptLineId: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  purchaseOrderLineId: string | null;
  itemId: string | null;
  description: string;
  quantity: number;
  /** Precio acordado en el pedido (para avisar de diferencias). */
  orderUnitPrice: number;
  unitPrice: number;
  taxRate: number;
  /** De dónde sale el IVA propuesto; "none" obliga a elegirlo (nunca 0 % en silencio). */
  taxRateSource: "item" | "default" | "none";
};

/**
 * Líneas de factura propuestas para las recepciones elegidas: una por línea recibida, con el
 * precio del pedido y el IVA del artículo; si el artículo no tiene IVA, el IVA por defecto de
 * la empresa (avisando); si tampoco hay, se deja vacío para que el usuario lo indique.
 */
export function buildReceiptInvoiceLines(input: {
  receiptLines: readonly ReceiptLineRef[];
  orderLines: readonly OrderLineRef[];
  itemTaxRates: ReadonlyMap<string, number>;
  fallbackTaxRate?: number | null;
}): ReceiptInvoiceLineDraft[] {
  const orderLineById = new Map(input.orderLines.map((line) => [line.id, line]));
  return input.receiptLines.map((receiptLine) => {
    const orderLine = (receiptLine.purchaseOrderLineId ? orderLineById.get(receiptLine.purchaseOrderLineId) : undefined)
      ?? input.orderLines.find((line) => line.itemId !== null && line.itemId === receiptLine.itemId);
    const itemRate = receiptLine.itemId ? input.itemTaxRates.get(receiptLine.itemId) : undefined;
    const fallbackRate = input.fallbackTaxRate ?? undefined;
    const taxRate = itemRate ?? fallbackRate;
    return {
      goodsReceiptLineId: receiptLine.id,
      goodsReceiptId: receiptLine.goodsReceiptId,
      goodsReceiptNumber: receiptLine.goodsReceiptNumber,
      purchaseOrderLineId: orderLine?.id ?? receiptLine.purchaseOrderLineId,
      itemId: receiptLine.itemId,
      description: orderLine?.description ?? receiptLine.itemName ?? "Mercancía recibida",
      quantity: receiptLine.quantity,
      orderUnitPrice: orderLine?.unitPrice ?? 0,
      unitPrice: orderLine?.unitPrice ?? 0,
      taxRate: taxRate ?? Number.NaN,
      taxRateSource: itemRate !== undefined ? "item" : fallbackRate !== undefined ? "default" : "none",
    };
  });
}

/** Diferencia entre el precio facturado y el del pedido. */
export function priceVariance(orderUnitPrice: number, invoiceUnitPrice: number) {
  const difference = Math.round((invoiceUnitPrice - orderUnitPrice) * 100) / 100;
  const pct = orderUnitPrice > 0 ? (difference / orderUnitPrice) * 100 : invoiceUnitPrice > 0 ? 100 : 0;
  return { difference, pct, significant: Math.abs(difference) >= 0.01 };
}

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

/**
 * Totales de la factura propuesta (base por línea redondeada a céntimos, IVA por línea).
 * Coincide con el motor fiscal para IVA sin recargo ni retención.
 */
export function receiptInvoiceTotals(lines: ReadonlyArray<{ quantity: number; unitPrice: number; taxRate: number }>) {
  let subtotalCents = 0;
  const taxByRate = new Map<number, number>();
  for (const line of lines) {
    const base = cents(line.quantity * line.unitPrice);
    subtotalCents += base;
    const rate = Number.isFinite(line.taxRate) ? line.taxRate : 0;
    taxByRate.set(rate, (taxByRate.get(rate) ?? 0) + base);
  }
  let taxCents = 0;
  for (const [rate, base] of taxByRate) taxCents += Math.round((base * rate) / 100);
  return { subtotal: subtotalCents / 100, tax: taxCents / 100, total: (subtotalCents + taxCents) / 100 };
}
