/**
 * Nóminas (módulo puro): cuadre de una nómina, propuesta de retención, líneas del asiento y lectura
 * de las nóminas pegadas desde una hoja de cálculo.
 *
 * No es un programa de cálculo de nóminas: los importes los da la gestoría. Aquí solo se comprueba
 * que cuadran y se preparan el asiento y los datos de los modelos 111 y 190.
 */
import { centsToAmount, toCents } from "@/server/accounting/money";

/** Orígenes (`sourceType`) de los asientos automáticos de este módulo. */
export const PAYROLL_SOURCE = {
  slip: "payrollSlip",
  payment: "payrollPayment",
  capitalIncome: "capitalIncomePayment",
} as const;

export const PAYROLL_SOURCE_TYPES: readonly string[] = Object.values(PAYROLL_SOURCE);

/** Cuentas del PGC que usa el módulo (se apuntan en su subcuenta canónica). */
export const PAYROLL_ACCOUNTS = {
  /** (640) Sueldos y salarios. */
  wages: "640",
  /** (642) Seguridad Social a cargo de la empresa. */
  employerSocialSecurity: "642",
  /** (4751) Hacienda Pública, acreedora por retenciones practicadas. */
  withholding: "4751",
  /** (476) Organismos de la Seguridad Social, acreedores. */
  socialSecurity: "476",
  /** (465) Remuneraciones pendientes de pago. */
  payable: "465",
  /** (460) Anticipos de remuneraciones. */
  advances: "460",
  /** (526) Dividendo activo a pagar. */
  dividendPayable: "526",
  /** (662) Intereses de deudas. */
  interestExpense: "662",
} as const;

export type RecipientKind = "employee" | "director";

export const RECIPIENT_KIND_LABELS: Record<RecipientKind, string> = {
  employee: "Empleado (clave A)",
  director: "Administrador o consejero (clave E)",
};

/**
 * Retención de administradores y consejeros (art. 101.2 LIRPF y art. 80.1.3.º RIRPF): 35 %, o
 * 19 % si la cifra de negocios de la entidad del último periodo impositivo fue inferior a 100.000 €.
 */
export const DIRECTOR_WITHHOLDING_RATES = { general: 35, smallEntity: 19 } as const;

/** Tipo general de retención del capital mobiliario (art. 101.4 LIRPF). */
export const CAPITAL_INCOME_WITHHOLDING_RATE = 19;

/** Clave del 190 de un perceptor de nómina. */
export function key190For(kind: RecipientKind) {
  return kind === "director" ? "E" : "A";
}

/** Subclave del 190: la clave A no lleva; la E usa la indicada o «04» (resto). */
export function subkey190For(kind: RecipientKind, subkey: string | null | undefined) {
  if (kind !== "director") return null;
  return subkey && /^0[1-4]$/.test(subkey) ? subkey : "04";
}

export function isPayrollPeriod(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Último día del mes de un periodo AAAA-MM (fecha de devengo por defecto). */
export function periodEndDate(period: string) {
  const [year, month] = period.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, "0")}`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «marzo de 2026» para un periodo AAAA-MM. */
export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1] ?? period} de ${year}`;
}

export type SlipAmounts = {
  grossAmount: number | string;
  inKindAmount?: number | string | null;
  inKindWithholdingAmount?: number | string | null;
  withholdingAmount?: number | string | null;
  employeeSocialSecurity?: number | string | null;
  employerSocialSecurity?: number | string | null;
  advancesAmount?: number | string | null;
  netAmount: number | string;
};

export type SlipCents = {
  grossCents: number;
  inKindCents: number;
  inKindWithholdingCents: number;
  withholdingCents: number;
  employeeSocialSecurityCents: number;
  employerSocialSecurityCents: number;
  advancesCents: number;
  netCents: number;
};

export function slipCents(amounts: SlipAmounts): SlipCents {
  return {
    grossCents: toCents(amounts.grossAmount),
    inKindCents: toCents(amounts.inKindAmount),
    inKindWithholdingCents: toCents(amounts.inKindWithholdingAmount),
    withholdingCents: toCents(amounts.withholdingAmount),
    employeeSocialSecurityCents: toCents(amounts.employeeSocialSecurity),
    employerSocialSecurityCents: toCents(amounts.employerSocialSecurity),
    advancesCents: toCents(amounts.advancesAmount),
    netCents: toCents(amounts.netAmount),
  };
}

/**
 * Líquido que corresponde a los importes: bruto dinerario − IRPF − ingreso a cuenta de la especie
 * (se repercute al trabajador) − Seguridad Social del trabajador − anticipos. La retribución en
 * especie no se cobra en dinero, así que no suma al líquido.
 */
export function expectedNetCents(slip: SlipCents) {
  return slip.grossCents - slip.withholdingCents - slip.inKindWithholdingCents - slip.employeeSocialSecurityCents - slip.advancesCents;
}

export type SlipValidation = { ok: true } | { ok: false; code: string; message: string };

const money = (cents: number) => `${centsToAmount(cents).replace(".", ",")} €`;

/** Comprueba que la nómina cuadra antes de guardarla o contabilizarla. */
export function validateSlip(slip: SlipCents): SlipValidation {
  const negative = Object.values(slip).some((cents) => cents < 0);
  if (negative) return { ok: false, code: "PAYROLL_NEGATIVE", message: "Los importes de la nómina no pueden ser negativos." };
  if (slip.grossCents === 0 && slip.inKindCents === 0) {
    return { ok: false, code: "PAYROLL_EMPTY", message: "Indica los devengos brutos de la nómina." };
  }
  if (slip.inKindCents === 0 && slip.inKindWithholdingCents > 0) {
    return { ok: false, code: "PAYROLL_IN_KIND", message: "Hay un ingreso a cuenta sin retribución en especie: indica la valoración de la retribución en especie." };
  }
  const expected = expectedNetCents(slip);
  if (expected < 0) {
    return { ok: false, code: "PAYROLL_NEGATIVE_NET", message: "Los descuentos superan el bruto: revisa la retención, la Seguridad Social y los anticipos." };
  }
  if (expected !== slip.netCents) {
    return {
      ok: false,
      code: "PAYROLL_UNBALANCED",
      message: `La nómina no cuadra: bruto − IRPF − ingreso a cuenta − Seguridad Social del trabajador − anticipos da ${money(expected)}, pero el líquido indicado es ${money(slip.netCents)} (diferencia de ${money(Math.abs(expected - slip.netCents))}).`,
    };
  }
  return { ok: true };
}

/** Propuesta de retención: base × tipo, redondeada al céntimo. */
export function proposeWithholdingCents(baseCents: number, ratePct: number) {
  if (!Number.isFinite(ratePct) || ratePct <= 0 || baseCents <= 0) return 0;
  return Math.round((baseCents * Math.min(ratePct, 100)) / 100);
}

export type PayrollAccountRole = "wages" | "employerSocialSecurity" | "withholding" | "socialSecurity" | "payable" | "advances";

export type SlipPostingLine = { role: PayrollAccountRole; debitCents: number; creditCents: number };

/**
 * Asiento de la nómina:
 *   (640) Sueldos y salarios ............ bruto dinerario        al debe
 *   (642) Seg. Social a cargo de la empresa                      al debe
 *        (4751) HP acreedora por retenciones (IRPF + ingreso a cuenta)   al haber
 *        (476)  Organismos de la Seg. Social (trabajador + empresa)      al haber
 *        (460)  Anticipos de remuneraciones                              al haber
 *        (465)  Remuneraciones pendientes de pago (líquido)              al haber
 *
 * La retribución en especie no se apunta aquí: su gasto ya está contabilizado con la factura de
 * quien presta el servicio (renting, seguro…). Solo su ingreso a cuenta, que se descuenta del líquido.
 */
export function buildSlipPostingLines(slip: SlipCents): SlipPostingLine[] {
  const lines: SlipPostingLine[] = [
    { role: "wages", debitCents: slip.grossCents, creditCents: 0 },
    { role: "employerSocialSecurity", debitCents: slip.employerSocialSecurityCents, creditCents: 0 },
    { role: "withholding", debitCents: 0, creditCents: slip.withholdingCents + slip.inKindWithholdingCents },
    { role: "socialSecurity", debitCents: 0, creditCents: slip.employeeSocialSecurityCents + slip.employerSocialSecurityCents },
    { role: "advances", debitCents: 0, creditCents: slip.advancesCents },
    { role: "payable", debitCents: 0, creditCents: slip.netCents },
  ];
  return lines.filter((line) => line.debitCents !== 0 || line.creditCents !== 0);
}

export function postingIsBalanced(lines: SlipPostingLine[]) {
  return lines.reduce((total, line) => total + line.debitCents - line.creditCents, 0) === 0;
}

// ---------------------------------------------------------------------------------------------
// Importación: nóminas pegadas desde una hoja de cálculo o un CSV
// ---------------------------------------------------------------------------------------------

export const PAYROLL_IMPORT_COLUMNS = ["NIF", "Bruto", "Especie", "IRPF", "Ingreso a cuenta", "SS trabajador", "SS empresa", "Anticipos", "Líquido"] as const;

export type PayrollImportRow = {
  line: number;
  taxId: string;
  employeeId: string | null;
  employeeName: string | null;
  amounts: Required<{ [K in keyof SlipAmounts]: number }>;
  /** null si la fila es válida. */
  error: string | null;
};

/** Importe escrito a la española («1.234,56») o con punto decimal («1234.56»). */
export function parseSpanishAmount(value: string | undefined): number | null {
  const text = (value ?? "").trim().replace(/[€\s]/g, "");
  if (text === "") return 0;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

const normalizeTaxId = (value: string) => value.replace(/[\s.\-]/g, "").toUpperCase();

/**
 * Lee filas «NIF; Bruto; Especie; IRPF; Ingreso a cuenta; SS trabajador; SS empresa; Anticipos;
 * Líquido» separadas por tabulador, punto y coma o barra vertical (lo que sale al copiar de Excel o
 * de un CSV español). Ignora la fila de cabecera y las líneas vacías. Cada fila se valida con las
 * mismas reglas que una nómina escrita a mano.
 */
export function parsePayrollImport(text: string, employees: Array<{ id: string; name: string; taxId: string | null }>): PayrollImportRow[] {
  const byTaxId = new Map(employees.filter((employee) => employee.taxId).map((employee) => [normalizeTaxId(employee.taxId ?? ""), employee]));
  const rows: PayrollImportRow[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === "") return;
    const cells = raw.split(raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : "|").map((cell) => cell.trim());
    if (index === 0 && /nif/i.test(cells[0] ?? "")) return;
    const taxId = normalizeTaxId(cells[0] ?? "");
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8].map((position) => parseSpanishAmount(cells[position]));
    const employee = byTaxId.get(taxId) ?? null;
    const amounts = {
      grossAmount: numbers[0] ?? 0,
      inKindAmount: numbers[1] ?? 0,
      withholdingAmount: numbers[2] ?? 0,
      inKindWithholdingAmount: numbers[3] ?? 0,
      employeeSocialSecurity: numbers[4] ?? 0,
      employerSocialSecurity: numbers[5] ?? 0,
      advancesAmount: numbers[6] ?? 0,
      netAmount: numbers[7] ?? 0,
    };
    let error: string | null = null;
    if (cells.length < PAYROLL_IMPORT_COLUMNS.length) error = `Faltan columnas: se esperan ${PAYROLL_IMPORT_COLUMNS.length} (${PAYROLL_IMPORT_COLUMNS.join("; ")}).`;
    else if (numbers.some((value) => value === null)) error = "Algún importe no es un número.";
    else if (!taxId) error = "Falta el NIF del trabajador.";
    else if (!employee) error = `No hay ningún trabajador con el NIF ${taxId}: dalo de alta antes de importar.`;
    else if (seen.has(taxId)) error = `El NIF ${taxId} está repetido en la importación.`;
    else {
      const validation = validateSlip(slipCents(amounts));
      if (!validation.ok) error = validation.message;
    }
    if (taxId) seen.add(taxId);
    rows.push({ line: index + 1, taxId, employeeId: employee?.id ?? null, employeeName: employee?.name ?? null, amounts, error });
  });
  return rows;
}
