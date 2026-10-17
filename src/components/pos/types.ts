/** Datos serializados que las páginas del TPV pasan a sus componentes cliente. */
export type PosCatalogItem = {
  id: string;
  sku: string;
  name: string;
  /** Precio sin IVA. */
  unitPrice: number;
  isService: boolean;
  categoryName: string | null;
  taxId: string | null;
  taxRate: number;
  stock: number | null;
};

export type PosRegisterView = { id: string; name: string; cardEnabled: boolean; simplifiedLimit: number; warehouseName: string | null };

export type PosSessionView = { id: string; openedAt: string; openingCash: number };

export type PosTicketView = {
  id: string;
  kind: "SALE" | "REFUND";
  invoiceId: string;
  number: string;
  totalAmount: number;
  cashAmount: number;
  cardAmount: number;
  createdAt: string;
  /** Importe ya devuelto del ticket (devoluciones parciales o completa). */
  refundedAmount: number;
};

export type PosCustomer = { id: string; name: string; taxId: string | null };

export function ticketPrintUrl(invoiceId: string) {
  return `/pos/tickets/${invoiceId}?print=1`;
}

export function openTicketPrint(invoiceId: string) {
  window.open(ticketPrintUrl(invoiceId), "_blank", "noopener,width=420,height=720");
}
