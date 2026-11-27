import { z } from "zod";

import { isPayrollPeriod } from "@/server/payroll/model";

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
const isoDate = (message: string) => z.string().trim().refine(isIsoDate, message);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const amount = (message: string) => z.number().min(0, message).max(9_999_999_999, "El importe es demasiado alto.");
const period = z.string().trim().refine(isPayrollPeriod, "Indica el mes de la nómina (AAAA-MM).");

/** Ficha de un trabajador o administrador. */
export const payrollEmployeeSchema = z.object({
  name: z.string().trim().min(1, "Indica el nombre del trabajador.").max(200),
  taxId: optionalText(20),
  socialSecurityNumber: optionalText(20),
  startDate: isoDate("La fecha de alta no es válida.").nullable().optional(),
  endDate: isoDate("La fecha de baja no es válida.").nullable().optional(),
  recipientKind: z.enum(["employee", "director"]),
  subkey190: z.enum(["01", "02", "03", "04"]).nullable().optional(),
  withholdingRate: z.number().min(0, "El tipo de retención no puede ser negativo.").max(100, "El tipo de retención no puede superar el 100 %."),
  birthYear: z.number().int().min(1900, "El año de nacimiento no es válido.").max(2100, "El año de nacimiento no es válido.").nullable().optional(),
  familySituation: z.number().int().min(1).max(3).nullable().optional(),
  disability: z.number().int().min(0).max(3).nullable().optional(),
  contractType: z.number().int().min(1).max(4).nullable().optional(),
  spouseTaxId: optionalText(20),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});
export type PayrollEmployeeInput = z.infer<typeof payrollEmployeeSchema>;

/** Nómina de un trabajador y un mes. Importes en euros. */
export const payrollSlipSchema = z.object({
  employeeId: z.string().trim().min(1, "Elige el trabajador."),
  period,
  concept: z.string().trim().min(1).max(60).optional(),
  accrualDate: isoDate("La fecha de la nómina no es válida.").nullable().optional(),
  grossAmount: amount("El bruto no puede ser negativo."),
  inKindAmount: amount("La retribución en especie no puede ser negativa.").optional(),
  inKindWithholdingAmount: amount("El ingreso a cuenta no puede ser negativo.").optional(),
  withholdingAmount: amount("La retención no puede ser negativa.").optional(),
  employeeSocialSecurity: amount("La Seguridad Social del trabajador no puede ser negativa.").optional(),
  employerSocialSecurity: amount("La Seguridad Social de la empresa no puede ser negativa.").optional(),
  advancesAmount: amount("Los anticipos no pueden ser negativos.").optional(),
  netAmount: amount("El líquido no puede ser negativo."),
  notes: optionalText(2000),
  /** Contabilizar al guardar. */
  post: z.boolean().optional(),
});
export type PayrollSlipInput = z.infer<typeof payrollSlipSchema>;

/** Nóminas pegadas desde una hoja de cálculo. */
export const payrollImportSchema = z.object({
  period,
  text: z.string().min(1, "Pega las filas de las nóminas.").max(200_000),
  /** false: solo comprobar (no guarda nada). */
  commit: z.boolean().optional(),
  post: z.boolean().optional(),
});

/** Contabilizar todas las nóminas en borrador de un mes. */
export const payrollPostPeriodSchema = z.object({ period });

/** Pago del líquido de las nóminas o de los seguros sociales de un mes. */
export const payrollPaymentSchema = z.object({
  kind: z.enum(["salaries", "socialSecurity"]),
  period,
  paymentDate: isoDate("La fecha de pago no es válida."),
  bankAccountId: z.string().trim().min(1).nullable().optional(),
  /** Solo seguros sociales: importe cargado por la Tesorería (por defecto, lo pendiente). */
  amount: z.number().positive("El importe debe ser mayor que cero.").max(9_999_999_999).optional(),
  /** false: solo anota la fecha de pago, sin asiento (el pago se contabiliza desde el banco). */
  postEntry: z.boolean().optional(),
});
export type PayrollPaymentInput = z.infer<typeof payrollPaymentSchema>;

/** Dividendo o interés pagado por la empresa. */
export const capitalIncomeSchema = z.object({
  recipientName: z.string().trim().min(1, "Indica el perceptor.").max(200),
  recipientTaxId: optionalText(20),
  kind: z.enum(["dividend", "interest"]),
  paymentDate: isoDate("La fecha de pago no es válida."),
  grossAmount: z.number().positive("Indica el importe íntegro.").max(9_999_999_999),
  withholdingRate: z.number().min(0).max(100),
  withholdingAmount: amount("La retención no puede ser negativa."),
  bankAccountId: z.string().trim().min(1).nullable().optional(),
  notes: optionalText(2000),
});
export type CapitalIncomeInput = z.infer<typeof capitalIncomeSchema>;

/** Inmueble alquilado a un arrendador (modelo 180). */
export const rentalPropertySchema = z.object({
  supplierPartnerId: z.string().trim().min(1, "Elige el arrendador."),
  situation: z.enum(["1", "2", "3", "4"]),
  cadastralReference: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{20}$/, "La referencia catastral tiene 20 letras y números.").nullable().optional(),
  address: optionalText(300),
  postalCode: optionalText(10),
  city: optionalText(120),
  province: optionalText(120),
}).refine((value) => value.situation === "4" || Boolean(value.cadastralReference), { message: "Indica la referencia catastral, o elige «Sin referencia catastral».", path: ["cadastralReference"] });
export type RentalPropertyInput = z.infer<typeof rentalPropertySchema>;

export const payrollSettingsSchema = z.object({
  invoiceWithholdingBasis: z.enum(["registration", "payment"]),
  payrollWithholdingBasis: z.enum(["accrual", "payment"]),
  enabledModels: z.array(z.enum(["190", "180", "123", "193"])).max(4),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;
