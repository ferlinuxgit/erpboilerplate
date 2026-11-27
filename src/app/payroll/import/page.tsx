import { PayrollImportForm } from "@/components/payroll/payroll-import-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { isPayrollPeriod } from "@/server/payroll/model";

export default async function PayrollImportPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const query = await searchParams;
  const requested = Array.isArray(query.period) ? query.period[0] : query.period;
  const period = isPayrollPeriod(requested) ? requested : dateInputValue(new Date(), ctx.company.timezone).slice(0, 7);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader eyebrow="Nóminas y retenciones" title="Importar nóminas" description="Pega el resumen de nóminas del mes que te envía la gestoría." backHref={`/payroll?period=${period}`} backLabel="Volver a las nóminas" />
      <PageSection title="Nóminas del mes" description="Primero se comprueban; no se guarda nada hasta que pulses «Importar».">
        {canWrite ? <PayrollImportForm currencyCode={ctx.company.baseCurrencyCode} initialPeriod={period} /> : <EmptyState title="Solo lectura" description="Tu rol actual no permite importar nóminas." />}
      </PageSection>
    </PageShell>
  );
}
