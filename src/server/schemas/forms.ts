import { z } from "zod";

import { isValidSpanishTaxId, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";

export const authSignInSchema = z.object({
  email: z.string().trim().email("Debes indicar un email válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

export const authSignUpSchema = authSignInSchema.extend({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres."),
});

export const customerStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres."),
  taxId: z.string().trim().min(1, "Debes indicar CIF/NIF/VAT."),
  address: z.string().trim().min(1, "Debes indicar la dirección fiscal."),
  addressLine2: z.string().trim().optional().or(z.literal("")),
  postalCode: z.string().trim().min(1, "Debes indicar el código postal."),
  city: z.string().trim().min(1, "Debes indicar la ciudad."),
  province: z.string().trim().min(1, "Debes indicar la provincia."),
  countryCode: z.string().trim().length(2, "El país debe ser un código ISO de 2 letras."),
  email: z
    .string()
    .trim()
    .email("Debes indicar un email válido.")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.countryCode.toUpperCase() === "ES" && !isValidSpanishTaxId(value.taxId)) {
    ctx.addIssue({
      code: "custom",
      message: "Debes indicar un CIF/NIF español válido.",
      path: ["taxId"],
    });
  }
});

export const updateCustomerSchema = createCustomerSchema.extend({
  status: customerStatusSchema.optional(),
});

export const createSupplierSchema = createCustomerSchema.extend({
  paymentTermsDays: z.number().int("Los días de pago deben ser enteros.").min(0, "Los días de pago no pueden ser negativos.").max(365, "Los días de pago no pueden superar 365.").default(30),
  paymentMethodId: z.string().trim().optional().or(z.literal("")),
  defaultAccountId: z.string().trim().optional().or(z.literal("")),
  currencyCode: z.string().trim().length(3, "La moneda debe ser un código ISO de 3 letras.").default("EUR"),
});

export const updateSupplierSchema = createSupplierSchema.extend({
  status: customerStatusSchema.optional(),
});

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2, "El nombre comercial debe tener al menos 2 caracteres."),
  legalName: z.string().trim().optional().or(z.literal("")),
  vatNumber: z.string().trim().optional().or(z.literal("")),
  fiscalAddress: z.string().trim().optional().or(z.literal("")),
  fiscalAddressLine2: z.string().trim().optional().or(z.literal("")),
  postalCode: z.string().trim().optional().or(z.literal("")),
  city: z.string().trim().optional().or(z.literal("")),
  province: z.string().trim().optional().or(z.literal("")),
  countryCode: z.string().trim().length(2, "El país debe ser un código ISO de 2 letras."),
  timezone: z.string().trim().min(1, "Debes indicar la zona horaria."),
  baseCurrencyCode: z.string().trim().length(3, "La moneda debe ser un código ISO de 3 letras."),
  email: z.string().trim().email("Debes indicar un email válido.").optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  website: z.string().trim().url("Debes indicar una URL válida.").optional().or(z.literal("")),
  logoDataUrl: z
    .string()
    .trim()
    .max(350_000, "El logotipo no puede superar 250 KB.")
    .regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/, "El logotipo debe ser una imagen PNG o JPG.")
    .optional()
    .or(z.literal("")),
  invoiceFooter: z.string().trim().max(500, "El pie de factura no puede superar 500 caracteres.").optional().or(z.literal("")),
}).superRefine((value, ctx) => {
  const vatNumber = normalizeSpanishTaxId(value.vatNumber);
  if (value.countryCode.toUpperCase() === "ES" && vatNumber && !isValidSpanishTaxId(vatNumber)) {
    ctx.addIssue({
      code: "custom",
      message: "Debes indicar un CIF/NIF español válido.",
      path: ["vatNumber"],
    });
  }
});

export const invoiceStatusSchema = z.enum(["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"]);

export const invoiceLineFormSchema = z.object({
  description: z.string().trim().min(1, "La línea debe tener descripción."),
  quantity: z.number().positive("La cantidad debe ser mayor que 0."),
  unitPrice: z.number().nonnegative("El precio no puede ser negativo."),
  taxRate: z.number().min(0, "El IVA no puede ser negativo.").max(100, "El IVA no puede superar el 100%."),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().trim().optional().or(z.literal("")),
  newCustomer: createCustomerSchema.optional(),
  issueDate: z.string().trim().min(1, "Debes indicar una fecha de emisión."),
  dueDate: z.string().trim().optional().or(z.literal("")),
  totalAmount: z.number().positive("El importe debe ser mayor que 0."),
  notes: z.string().trim().optional().or(z.literal("")),
  lines: z.array(invoiceLineFormSchema).min(1, "Debes añadir al menos una línea."),
  returnPdf: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.customerId?.trim() && !value.newCustomer) {
    ctx.addIssue({
      code: "custom",
      message: "Debes seleccionar un cliente o crear uno nuevo.",
      path: ["customerId"],
    });
  }
});

export const updateInvoiceSchema = z.object({
  status: invoiceStatusSchema,
  notes: z.string().trim().optional().or(z.literal("")),
  totalAmount: z.number().positive("El importe debe ser mayor que 0."),
  lines: z.array(invoiceLineFormSchema).min(1, "Debes añadir al menos una línea."),
});
