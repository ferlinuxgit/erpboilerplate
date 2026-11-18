CREATE INDEX "audit_log_company_created_idx" ON "audit_log" USING btree ("companyId","createdAt");--> statement-breakpoint
CREATE INDEX "document_attachment_company_idx" ON "document_attachment" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "item_cost_history_company_idx" ON "item_cost_history" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "kpi_snapshot_company_idx" ON "kpi_snapshot" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_cash_movement_company_idx" ON "pos_cash_movement" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_item_modifier_group_company_idx" ON "pos_item_modifier_group" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_kitchen_batch_company_idx" ON "pos_kitchen_batch" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_modifier_option_company_idx" ON "pos_modifier_option" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_set_menu_choice_company_idx" ON "pos_set_menu_choice" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_set_menu_course_company_idx" ON "pos_set_menu_course" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "supplier_invoice_attachment_company_idx" ON "supplier_invoice_attachment" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "tax_retention_company_idx" ON "tax_retention" USING btree ("companyId");