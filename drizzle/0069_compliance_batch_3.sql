-- Tercer lote de cumplimiento (auditoría 2026-11-27): suplidos, descuento global y anticipos en
-- facturas, datos registrales, envío a FACe y perfil UBL de la AEAT, SII en criterio de caja y
-- bienes de inversión, y extras de nóminas. Solo columnas con valor por defecto o anulables.
ALTER TABLE "einvoice_document" DROP CONSTRAINT "einvoice_document_format_valid";--> statement-breakpoint
ALTER TABLE "sii_record" DROP CONSTRAINT "sii_record_book_valid";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "registryData" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "dir3Codes" jsonb;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "customerIban" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceEnvironment" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceRegistryNumber" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceContactEmail" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceSubmittedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceProcessingCode" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceProcessingDescription" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceProcessingReason" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceCancellationCode" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceCancellationDescription" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceCancellationReason" text;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceCheckedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD COLUMN "faceLastError" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "globalDiscountPct" numeric(6, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "globalDiscountAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "isAdvance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "isDisbursement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "isGlobalDiscount" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "advanceInvoiceId" text;--> statement-breakpoint
ALTER TABLE "payroll_employee" ADD COLUMN "model190Extra" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD COLUMN "slipType" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD COLUMN "severanceAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD COLUMN "severanceExemptAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD COLUMN "otherDeductions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD COLUMN "inKindPosting" jsonb;--> statement-breakpoint
ALTER TABLE "rental_property" ADD COLUMN "matchAccountCode" text;--> statement-breakpoint
ALTER TABLE "rental_property" ADD COLUMN "matchText" text;--> statement-breakpoint
ALTER TABLE "sii_settings" ADD COLUMN "cashAccountingSince" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_advanceInvoiceId_invoice_id_fk" FOREIGN KEY ("advanceInvoiceId") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_document_face_registry_unique" ON "einvoice_document" USING btree ("faceEnvironment","faceRegistryNumber");--> statement-breakpoint
CREATE INDEX "invoice_line_advance_invoice_idx" ON "invoice_line" USING btree ("advanceInvoiceId");--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_face_environment_valid" CHECK ("einvoice_document"."faceEnvironment" IS NULL OR "einvoice_document"."faceEnvironment" IN ('production', 'staging'));--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_format_valid" CHECK ("einvoice_document"."format" IN ('FACTURAE', 'UBL', 'UBL_AEAT'));--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_global_discount_valid" CHECK ("invoice"."globalDiscountPct" >= 0 AND "invoice"."globalDiscountPct" <= 100 AND "invoice"."globalDiscountAmount" >= 0);--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_type_valid" CHECK ("payroll_slip"."slipType" IN ('monthly', 'extra', 'settlement'));--> statement-breakpoint
ALTER TABLE "payroll_slip" ADD CONSTRAINT "payroll_slip_severance_valid" CHECK ("payroll_slip"."severanceAmount" >= 0 AND "payroll_slip"."severanceExemptAmount" >= 0 AND "payroll_slip"."severanceExemptAmount" <= "payroll_slip"."severanceAmount");--> statement-breakpoint
ALTER TABLE "sii_record" ADD CONSTRAINT "sii_record_book_valid" CHECK ("sii_record"."book" IN ('ISSUED', 'RECEIVED', 'ISSUED_COLLECTIONS', 'RECEIVED_PAYMENTS', 'INVESTMENT_GOODS'));