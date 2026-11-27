import Link from "next/link";

import { CapitalIncomeForm, DeleteCapitalIncomeButton } from "@/components/payroll/capital-income-panel";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatMoney, formatPercent } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { listCapitalIncome, listPayrollBankOptions } from "@/server/payroll/service";

const formatIso = (iso: string) => iso.split("-").reverse().join("/");

export default async function CapitalIncomePage() {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const [rows, banks] = await Promise.all([listCapitalIncome(ctx.company.id), listPayrollBankOptions(ctx.company.id)]);
  const canWrite = can(ctx.membership.role, "accounting.write");
  const currency = ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title="Dividendos e intereses pagados"
        description="Rendimientos del capital mobiliario que paga la empresa a sus socios o prestamistas, con su retención. De aquí salen los modelos 123 y 193."
      />
      {canWrite ? (
        <PageSection title="Registrar un pago" description="Se contabiliza al guardarlo, con la fecha de pago.">
          <CapitalIncomeForm banks={banks} currencyCode={currency} today={dateInputValue(new Date(), ctx.company.timezone)} />
        </PageSection>
      ) : null}
      <PageSection title="Pagos registrados" description="Para corregir uno, elimínalo (se anula su asiento) y vuelve a registrarlo.">
        {rows.length === 0 ? (
          <EmptyState title="Sin pagos registrados" description="Si la empresa no reparte dividendos ni paga intereses de préstamos con retención, no necesitas esta pantalla ni los modelos 123 y 193." />
        ) : (
          <TableContainer>
            <Table className="min-w-[52rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Perceptor</TableHead>
                  <TableHead>NIF</TableHead>
                  <TableHead className="text-right">Íntegro</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Retención</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatIso(row.paymentDate)}</TableCell>
                    <TableCell>{row.kind === "dividend" ? "Dividendo" : "Intereses"}</TableCell>
                    <TableCell className="font-medium">{row.recipientName}</TableCell>
                    <TableCell className="font-mono">{row.recipientTaxId ?? <span className="text-warning-text">Falta</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(row.grossAmount, currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatPercent(row.withholdingRate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(row.withholdingAmount, currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatMoney(Number(row.grossAmount) - Number(row.withholdingAmount), currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {row.journalEntryId ? <Link className="mr-2 text-xs text-link hover:underline" href={`/accounting/entries/${row.journalEntryId}`}>Ver asiento</Link> : null}
                      {canWrite ? <DeleteCapitalIncomeButton id={row.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}
