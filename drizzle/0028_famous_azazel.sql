CREATE TABLE "invoice_payment_method" (
	"id" text PRIMARY KEY NOT NULL,
	"invoiceId" text NOT NULL,
	"paymentMethodId" text,
	"name" text NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"bankAccountNumber" text,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payment_method_invoice_position_unique" UNIQUE("invoiceId","position"),
	CONSTRAINT "invoice_payment_method_invoice_method_unique" UNIQUE("invoiceId","paymentMethodId")
);
--> statement-breakpoint
ALTER TABLE "invoice_payment_method" ADD CONSTRAINT "invoice_payment_method_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_method" ADD CONSTRAINT "invoice_payment_method_paymentMethodId_payment_method_id_fk" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "invoice_payment_method" ("id", "invoiceId", "paymentMethodId", "name", "type", "bankAccountNumber", "position")
SELECT
	'legacy-invoice-payment-' || i."id",
	i."id",
	i."paymentMethodId",
	i."paymentMethodName",
	CASE
		WHEN i."paymentMethodType" IN ('BANK_TRANSFER', 'CARD', 'CASH', 'DIRECT_DEBIT') THEN i."paymentMethodType"::"payment_method_type"
		WHEN pm."type" IS NOT NULL THEN pm."type"
		ELSE 'BANK_TRANSFER'::"payment_method_type"
	END,
	i."paymentBankAccountNumber",
	0
FROM "invoice" AS i
LEFT JOIN "payment_method" AS pm ON pm."id" = i."paymentMethodId"
WHERE i."paymentMethodName" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX "invoice_payment_method_invoice_idx" ON "invoice_payment_method" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "invoice_payment_method_method_idx" ON "invoice_payment_method" USING btree ("paymentMethodId");
