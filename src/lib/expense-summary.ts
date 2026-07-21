type ExpenseSummaryRow = {
  status: string;
  totalAmount: string | number;
  outstandingAmount: string | number;
  taxAmount: string | number;
};

export function summarizeExpenses(invoices: ExpenseSummaryRow[]) {
  const activeInvoices = invoices.filter((invoice) => invoice.status !== "VOID");
  return {
    activeCount: activeInvoices.length,
    voidCount: invoices.length - activeInvoices.length,
    totalAmount: activeInvoices.reduce((total, invoice) => total + Number(invoice.totalAmount), 0),
    pendingAmount: activeInvoices.reduce((total, invoice) => total + Number(invoice.outstandingAmount), 0),
    inputTaxAmount: activeInvoices.reduce((total, invoice) => total + Number(invoice.taxAmount), 0),
  };
}
