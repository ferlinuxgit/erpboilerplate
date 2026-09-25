/**
 * Preselección de forma de pago y cuenta bancaria al pagar a un proveedor: evita que los
 * pagos queden "sin especificar" (y sin conciliar) cuando la respuesta es evidente.
 */

export type PaymentMethodOption = { id: string; name: string; type: string; bankAccountId: string | null; isDefault: boolean };
export type BankAccountOption = { id: string; bankName: string; iban: string; isActive: boolean };

/** Cuenta que corresponde a una forma de pago: la suya si está activa o, si solo hay una cuenta activa, esa. */
export function bankAccountForMethod(method: PaymentMethodOption | undefined, accounts: readonly BankAccountOption[]) {
  const active = accounts.filter((account) => account.isActive);
  if (method?.bankAccountId && active.some((account) => account.id === method.bankAccountId)) return method.bankAccountId;
  // En efectivo no se propone banco.
  if (method?.type === "CASH") return "";
  return active.length === 1 ? active[0].id : "";
}

export function preselectPaymentOptions(input: {
  methods: readonly PaymentMethodOption[];
  accounts: readonly BankAccountOption[];
  supplierPaymentMethodId?: string | null;
}) {
  const method = input.methods.find((candidate) => candidate.id === input.supplierPaymentMethodId)
    ?? input.methods.find((candidate) => candidate.isDefault)
    ?? (input.methods.length === 1 ? input.methods[0] : undefined);
  return { paymentMethodId: method?.id ?? "", bankAccountId: bankAccountForMethod(method, input.accounts) };
}
