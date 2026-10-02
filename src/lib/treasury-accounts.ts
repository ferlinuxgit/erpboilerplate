/** Cuenta de tesorería: banco con IBAN o pasarela de pago (Stripe, PayPal…) sin IBAN. */
export type TreasuryAccountKind = "BANK" | "PAYMENT_PROVIDER";

export const PAYMENT_PROVIDER_LABEL = "Pasarela de pago";

/** IBAN de un banco o «Pasarela de pago» si no tiene. */
export function treasuryAccountDetail(account: { iban: string | null }) {
  return account.iban || PAYMENT_PROVIDER_LABEL;
}

/** «BBVA · ES12…» o «Stripe · Pasarela de pago», para desplegables y listados. */
export function treasuryAccountLabel(account: { bankName: string; iban: string | null }) {
  return `${account.bankName} · ${treasuryAccountDetail(account)}`;
}
