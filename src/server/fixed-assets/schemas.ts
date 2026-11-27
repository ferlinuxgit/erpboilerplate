import { z } from "zod";

import { isIsoDate } from "@/server/fixed-assets/schedule";

const isoDate = (message: string) => z.string().trim().refine(isIsoDate, message);
const accountCode = (message: string) => z.string().trim().regex(/^\d{3,12}$/, message);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Alta y edición de un bien de inmovilizado. Importes en euros, fechas AAAA-MM-DD, cuentas por código. */
export const fixedAssetInputSchema = z.object({
  description: z.string().trim().min(1, "Indica la descripción del bien.").max(200, "La descripción no puede superar 200 caracteres."),
  notes: optionalText(2000),
  assetAccountCode: accountCode("Indica la cuenta de inmovilizado (grupos 20, 21 o 22)."),
  accumulatedAccountCode: accountCode("La cuenta de amortización acumulada no es válida.").nullable().optional(),
  expenseAccountCode: accountCode("La cuenta de gasto de la amortización no es válida.").nullable().optional(),
  isDepreciable: z.boolean(),
  method: z.enum(["percent", "years"]),
  annualPct: z.number().positive("El porcentaje anual debe ser mayor que cero.").nullable().optional(),
  usefulLifeYears: z.number().positive("La vida útil debe ser mayor que cero.").nullable().optional(),
  taxCoefficientKey: optionalText(60),
  acquisitionDate: isoDate("La fecha de adquisición no es válida."),
  inServiceDate: isoDate("La fecha de puesta en funcionamiento no es válida."),
  depreciationStartDate: isoDate("La fecha de inicio de la amortización no es válida.").nullable().optional(),
  acquisitionCost: z.number().positive("Indica el valor de adquisición del bien.").max(9_999_999_999, "El valor de adquisición es demasiado alto."),
  residualValue: z.number().min(0, "El valor residual no puede ser negativo.").optional(),
  priorAccumulated: z.number().min(0, "La amortización acumulada anterior no puede ser negativa.").optional(),
  supplierInvoiceId: optionalText(80),
  /** Centro de coste al que se imputan las dotaciones. */
  costCenterId: optionalText(80),
});

export type FixedAssetInput = z.infer<typeof fixedAssetInputSchema>;

/** Contabilizar las amortizaciones pendientes hasta una fecha (de todos los bienes o de uno). */
export const postDepreciationSchema = z.object({
  until: isoDate("Indica hasta qué fecha quieres contabilizar las amortizaciones."),
  assetId: z.string().trim().min(1).optional(),
});

/** Baja o venta de un bien. `proceeds` es el importe de la venta sin impuestos; `accountId`, la cuenta de contrapartida. */
export const disposeFixedAssetSchema = z.object({
  date: isoDate("La fecha de baja no es válida."),
  type: z.enum(["sale", "retirement"]),
  proceeds: z.number().min(0, "El importe de la venta no puede ser negativo.").max(9_999_999_999).optional(),
  accountId: z.string().trim().min(1).nullable().optional(),
  /**
   * Factura de venta ya emitida (con su cliente y su IVA). Con ella no hace falta cuenta de
   * contrapartida: la baja se cuadra contra el ingreso que contabilizó la factura.
   */
  salesInvoiceId: z.string().trim().min(1).nullable().optional(),
  notes: optionalText(2000),
});

export type DisposeFixedAssetInput = z.infer<typeof disposeFixedAssetSchema>;

/** Periodicidad de las dotaciones de la empresa. */
export const fixedAssetSettingsSchema = z.object({
  depreciationFrequency: z.enum(["monthly", "annual"]),
});
