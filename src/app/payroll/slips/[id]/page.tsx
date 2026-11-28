import { notFound } from "next/navigation";

import { SlipForm } from "@/components/payroll/slip-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatDecimalInput } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { isSlipType, periodLabel } from "@/server/payroll/model";
import { getSlip, listEmployees } from "@/server/payroll/service";

export default async function PayrollSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const { id } = await params;
  const [slip, employees] = await Promise.all([getSlip(ctx.company.id, id), listEmployees(ctx.company.id)]);
  if (!slip) notFound();
  const canWrite = can(ctx.membership.role, "accounting.write");
  const input = (value: string) => (Number(value) === 0 ? "" : formatDecimalInput(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title={`${slip.concept} de ${periodLabel(slip.period)} · ${slip.employeeName}`}
        description="Importes de la nómina."
        backHref={`/payroll?period=${slip.period}`}
        backLabel="Volver a las nóminas"
      />
      <PageSection title="Importes de la nómina" description="Solo se puede cambiar mientras está en borrador.">
        {!canWrite ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite modificar nóminas." />
        ) : slip.status !== "draft" ? (
          <EmptyState title="Nómina contabilizada" description="Para cambiarla, vuelve a las nóminas del mes y pulsa «Descontabilizar»: se anula su asiento y vuelve a borrador." />
        ) : (
          <SlipForm
            currencyCode={ctx.company.baseCurrencyCode}
            employees={employees
              .filter((employee) => employee.isActive || employee.id === slip.employeeId)
              .map((employee) => ({ id: employee.id, name: employee.name, withholdingRate: Number(employee.withholdingRate), isDirector: employee.recipientKind === "director" }))}
            initialValues={{
              employeeId: slip.employeeId,
              period: slip.period,
              concept: slip.concept,
              grossAmount: input(slip.grossAmount),
              inKindAmount: input(slip.inKindAmount),
              inKindWithholdingAmount: input(slip.inKindWithholdingAmount),
              withholdingAmount: input(slip.withholdingAmount),
              employeeSocialSecurity: input(slip.employeeSocialSecurity),
              employerSocialSecurity: input(slip.employerSocialSecurity),
              advancesAmount: input(slip.advancesAmount),
              netAmount: input(slip.netAmount),
              notes: slip.notes ?? "",
              slipType: isSlipType(slip.slipType) ? slip.slipType : "monthly",
              severanceAmount: input(slip.severanceAmount),
              severanceExemptAmount: input(slip.severanceExemptAmount),
              otherDeductions: (slip.otherDeductions ?? []).map((item) => ({ kind: item.kind, concept: item.concept, amount: input(String(item.amountCents / 100)), accountCode: item.accountCode })),
              inKindPosting: slip.inKindPosting ?? null,
            }}
            slipId={slip.id}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
