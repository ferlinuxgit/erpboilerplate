DELETE FROM "journal_line" WHERE "debit" = 0 AND "credit" = 0;--> statement-breakpoint
CREATE INDEX "bank_transaction_account_date_idx" ON "bank_transaction" USING btree ("bankAccountId","postedAt");--> statement-breakpoint
CREATE INDEX "customer_company_status_idx" ON "customer" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "customer_partner_idx" ON "customer" USING btree ("partnerId");--> statement-breakpoint
CREATE INDEX "invoice_payment_company_invoice_idx" ON "invoice_payment" USING btree ("companyId","invoiceId");--> statement-breakpoint
CREATE INDEX "journal_line_entry_idx" ON "journal_line" USING btree ("journalEntryId");--> statement-breakpoint
CREATE INDEX "journal_line_account_idx" ON "journal_line" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "partner_company_name_idx" ON "partner" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "partner_company_tax_id_idx" ON "partner" USING btree ("companyId","taxId");--> statement-breakpoint
CREATE INDEX "payment_company_invoice_date_idx" ON "payment" USING btree ("companyId","invoiceId","postedAt");--> statement-breakpoint
CREATE INDEX "supplier_invoice_payment_invoice_idx" ON "supplier_invoice_payment" USING btree ("companyId","supplierInvoiceId");--> statement-breakpoint
CREATE INDEX "supplier_payment_company_invoice_date_idx" ON "supplier_payment" USING btree ("companyId","supplierInvoiceId","postedAt");--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_document_unique" UNIQUE("companyId","supplierPartnerId","supplierDocumentNumber");--> statement-breakpoint
ALTER TABLE "invoice_payment" ADD CONSTRAINT "invoice_payment_amount_positive" CHECK ("invoice_payment"."amountApplied" > 0);--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_valid_amounts" CHECK ("journal_line"."debit" >= 0 AND "journal_line"."credit" >= 0 AND (("journal_line"."debit" > 0 AND "journal_line"."credit" = 0) OR ("journal_line"."credit" > 0 AND "journal_line"."debit" = 0)));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount" > 0);--> statement-breakpoint
ALTER TABLE "supplier_invoice_payment" ADD CONSTRAINT "supplier_invoice_payment_amount_positive" CHECK ("supplier_invoice_payment"."amountApplied" > 0);--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_amount_positive" CHECK ("supplier_payment"."amount" > 0);
