ALTER TABLE "invoice" ADD COLUMN "paymentMethodId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paymentMethodName" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paymentMethodType" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paymentBankAccountNumber" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_paymentMethodId_payment_method_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;