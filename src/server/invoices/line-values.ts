import { calculateInvoiceTotals, type InvoiceCalculationLine } from "@/lib/invoice-totals";

export type InvoiceLineInput = InvoiceCalculationLine & {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  retentionRate?: number | null;
  lineTotal?: number | null;
};

export function buildInvoiceLineInsertValues(invoiceId: string, lines: InvoiceLineInput[]) {
  const totals = calculateInvoiceTotals(lines);

  return lines.map((line, index) => ({
    invoiceId,
    ...(line.itemId !== undefined ? { itemId: line.itemId } : {}),
    description: line.description.trim(),
    quantity: line.quantity.toFixed(3),
    unitPrice: line.unitPrice.toFixed(2),
    ...(line.discountPct !== undefined && line.discountPct !== null ? { discountPct: line.discountPct.toFixed(3) } : {}),
    taxRate: line.taxRate.toFixed(3),
    ...(line.retentionRate !== undefined && line.retentionRate !== null ? { retentionRate: line.retentionRate.toFixed(3) } : {}),
    lineTotal: (totals.lines[index]?.lineTotal ?? 0).toFixed(2),
  }));
}
