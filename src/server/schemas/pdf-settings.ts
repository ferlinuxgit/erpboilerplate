import { z } from "zod";

export const pdfSettingsSchema = z.object({
  showLogo: z.boolean(),
  showEmail: z.boolean(),
  showPhone: z.boolean(),
  showWebsite: z.boolean(),
  showCustomerNumber: z.boolean(),
  showPaymentMethod: z.boolean(),
  showTaxBreakdown: z.boolean(),
});
