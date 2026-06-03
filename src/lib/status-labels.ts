export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const invoiceStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Emitida",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

export const invoicePaymentStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

export const purchaseOrderStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  APPROVED: "Aprobado",
  RECEIVED: "Recibido",
  INVOICED: "Facturado",
  PAID: "Pagado",
  VOID: "Anulado",
  CANCELLED: "Cancelado",
};

export const salesDocumentStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  CONFIRMED: "Confirmado",
  DELIVERED: "Entregado",
  INVOICED: "Facturado",
  PAID: "Pagado",
  VOID: "Anulado",
};

export const reconciliationStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  RECONCILED: "Conciliado",
};

export const accountTypeLabels: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio neto",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

export function statusLabel(labels: Record<string, string>, status: string) {
  return labels[status] ?? status;
}

export function invoiceStatusTone(status: string): StatusTone {
  if (status === "PAID") return "success";
  if (status === "OVERDUE" || status === "VOID") return "danger";
  if (status === "SENT") return "info";
  return "neutral";
}

export function invoicePaymentStatusTone(status: string): StatusTone {
  if (status === "PAID") return "success";
  if (status === "OVERDUE" || status === "VOID") return "danger";
  if (status === "PARTIAL") return "warning";
  return "neutral";
}

export function purchaseOrderStatusTone(status: string): StatusTone {
  if (status === "RECEIVED" || status === "INVOICED" || status === "PAID") return "success";
  if (status === "SENT" || status === "APPROVED") return "info";
  if (status === "VOID" || status === "CANCELLED") return "danger";
  return "neutral";
}
