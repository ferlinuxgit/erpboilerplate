/**
 * Repartos de un movimiento bancario (funciones puras, usables en cliente y servidor):
 * validación de la suma y de los tipos, y utilidades de texto para la conciliación.
 */

export type AllocationType = "CUSTOMER_INVOICE" | "SUPPLIER_INVOICE" | "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT" | "ACCOUNT";

/**
 * Parte de un movimiento. `amount` va en el sentido del movimiento (siempre > 0 salvo en cuentas,
 * donde un importe negativo resta: p. ej. la comisión que el banco descuenta de un cobro).
 */
export type AllocationInput = { type: AllocationType; targetId: string; amount: number; label?: string };

/** Minúsculas, sin tildes y con los signos convertidos en espacios. */
export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toCents(value: number | string) {
  return Math.round(Number(value) * 100);
}

/** Texto propuesto para "Recordar para la próxima vez": las primeras palabras sin cifras ni fechas. */
export function proposeRuleConcept(description: string) {
  const words = normalizeText(description)
    .split(" ")
    .filter((word) => word.length >= 3 && !/\d/.test(word));
  return words.slice(0, 3).join(" ");
}

/**
 * Valida un reparto antes de aplicarlo: tipos coherentes con el signo del movimiento, importes
 * distintos de cero, sin documentos repetidos y suma exacta (en céntimos) al importe del movimiento.
 */
export function validateAllocations(movementAmount: number, allocations: AllocationInput[]) {
  const errors: string[] = [];
  const isDeposit = movementAmount >= 0;
  const targetCents = Math.abs(toCents(movementAmount));
  if (allocations.length === 0) errors.push("Indica al menos una factura, cobro/pago o cuenta.");
  if (allocations.length > 50) errors.push("Un movimiento se puede repartir como máximo entre 50 partidas.");
  const seen = new Set<string>();
  let sumCents = 0;
  for (const allocation of allocations) {
    const cents = toCents(allocation.amount);
    if (!Number.isFinite(cents) || cents === 0) {
      errors.push("Cada partida debe tener un importe distinto de cero.");
      continue;
    }
    if (allocation.type !== "ACCOUNT") {
      if (cents < 0) errors.push("El importe aplicado a una factura o a un cobro/pago debe ser positivo.");
      const customerSide = allocation.type === "CUSTOMER_INVOICE" || allocation.type === "CUSTOMER_PAYMENT";
      if (customerSide !== isDeposit) {
        errors.push(isDeposit
          ? "Un ingreso solo se aplica a facturas o cobros de clientes (o a una cuenta)."
          : "Un cargo solo se aplica a facturas o pagos de proveedores (o a una cuenta).");
      }
      const key = `${allocation.type}:${allocation.targetId}`;
      if (seen.has(key)) errors.push("La misma factura o cobro/pago aparece dos veces en el reparto.");
      seen.add(key);
    }
    sumCents += cents;
  }
  if (allocations.length > 0 && sumCents !== targetCents) {
    const difference = (targetCents - sumCents) / 100;
    errors.push(`El reparto suma ${(sumCents / 100).toFixed(2)} y el movimiento es de ${(targetCents / 100).toFixed(2)}: ${difference > 0 ? "faltan" : "sobran"} ${Math.abs(difference).toFixed(2)}.`);
  }
  return [...new Set(errors)];
}

/** Cómo queda resuelto el movimiento según sus partidas (se guarda en `bankTransaction.resolution`). */
export function resolutionOf(allocations: Pick<AllocationInput, "type">[]): "PAYMENT" | "ACCOUNT" | "MIXED" {
  const accounts = allocations.filter((allocation) => allocation.type === "ACCOUNT").length;
  if (accounts === 0) return "PAYMENT";
  return accounts === allocations.length ? "ACCOUNT" : "MIXED";
}
