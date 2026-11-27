import Link from "next/link";

import { SlipForm } from "@/components/payroll/slip-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { isPayrollPeriod } from "@/server/payroll/model";
import { listEmployees } from "@/server/payroll/service";

export default async function NewPayrollSlipPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const query = await searchParams;
  const requested = Array.isArray(query.period) ? query.period[0] : query.period;
  const period = isPayrollPeriod(requested) ? requested : dateInputValue(new Date(), ctx.company.timezone).slice(0, 7);
  const employees = (await listEmployees(ctx.company.id)).filter((employee) => employee.isActive);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader eyebrow="Nóminas y retenciones" title="Nueva nómina" description="Copia los importes del recibo de salarios que te da la gestoría." backHref={`/payroll?period=${period}`} backLabel="Volver a las nóminas" />
      <PageSection title="Importes de la nómina" description="El programa no calcula la nómina: comprueba que cuadra y prepara el asiento.">
        {!canWrite ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite anotar nóminas." />
        ) : employees.length === 0 ? (
          <EmptyState title="No hay trabajadores activos" description="Da de alta al trabajador antes de anotar su nómina." action={<Link className={buttonVariants()} href="/payroll/employees/new">Nuevo trabajador</Link>} />
        ) : (
          <SlipForm
            currencyCode={ctx.company.baseCurrencyCode}
            employees={employees.map((employee) => ({ id: employee.id, name: employee.name, withholdingRate: Number(employee.withholdingRate), isDirector: employee.recipientKind === "director" }))}
            initialValues={{
              employeeId: employees.length === 1 ? employees[0].id : "",
              period,
              concept: "Nómina",
              grossAmount: "",
              inKindAmount: "",
              inKindWithholdingAmount: "",
              withholdingAmount: "",
              employeeSocialSecurity: "",
              employerSocialSecurity: "",
              advancesAmount: "",
              netAmount: "",
              notes: "",
            }}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
