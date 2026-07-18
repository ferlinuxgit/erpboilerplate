export type BankCsvRow = {
  postedAt: Date;
  amount: number;
  description: string;
};

export function parseBankCsv(content: string): BankCsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];

  const rows: BankCsvRow[] = [];
  for (const line of lines.slice(1, 5_001)) {
    const [postedAtRaw, amountRaw, descriptionRaw] = line.split(";");
    if (!postedAtRaw || !amountRaw || !descriptionRaw) continue;
    const amount = Number(amountRaw.replace(",", "."));
    if (Number.isNaN(amount)) continue;
    const postedAt = new Date(postedAtRaw);
    if (Number.isNaN(postedAt.getTime())) continue;
    rows.push({ postedAt, amount, description: descriptionRaw.trim() });
  }
  return rows;
}
