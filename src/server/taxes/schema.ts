import { z } from "zod";

export const taxKindSchema = z.enum(["VAT", "SURCHARGE", "WITHHOLDING", "OTHER"]);
export const taxOperationSchema = z.enum(["ADD", "SUBTRACT"]);

const taxNameSchema = z.string().trim().min(1, "El nombre es obligatorio.").max(120, "El nombre es demasiado largo.");
const taxRateSchema = z.number().min(0, "El porcentaje no puede ser negativo.").max(100, "El porcentaje no puede superar el 100%.");

export const taxMutationSchema = z.object({
  name: taxNameSchema,
  rate: taxRateSchema,
  kind: taxKindSchema.default("VAT"),
  operation: taxOperationSchema.optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const taxPatchSchema = z.object({
  name: taxNameSchema.optional(),
  rate: taxRateSchema.optional(),
  kind: taxKindSchema.optional(),
  operation: taxOperationSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "Debes indicar al menos un campo para actualizar.",
);

export function operationForTaxKind(kind: z.infer<typeof taxKindSchema>, requested?: z.infer<typeof taxOperationSchema>) {
  if (kind === "WITHHOLDING") return "SUBTRACT" as const;
  if (kind === "VAT" || kind === "SURCHARGE") return "ADD" as const;
  return requested ?? "ADD";
}

export const taxKindLabels: Record<z.infer<typeof taxKindSchema>, string> = {
  VAT: "IVA",
  SURCHARGE: "Recargo de equivalencia",
  WITHHOLDING: "Retención / IRPF",
  OTHER: "Otro impuesto",
};
