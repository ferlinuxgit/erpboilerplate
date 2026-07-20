import {
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { listAccounts } from "@/server/accounting/service";

export default async function AccountingReportsPage() {
  const ctx = await requireContext("accounting.read");
  const accounts = (await listAccounts(ctx.company.id)).filter(
    (row) => row.isPostable && Math.abs(row.balance) >= 0.005,
  );
  const value = (type: string, balance: number) =>
    ["LIABILITY", "EQUITY", "REVENUE"].includes(type) ? -balance : balance;
  const assets = accounts
    .filter((row) => row.type === "ASSET")
    .reduce((sum, row) => sum + value(row.type, row.balance), 0);
  const liabilities = accounts
    .filter((row) => row.type === "LIABILITY")
    .reduce((sum, row) => sum + value(row.type, row.balance), 0);
  const equity = accounts
    .filter((row) => row.type === "EQUITY")
    .reduce((sum, row) => sum + value(row.type, row.balance), 0);
  const revenue = accounts
    .filter((row) => row.type === "REVENUE")
    .reduce((sum, row) => sum + value(row.type, row.balance), 0);
  const expenses = accounts
    .filter((row) => row.type === "EXPENSE")
    .reduce((sum, row) => sum + value(row.type, row.balance), 0);
  const result = revenue - expenses;
  const currency = ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Estados financieros"
        description="Balance de situación y cuenta de resultados calculados desde el libro mayor."
        backHref="/accounting"
        backLabel="Volver al resumen"
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Activo"
          value={formatMoney(assets, currency)}
          helper="Saldo de cuentas de activo"
        />
        <MetricCard
          label="Patrimonio y pasivo"
          value={formatMoney(equity + liabilities + result, currency)}
          helper="Incluye resultado del ejercicio"
        />
        <MetricCard
          label="Resultado"
          value={formatMoney(result, currency)}
          helper={`${formatMoney(revenue, currency)} ingresos`}
          tone={result >= 0 ? "success" : "warning"}
        />
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <PageSection
          title="Balance de situación"
          description="Saldos por masas patrimoniales."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Masa</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Activo", assets],
                ["Patrimonio neto", equity + result],
                ["Pasivo", liabilities],
              ].map(([label, amount]) => (
                <TableRow key={String(label)}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(Number(amount), currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageSection>
        <PageSection
          title="Cuenta de resultados"
          description="Ingresos, gastos y resultado del ejercicio."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Ingresos", revenue],
                ["Gastos", expenses],
                ["Resultado", result],
              ].map(([label, amount]) => (
                <TableRow key={String(label)}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(Number(amount), currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageSection>
      </div>
    </PageShell>
  );
}
