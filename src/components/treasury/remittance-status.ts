export const remittanceStatusLabels: Record<string, string> = {
  GENERATED: "Pendiente de enviar",
  CONFIRMED: "Enviada · pagos registrados",
  CANCELLED: "Descartada",
};

export function remittanceStatusTone(status: string): "warning" | "success" | "neutral" {
  return status === "GENERATED" ? "warning" : status === "CONFIRMED" ? "success" : "neutral";
}
