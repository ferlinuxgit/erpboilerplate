CREATE TABLE "pos_table_request" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"tableId" text NOT NULL,
	"kind" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"tokenHash" text NOT NULL,
	"orderId" text,
	"handledByUserId" text,
	"handledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_request_kind_valid" CHECK ("pos_table_request"."kind" IN ('ORDER', 'CALL', 'BILL')),
	CONSTRAINT "pos_table_request_status_valid" CHECK ("pos_table_request"."status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'DONE'))
);
--> statement-breakpoint
ALTER TABLE "pos_menu_settings" ADD COLUMN "tableService" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_menu_settings" ADD COLUMN "tableOrdering" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_menu_settings" ADD COLUMN "directToKitchen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table_request" ADD CONSTRAINT "pos_table_request_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_request" ADD CONSTRAINT "pos_table_request_tableId_pos_table_id_fk" FOREIGN KEY ("tableId") REFERENCES "public"."pos_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_request" ADD CONSTRAINT "pos_table_request_orderId_pos_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."pos_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_request" ADD CONSTRAINT "pos_table_request_handledByUserId_user_id_fk" FOREIGN KEY ("handledByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_table_request_company_status_idx" ON "pos_table_request" USING btree ("companyId","status");