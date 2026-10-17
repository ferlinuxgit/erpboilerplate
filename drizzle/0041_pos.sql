CREATE TABLE "pos_cash_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"sessionId" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_cash_movement_type_valid" CHECK ("pos_cash_movement"."type" IN ('IN', 'OUT')),
	CONSTRAINT "pos_cash_movement_amount_positive" CHECK ("pos_cash_movement"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_register" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"seriesCode" text DEFAULT 'T' NOT NULL,
	"seriesPrefix" text DEFAULT 'T' NOT NULL,
	"warehouseId" text,
	"customerId" text NOT NULL,
	"cashPaymentMethodId" text NOT NULL,
	"cardPaymentMethodId" text,
	"simplifiedLimit" numeric(12, 2) DEFAULT '400' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_register_company_name_unique" UNIQUE("companyId","name")
);
--> statement-breakpoint
CREATE TABLE "pos_session" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"registerId" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"openedByUserId" text,
	"openedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"openingCash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"closedByUserId" text,
	"closedAt" timestamp with time zone,
	"expectedCash" numeric(12, 2),
	"countedCash" numeric(12, 2),
	"difference" numeric(12, 2),
	"closingNotes" text,
	"closingReport" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_session_status_valid" CHECK ("pos_session"."status" IN ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "pos_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"sessionId" text NOT NULL,
	"kind" text DEFAULT 'SALE' NOT NULL,
	"invoiceId" text NOT NULL,
	"refundOfTicketId" text,
	"totalAmount" numeric(12, 2) NOT NULL,
	"cashAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cardAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cashReceived" numeric(12, 2),
	"changeGiven" numeric(12, 2),
	"clientRequestId" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_ticket_invoice_unique" UNIQUE("invoiceId"),
	CONSTRAINT "pos_ticket_client_request_unique" UNIQUE("companyId","clientRequestId"),
	CONSTRAINT "pos_ticket_kind_valid" CHECK ("pos_ticket"."kind" IN ('SALE', 'REFUND'))
);
--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_sessionId_pos_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."pos_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movement" ADD CONSTRAINT "pos_cash_movement_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_warehouseId_warehouse_id_fk" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_cashPaymentMethodId_payment_method_id_fk" FOREIGN KEY ("cashPaymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_cardPaymentMethodId_payment_method_id_fk" FOREIGN KEY ("cardPaymentMethodId") REFERENCES "public"."payment_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_session" ADD CONSTRAINT "pos_session_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_session" ADD CONSTRAINT "pos_session_registerId_pos_register_id_fk" FOREIGN KEY ("registerId") REFERENCES "public"."pos_register"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_session" ADD CONSTRAINT "pos_session_openedByUserId_user_id_fk" FOREIGN KEY ("openedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_session" ADD CONSTRAINT "pos_session_closedByUserId_user_id_fk" FOREIGN KEY ("closedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_sessionId_pos_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."pos_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_refundOfTicketId_pos_ticket_id_fk" FOREIGN KEY ("refundOfTicketId") REFERENCES "public"."pos_ticket"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_cash_movement_session_idx" ON "pos_cash_movement" USING btree ("sessionId");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_session_register_open_unique" ON "pos_session" USING btree ("registerId") WHERE "pos_session"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "pos_session_company_opened_idx" ON "pos_session" USING btree ("companyId","openedAt");--> statement-breakpoint
CREATE INDEX "pos_ticket_session_idx" ON "pos_ticket" USING btree ("sessionId");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_ticket_refund_once_unique" ON "pos_ticket" USING btree ("refundOfTicketId") WHERE "pos_ticket"."refundOfTicketId" IS NOT NULL;