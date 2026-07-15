ALTER TABLE "api_key" ADD COLUMN "companyId" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "keyPrefix" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "lastUsedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "sourceType" text;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "sourceId" text;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "isAutomatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "reversedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD COLUMN "reversesEntryId" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_tenant_idx" ON "api_key" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "fiscal_year_company_dates_idx" ON "fiscal_year" USING btree ("companyId","startsAt","endsAt");--> statement-breakpoint
CREATE INDEX "journal_entry_company_date_idx" ON "journal_entry" USING btree ("companyId","postedAt");--> statement-breakpoint
CREATE INDEX "journal_entry_source_idx" ON "journal_entry" USING btree ("companyId","sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "stock_movement_snapshot_idx" ON "stock_movement" USING btree ("companyId","itemId","warehouseId");--> statement-breakpoint
CREATE INDEX "subscription_customer_idx" ON "subscription" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX "supplier_invoice_company_supplier_idx" ON "supplier_invoice" USING btree ("companyId","supplierPartnerId");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_prefix_unique" UNIQUE("keyPrefix");--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_company_iban_unique" UNIQUE("companyId","iban");--> statement-breakpoint
ALTER TABLE "delivery_note" ADD CONSTRAINT "delivery_note_company_number_unique" UNIQUE("companyId","number");--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_company_year_type_unique" UNIQUE("companyId","fiscalYearId","type");--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_company_code_unique" UNIQUE("companyId","code");--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_company_sku_unique" UNIQUE("companyId","sku");--> statement-breakpoint
ALTER TABLE "item_category" ADD CONSTRAINT "item_category_company_code_unique" UNIQUE("companyId","code");--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_company_code_unique" UNIQUE("companyId","code");--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_company_code_unique" UNIQUE("companyId","code");--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_company_number_unique" UNIQUE("companyId","number");--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_company_number_unique" UNIQUE("companyId","number");--> statement-breakpoint
ALTER TABLE "sales_quote" ADD CONSTRAINT "sales_quote_company_number_unique" UNIQUE("companyId","number");--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_idempotency_unique" UNIQUE("companyId","itemId","warehouseId","movementType","reference");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_stripeSubscriptionId_unique" UNIQUE("stripeSubscriptionId");--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_company_number_unique" UNIQUE("companyId","number");--> statement-breakpoint
ALTER TABLE "tax" ADD CONSTRAINT "tax_company_name_unique" UNIQUE("companyId","name");--> statement-breakpoint
ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_company_code_unique" UNIQUE("companyId","code");--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_code_unique" UNIQUE("companyId","code");
