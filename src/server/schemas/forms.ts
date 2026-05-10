import { z } from "zod";

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
  email: z
    .string()
    .trim()
    .email("Debes indicar un email válido.")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
});

export const updateCustomerSchema = createCustomerSchema.extend({
  status: customerStatusSchema.optional(),
});

export const invoiceStatusSchema = z.enum(["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"]);

export const invoiceLineFormSchema = z.object({
  description: z.string().trim().min(1, "La línea debe tener descripción."),
  quantity: z.number().positive("La cantidad debe ser mayor que 0."),
  unitPrice: z.number().nonnegative("El precio no puede ser negativo."),
  taxRate: z.number().min(0, "El IVA no puede ser negativo.").max(100, "El IVA no puede superar el 100%."),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().trim().min(1, "Debes seleccionar un cliente."),
  number: z.string().trim().min(1, "Debes indicar un número de factura."),
  issueDate: z.string().trim().min(1, "Debes indicar una fecha de emisión."),
  dueDate: z.string().trim().optional().or(z.literal("")),
  totalAmount: z.number().positive("El importe debe ser mayor que 0."),
  notes: z.string().trim().optional().or(z.literal("")),
  lines: z.array(invoiceLineFormSchema).min(1, "Debes añadir al menos una línea."),
});

export const updateInvoiceSchema = z.object({
  number: z.string().trim().min(1, "Debes indicar un número de factura."),
  status: invoiceStatusSchema,
  notes: z.string().trim().optional().or(z.literal("")),
  totalAmount: z.number().positive("El importe debe ser mayor que 0."),
  lines: z.array(invoiceLineFormSchema).min(1, "Debes añadir al menos una línea."),
});
