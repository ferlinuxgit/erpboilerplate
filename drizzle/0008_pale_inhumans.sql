ALTER TABLE "payment" ADD COLUMN "paymentMethodId" text;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_paymentMethodId_payment_method_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;
