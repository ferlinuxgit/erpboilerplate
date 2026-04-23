type LineInput = {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
  retentionRate?: number;
};

type ComputedLine = {
  base: number;
  taxAmount: number;
  retentionAmount: number;
  total: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeLineAmounts(input: LineInput): ComputedLine {
  const discountPct = input.discountPct ?? 0;
  const taxRate = input.taxRate ?? 0;
  const retentionRate = input.retentionRate ?? 0;

  const grossBase = input.quantity * input.unitPrice;
  const base = round2(grossBase * (1 - discountPct / 100));
  const taxAmount = round2(base * (taxRate / 100));
  const retentionAmount = round2(base * (retentionRate / 100));
  const total = round2(base + taxAmount - retentionAmount);

  return { base, taxAmount, retentionAmount, total };
}

export function computeDocumentTotals(lines: LineInput[]) {
  return lines.reduce(
    (acc, line) => {
      const computed = computeLineAmounts(line);
      return {
        subtotal: round2(acc.subtotal + computed.base),
        taxAmount: round2(acc.taxAmount + computed.taxAmount),
        retentionAmount: round2(acc.retentionAmount + computed.retentionAmount),
        totalAmount: round2(acc.totalAmount + computed.total),
      };
    },
    { subtotal: 0, taxAmount: 0, retentionAmount: 0, totalAmount: 0 },
  );
}
