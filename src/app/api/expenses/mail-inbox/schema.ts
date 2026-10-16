import { z } from "zod";

/** Configuración del buzón de facturas (la contraseña vacía conserva la guardada). */
export const mailInboxPayloadSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.coerce.number().int(),
  secure: z.boolean(),
  username: z.string().trim().max(320),
  password: z.string().max(500).optional().or(z.literal("")),
  mailbox: z.string().trim().max(255).default("INBOX"),
  processedMailbox: z.string().trim().max(255).optional().or(z.literal("")),
  allowedSenders: z.string().max(4000),
});
