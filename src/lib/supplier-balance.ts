export function calculateSupplierBalance(totalInvoiced: number, totalPaid: number) {
  const netBalance = totalInvoiced - totalPaid;
  return {
    netBalance,
    outstandingBalance: Math.max(netBalance, 0),
    creditBalance: Math.max(-netBalance, 0),
  };
}
