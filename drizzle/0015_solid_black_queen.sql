ALTER TABLE "supplier_invoice" DROP CONSTRAINT IF EXISTS "supplier_invoice_supplier_document_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "supplier_invoice_supplier_document_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_supplier_document_unique" ON "supplier_invoice" USING btree ("companyId","supplierPartnerId","supplierDocumentNumber") WHERE "supplierDocumentNumber" IS NOT NULL AND "status" <> 'VOID';
