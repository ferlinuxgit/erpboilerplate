import { describe, expect, it } from "vitest";

import { bankAccountForMethod, preselectPaymentOptions, type BankAccountOption, type PaymentMethodOption } from "./payment-defaults";

const accounts: BankAccountOption[] = [
  { id: "bank-1", bankName: "Banco A", iban: "ES00 1", isActive: true },
  { id: "bank-2", bankName: "Banco B", iban: "ES00 2", isActive: true },
  { id: "bank-old", bankName: "Banco viejo", iban: "ES00 3", isActive: false },
];

const methods: PaymentMethodOption[] = [
  { id: "transfer-b", name: "Transferencia B", type: "BANK_TRANSFER", bankAccountId: "bank-2", isDefault: false },
  { id: "transfer-a", name: "Transferencia A", type: "BANK_TRANSFER", bankAccountId: "bank-1", isDefault: true },
  { id: "cash", name: "Efectivo", type: "CASH", bankAccountId: null, isDefault: false },
];

describe("preselectPaymentOptions", () => {
  it("uses the supplier's usual payment method and its bank account", () => {
    expect(preselectPaymentOptions({ methods, accounts, supplierPaymentMethodId: "transfer-b" })).toEqual({ paymentMethodId: "transfer-b", bankAccountId: "bank-2" });
  });

  it("falls back to the company default method", () => {
    expect(preselectPaymentOptions({ methods, accounts })).toEqual({ paymentMethodId: "transfer-a", bankAccountId: "bank-1" });
  });

  it("selects the only active bank account when there is no method", () => {
    expect(preselectPaymentOptions({ methods: [], accounts: [accounts[0], accounts[2]] })).toEqual({ paymentMethodId: "", bankAccountId: "bank-1" });
  });

  it("does not guess between several accounts", () => {
    expect(preselectPaymentOptions({ methods: [], accounts })).toEqual({ paymentMethodId: "", bankAccountId: "" });
  });
});

describe("bankAccountForMethod", () => {
  it("proposes no bank for cash and ignores archived accounts", () => {
    expect(bankAccountForMethod(methods[2], [accounts[0]])).toBe("");
    expect(bankAccountForMethod({ ...methods[0], bankAccountId: "bank-old" }, [accounts[0], accounts[2]])).toBe("bank-1");
  });
});
