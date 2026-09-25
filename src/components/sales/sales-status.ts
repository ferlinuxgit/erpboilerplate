import { salesDocumentStatusLabels, salesDocumentStatusTone, statusLabel, type StatusTone } from "@/lib/status-labels";

/**
 * Etiquetas de estado de documentos de venta en lenguaje del usuario. En presupuestos
 * "CONFIRMED" significa que el cliente lo aceptó.
 */
const quoteLabels: Record<string, string> = {
  ...salesDocumentStatusLabels,
  CONFIRMED: "Aceptado",
  REJECTED: "Rechazado",
  INVOICED: "Facturado",
};

const documentLabels: Record<string, string> = { ...salesDocumentStatusLabels, REJECTED: "Rechazado" };

export function salesStatusLabel(status: string, kind: "quote" | "order" | "delivery" = "order") {
  return statusLabel(kind === "quote" ? quoteLabels : documentLabels, status);
}

export function salesStatusTone(status: string): StatusTone {
  if (status === "REJECTED") return "danger";
  return salesDocumentStatusTone(status);
}

export function salesStatusOptions(kind: "quote" | "order" | "delivery") {
  const labels = kind === "quote" ? quoteLabels : documentLabels;
  const keys = kind === "quote"
    ? ["DRAFT", "SENT", "CONFIRMED", "REJECTED", "INVOICED", "VOID"]
    : kind === "order"
      ? ["DRAFT", "CONFIRMED", "DELIVERED", "INVOICED", "VOID"]
      : ["DELIVERED", "INVOICED", "VOID"];
  return keys.map((value) => ({ value, label: labels[value] ?? value }));
}
