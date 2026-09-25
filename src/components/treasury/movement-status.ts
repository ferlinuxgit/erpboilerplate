/** Estados de un movimiento bancario en lenguaje llano (sin jerga contable). */

export type MovementStatusKey = "PENDING" | "RECONCILED" | "ASSIGNED";

export const movementStatusLabels: Record<MovementStatusKey, string> = {
  PENDING: "Pendiente de conciliar",
  RECONCILED: "Conciliado",
  ASSIGNED: "Asignado a cuenta",
};

export const movementStatusDescriptions: Record<MovementStatusKey, string> = {
  PENDING: "Todavía no has dicho a qué corresponde. Mientras tanto se guarda como «pendiente de identificar» (cuenta 555).",
  RECONCILED: "Vinculado a su cobro o pago: el banco y las facturas cuadran.",
  ASSIGNED: "Registrado directamente como gasto o ingreso (comisiones, cuotas, impuestos…).",
};

export const PENDING_ACCOUNT_EXPLANATION =
  "Cuando importas un extracto, cada movimiento entra en el banco al momento, pero hasta que dices qué es (un cobro, un pago, una comisión…) queda apartado en la cuenta 555 «Pendiente de identificar». Al conciliarlo desaparece de ahí y el banco solo cuenta una vez.";

export function movementStatusKey(status: string, resolution?: string | null): MovementStatusKey {
  if (status !== "RECONCILED") return "PENDING";
  return resolution === "ACCOUNT" ? "ASSIGNED" : "RECONCILED";
}

export function movementStatusTone(key: MovementStatusKey): "warning" | "success" | "info" {
  return key === "PENDING" ? "warning" : key === "ASSIGNED" ? "info" : "success";
}
