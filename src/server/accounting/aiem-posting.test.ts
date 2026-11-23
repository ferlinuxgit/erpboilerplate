import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildCreditNoteLines, buildSalesInvoiceLines, splitAiemOutput } from "@/server/accounting/auto-post";

/** El AIEM repercutido va a su propia cuenta (4777), separado del IGIC de la 477. */
const accounts = { customer: "430", sales: "700", vatOutput: "477", withholdingReceivable: "473" };

function net(lines: Array<{ accountId: string; debit: number | string; credit: number | string }>, accountId: string) {
  return lines.filter((line) => line.accountId === accountId).reduce((total, line) => total + Math.round(Number(line.credit) * 100) - Math.round(Number(line.debit) * 100), 0);
}

describe("AIEM en el asiento de ventas", () => {
  it("factura: 100 de base, IGIC 7 y AIEM 5 → 477 = 7 y 4777 = 5", () => {
    const lines = splitAiemOutput(buildSalesInvoiceLines(accounts, { subtotal: 100, taxAmount: 12, totalAmount: 112 }), "477", "4777", 500);
    expect(net(lines, "477")).toBe(700);
    expect(net(lines, "4777")).toBe(500);
    expect(net(lines, "430")).toBe(-11_200);
    expect(lines.reduce((total, line) => total + Number(line.debit) - Number(line.credit), 0)).toBeCloseTo(0, 6);
  });

  it("abono: los importes negativos invierten también la 4777", () => {
    const lines = splitAiemOutput(buildCreditNoteLines(accounts, { subtotal: -100, taxAmount: -12, totalAmount: -112 }), "477", "4777", -500);
    expect(net(lines, "477")).toBe(-700);
    expect(net(lines, "4777")).toBe(-500);
  });

  it("solo AIEM (IGIC al 0 %): la 477 desaparece del asiento", () => {
    const lines = splitAiemOutput(buildSalesInvoiceLines(accounts, { subtotal: 100, taxAmount: 5, totalAmount: 105 }), "477", "4777", 500);
    expect(lines.some((line) => line.accountId === "477")).toBe(false);
    expect(net(lines, "4777")).toBe(500);
  });
});
