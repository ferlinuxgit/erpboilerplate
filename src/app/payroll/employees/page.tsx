import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatPercent } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { listEmployees } from "@/server/payroll/service";

const formatIso = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default async function PayrollEmployeesPage() {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const employees = await listEmployees(ctx.company.id);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title="Trabajadores"
        description="Empleados y administradores a los que pagas una nómina. Los profesionales que te facturan salen de sus facturas con retención."
        actions={canWrite ? <Link className={buttonVariants()} href="/payroll/employees/new">Nuevo trabajador</Link> : undefined}
      />
      <PageSection title="Fichas" description="El NIF y el tipo de perceptor son los datos que usa el modelo 190.">
        {employees.length === 0 ? (
          <EmptyState
            title="Todavía no hay trabajadores"
            description="Da de alta a cada empleado o administrador con su NIF y el tipo de retención que te indica la gestoría."
            action={canWrite ? <Link className={buttonVariants()} href="/payroll/employees/new">Nuevo trabajador</Link> : undefined}
          />
        ) : (
          <TableContainer>
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>NIF</TableHead>
                  <TableHead>NAF</TableHead>
                  <TableHead>Clave 190</TableHead>
                  <TableHead className="text-right">Retención</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead>Baja</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">
                      <Link className="text-link hover:underline" href={`/payroll/employees/${employee.id}`}>{employee.name}</Link>
                    </TableCell>
                    <TableCell className="font-mono">{employee.taxId ?? <span className="text-warning-text">Falta</span>}</TableCell>
                    <TableCell className="font-mono">{employee.socialSecurityNumber ?? "—"}</TableCell>
                    <TableCell className="font-mono">{employee.recipientKind === "director" ? `E/${employee.subkey190 ?? "04"}` : "A"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{formatPercent(employee.withholdingRate)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatIso(employee.startDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatIso(employee.endDate)}</TableCell>
                    <TableCell><StatusBadge tone={employee.isActive ? "success" : "neutral"}>{employee.isActive ? "Activo" : "Inactivo"}</StatusBadge></TableCell>
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
