CREATE TABLE "pos_hospitality_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"managerApproval" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_hospitality_settings_companyId_unique" UNIQUE("companyId")
);
--> statement-breakpoint
DROP INDEX "pos_order_table_open_unique";--> statement-breakpoint
ALTER TABLE "pos_order" ADD COLUMN "training" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "cancelledByUserId" text;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "approvedByUserId" text;--> statement-breakpoint
ALTER TABLE "pos_staff_pin" ADD COLUMN "isManager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_hospitality_settings" ADD CONSTRAINT "pos_hospitality_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_cancelledByUserId_user_id_fk" FOREIGN KEY ("cancelledByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_approvedByUserId_user_id_fk" FOREIGN KEY ("approvedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_order_table_open_unique" ON "pos_order" USING btree ("tableId","training") WHERE "pos_order"."status" IN ('OPEN', 'BILL_REQUESTED') AND "pos_order"."tableId" IS NOT NULL;