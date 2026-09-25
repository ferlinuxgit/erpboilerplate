export const directDebitStatusLabels: Record<string, string> = {
  GENERATED: "Pendiente de enviar",
  COLLECTED: "Cobrada · cobros registrados",
  CANCELLED: "Descartada",
};

export function directDebitStatusTone(status: string): "warning" | "success" | "neutral" {
  return status === "GENERATED" ? "warning" : status === "COLLECTED" ? "success" : "neutral";
}

export const directDebitItemStatusLabels: Record<string, string> = {
  PENDING: "En el fichero",
  COLLECTED: "Cobrado",
  RETURNED: "Devuelto",
};

export function directDebitItemStatusTone(status: string): "warning" | "success" | "danger" | "neutral" {
  return status === "COLLECTED" ? "success" : status === "RETURNED" ? "danger" : "neutral";
}

export const sequenceTypeHelp: Record<string, string> = {
  FRST: "Primer recibo",
  RCUR: "Recurrente",
  OOFF: "Único",
  FNAL: "Último",
};
