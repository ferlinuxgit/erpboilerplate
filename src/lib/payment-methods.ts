export const paymentMethodTypeLabels = {
  BANK_TRANSFER: "Transferencia bancaria",
  CARD: "Tarjeta",
  CASH: "Efectivo",
  DIRECT_DEBIT: "Domiciliación bancaria",
} as const;

export type PaymentMethodType = keyof typeof paymentMethodTypeLabels;
