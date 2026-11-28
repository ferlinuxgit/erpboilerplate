/**
 * Recibo de salarios sencillo (módulo puro): ordena en devengos y deducciones los importes que ya
 * tiene la nómina guardada. No calcula nada nuevo: los importes son los que dio la gestoría.
 *
 * No es el modelo oficial de recibo individual de salarios (Orden ESS/2098/2014): es un justificante
 * con los mismos importes para entregar o archivar cuando la gestoría no lo da.
 */
import { centsToAmount } from "@/server/accounting/money";
import { OTHER_DEDUCTION_KINDS, periodLabel, SLIP_TYPE_LABELS, slipCents, isSlipType, type SlipAmounts } from "@/server/payroll/model";

export type ReceiptLine = { label: string; cents: number; note?: string };

export type PayrollReceipt = {
  title: string;
  periodLabel: string;
  company: { name: string; taxId: string | null; address: string | null };
  employee: { name: string; taxId: string | null; socialSecurityNumber: string | null; startDate: string | null };
  accrualDate: string;
  earnings: ReceiptLine[];
  totalEarningsCents: number;
  deductions: ReceiptLine[];
  totalDeductionsCents: number;
  netCents: number;
  /** Información (no se descuenta): Seguridad Social a cargo de la empresa y especie no dineraria. */
  information: ReceiptLine[];
  notes: string[];
};

export type ReceiptInput = SlipAmounts & {
  period: string;
  concept: string;
  slipType: string;
  accrualDate: string;
  company: PayrollReceipt["company"];
  employee: PayrollReceipt["employee"];
};

export function buildPayrollReceipt(input: ReceiptInput): PayrollReceipt {
  const cents = slipCents(input);
  const type = isSlipType(input.slipType) ? input.slipType : "monthly";
  const earnings: ReceiptLine[] = [];
  const push = (list: ReceiptLine[], label: string, value: number, note?: string) => {
    if (value !== 0) list.push(note ? { label, cents: value, note } : { label, cents: value });
  };
  push(earnings, type === "extra" ? "Paga extraordinaria" : "Salario y complementos", cents.grossCents - cents.severanceCents);
  push(earnings, "Indemnización", cents.severanceCents, cents.severanceExemptCents > 0 ? `exenta: ${formatEuros(cents.severanceExemptCents)}` : undefined);
  push(earnings, "Retribución en especie", cents.inKindCents, "no se cobra en dinero");
  const totalEarningsCents = cents.grossCents + cents.inKindCents;

  const deductions: ReceiptLine[] = [];
  push(deductions, "Cotizaciones del trabajador a la Seguridad Social", cents.employeeSocialSecurityCents);
  const ratePct = cents.grossCents > 0 ? Math.round((cents.withholdingCents / cents.grossCents) * 10_000) / 100 : 0;
  push(deductions, "Retención del IRPF", cents.withholdingCents, ratePct > 0 ? `${ratePct.toLocaleString("es-ES")} %` : undefined);
  push(deductions, "Ingreso a cuenta de la retribución en especie", cents.inKindWithholdingCents);
  push(deductions, "Anticipos", cents.advancesCents);
  for (const item of cents.otherDeductions) push(deductions, item.concept || OTHER_DEDUCTION_KINDS[item.kind]?.label || "Otra deducción", item.amountCents);
  // La especie se resta para llegar al líquido: no se cobra en dinero.
  push(deductions, "Valor de la retribución en especie", cents.inKindCents);
  const totalDeductionsCents = deductions.reduce((sum, line) => sum + line.cents, 0);

  const information: ReceiptLine[] = [];
  push(information, "Seguridad Social a cargo de la empresa", cents.employerSocialSecurityCents);

  return {
    title: `${SLIP_TYPE_LABELS[type]}${input.concept && input.concept !== SLIP_TYPE_LABELS[type] ? ` · ${input.concept}` : ""}`,
    periodLabel: periodLabel(input.period),
    company: input.company,
    employee: input.employee,
    accrualDate: input.accrualDate,
    earnings,
    totalEarningsCents,
    deductions,
    totalDeductionsCents,
    netCents: totalEarningsCents - totalDeductionsCents,
    information,
    notes: [
      "Recibo elaborado con los importes de la nómina registrada en el programa; no es un cálculo de nómina.",
      "No sustituye al recibo individual de salarios oficial que emite la gestoría (Orden ESS/2098/2014).",
    ],
  };
}

export function formatEuros(cents: number) {
  return `${Number(centsToAmount(cents)).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" })} €`;
}
