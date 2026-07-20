ALTER TABLE "expense_ocr_job" ADD COLUMN "supplierInvoiceId" text;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "storageKey" text;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "sizeBytes" integer;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD CONSTRAINT "expense_ocr_job_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE set null ON UPDATE no action;