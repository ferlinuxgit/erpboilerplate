import { EMPTY_EMPLOYEE, EmployeeForm } from "@/components/payroll/employee-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";

export default async function NewPayrollEmployeePage() {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader eyebrow="Nóminas y retenciones · Trabajadores" title="Nuevo trabajador" description="Ficha de un empleado o de un administrador de la empresa." backHref="/payroll/employees" backLabel="Volver a trabajadores" />
      <PageSection title="Ficha" description="Con el nombre, el NIF y el tipo de retención ya puedes anotar sus nóminas.">
        {canWrite ? <EmployeeForm initialValues={EMPTY_EMPLOYEE} /> : <EmptyState title="Solo lectura" description="Tu rol actual no permite dar de alta trabajadores." />}
      </PageSection>
    </PageShell>
  );
}
