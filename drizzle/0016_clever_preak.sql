ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_itemId_item_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_warehouseId_warehouse_id_fk";
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "scopes" text DEFAULT '["customer.read","supplier.read","invoice.read"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD COLUMN "warehouseId" text;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD COLUMN "supplierDocumentNumber" text;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD COLUMN "paymentMethodId" text;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD COLUMN "bankAccountId" text;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_warehouseId_warehouse_id_fk" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouseId_warehouse_id_fk" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_paymentMethodId_payment_method_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_bankAccountId_bank_account_id_fk" FOREIGN KEY ("bankAccountId") REFERENCES "public"."bank_account"("id") ON DELETE set null ON UPDATE no action;