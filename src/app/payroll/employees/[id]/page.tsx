import { notFound } from "next/navigation";

import { EmployeeForm } from "@/components/payroll/employee-form";
import { EmployeeModelo190ExtraForm } from "@/components/payroll/employee-model190-extra-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatDecimalInput } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { readModelo190Extra } from "@/server/payroll/schemas";
import { getEmployee } from "@/server/payroll/service";

export default async function PayrollEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const { id } = await params;
  const employee = await getEmployee(ctx.company.id, id);
  if (!employee) notFound();
  const canWrite = can(ctx.membership.role, "accounting.write");
  const text = (value: number | null) => (value === null ? "" : String(value));
  // El 190 del año anterior es el que se presenta en enero; se ofrece también el año en curso.
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear - 2];
  const storedExtra = Object.fromEntries(years.flatMap((year) => {
    const data = readModelo190Extra(employee.model190Extra, year);
    return data ? [[String(year), data]] : [];
  }));

  return (
    <PageShell>
      <PageHeader eyebrow="Nóminas y retenciones · Trabajadores" title={employee.name} description="Ficha del trabajador y datos para el modelo 190." backHref="/payroll/employees" backLabel="Volver a trabajadores" />
      <PageSection title="Ficha" description="Los cambios no afectan a las nóminas ya contabilizadas.">
        {canWrite ? (
          <EmployeeForm
            employeeId={employee.id}
            initialValues={{
              name: employee.name,
              taxId: employee.taxId ?? "",
              socialSecurityNumber: employee.socialSecurityNumber ?? "",
              startDate: employee.startDate ?? "",
              endDate: employee.endDate ?? "",
              recipientKind: employee.recipientKind === "director" ? "director" : "employee",
              subkey190: employee.subkey190 ?? "04",
              withholdingRate: formatDecimalInput(Number(employee.withholdingRate), { maximumFractionDigits: 2 }),
              birthYear: text(employee.birthYear),
              familySituation: text(employee.familySituation),
              disability: text(employee.disability),
              contractType: text(employee.contractType),
              spouseTaxId: employee.spouseTaxId ?? "",
              notes: employee.notes ?? "",
              isActive: employee.isActive,
            }}
          />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite modificar trabajadores." />
        )}
      </PageSection>
      {canWrite && employee.recipientKind !== "director" ? (
        <PageSection title="Datos adicionales del 190 (clave A)" description="Descendientes, ascendientes, reducciones, gastos deducibles, pensiones y préstamo de vivienda. Opcionales.">
          <EmployeeModelo190ExtraForm employeeId={employee.id} stored={storedExtra} years={years} />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
