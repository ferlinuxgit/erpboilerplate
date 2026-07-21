ALTER TABLE "supplier_payment" ADD COLUMN "supplierPartnerId" text;
--> statement-breakpoint
UPDATE "supplier_payment" AS payment
SET "supplierPartnerId" = invoice."supplierPartnerId"
FROM "supplier_invoice" AS invoice
WHERE payment."supplierInvoiceId" = invoice."id";
--> statement-breakpoint
ALTER TABLE "supplier_payment" ALTER COLUMN "supplierPartnerId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplierPartnerId_partner_id_fk"
  FOREIGN KEY ("supplierPartnerId") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payment" DROP CONSTRAINT "supplier_payment_supplierInvoiceId_supplier_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_payment" ALTER COLUMN "supplierInvoiceId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplierInvoiceId_supplier_invoice_id_fk"
  FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "supplier_payment_company_supplier_date_idx"
  ON "supplier_payment" ("companyId", "supplierPartnerId", "postedAt");
