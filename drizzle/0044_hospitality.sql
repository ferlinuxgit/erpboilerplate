CREATE TABLE "pos_area" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_area_company_name_unique" UNIQUE("companyId","name")
);
--> statement-breakpoint
CREATE TABLE "pos_category_station" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"categoryId" text NOT NULL,
	"station" text NOT NULL,
	CONSTRAINT "pos_category_station_unique" UNIQUE("companyId","categoryId"),
	CONSTRAINT "pos_category_station_valid" CHECK ("pos_category_station"."station" IN ('KITCHEN', 'BAR', 'NONE'))
);
--> statement-breakpoint
CREATE TABLE "pos_kitchen_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"orderId" text NOT NULL,
	"station" text NOT NULL,
	"sentByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_order" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"registerId" text NOT NULL,
	"tableId" text,
	"label" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"guests" integer DEFAULT 1 NOT NULL,
	"equalSplit" jsonb,
	"waiterUserId" text,
	"openedByUserId" text,
	"openedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"closedAt" timestamp with time zone,
	"cancelReason" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_order_status_valid" CHECK ("pos_order"."status" IN ('OPEN', 'BILL_REQUESTED', 'PAID', 'CANCELLED')),
	CONSTRAINT "pos_order_guests_valid" CHECK ("pos_order"."guests" BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "pos_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"itemId" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"taxRate" numeric(6, 3) NOT NULL,
	"taxId" text,
	"note" text,
	"station" text DEFAULT 'NONE' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sentAt" timestamp with time zone,
	"kitchenBatchId" text,
	"paidQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"cancelReason" text,
	"addedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_order_line_status_valid" CHECK ("pos_order_line"."status" IN ('PENDING', 'SENT', 'READY', 'SERVED', 'CANCELLED')),
	CONSTRAINT "pos_order_line_station_valid" CHECK ("pos_order_line"."station" IN ('KITCHEN', 'BAR', 'NONE')),
	CONSTRAINT "pos_order_line_quantity_positive" CHECK ("pos_order_line"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_staff_pin" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"userId" text NOT NULL,
	"pinHash" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_staff_pin_company_user_unique" UNIQUE("companyId","userId")
);
--> statement-breakpoint
CREATE TABLE "pos_table" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"areaId" text NOT NULL,
	"name" text NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_area_name_unique" UNIQUE("areaId","name")
);
--> statement-breakpoint
ALTER TABLE "pos_register" ADD COLUMN "mode" text DEFAULT 'COUNTER' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD COLUMN "orderId" text;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD COLUMN "tipAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD COLUMN "waiterUserId" text;--> statement-breakpoint
ALTER TABLE "pos_area" ADD CONSTRAINT "pos_area_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_category_station" ADD CONSTRAINT "pos_category_station_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_category_station" ADD CONSTRAINT "pos_category_station_categoryId_item_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."item_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kitchen_batch" ADD CONSTRAINT "pos_kitchen_batch_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kitchen_batch" ADD CONSTRAINT "pos_kitchen_batch_orderId_pos_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."pos_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kitchen_batch" ADD CONSTRAINT "pos_kitchen_batch_sentByUserId_user_id_fk" FOREIGN KEY ("sentByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_registerId_pos_register_id_fk" FOREIGN KEY ("registerId") REFERENCES "public"."pos_register"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_tableId_pos_table_id_fk" FOREIGN KEY ("tableId") REFERENCES "public"."pos_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_waiterUserId_user_id_fk" FOREIGN KEY ("waiterUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order" ADD CONSTRAINT "pos_order_openedByUserId_user_id_fk" FOREIGN KEY ("openedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_orderId_pos_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."pos_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_taxId_tax_id_fk" FOREIGN KEY ("taxId") REFERENCES "public"."tax"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_addedByUserId_user_id_fk" FOREIGN KEY ("addedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_staff_pin" ADD CONSTRAINT "pos_staff_pin_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_staff_pin" ADD CONSTRAINT "pos_staff_pin_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table" ADD CONSTRAINT "pos_table_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table" ADD CONSTRAINT "pos_table_areaId_pos_area_id_fk" FOREIGN KEY ("areaId") REFERENCES "public"."pos_area"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_kitchen_batch_order_idx" ON "pos_kitchen_batch" USING btree ("orderId");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_order_table_open_unique" ON "pos_order" USING btree ("tableId") WHERE "pos_order"."status" IN ('OPEN', 'BILL_REQUESTED') AND "pos_order"."tableId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_order_company_status_idx" ON "pos_order" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "pos_order_line_order_idx" ON "pos_order_line" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "pos_order_line_station_status_idx" ON "pos_order_line" USING btree ("station","status");--> statement-breakpoint
CREATE INDEX "pos_table_company_idx" ON "pos_table" USING btree ("companyId");--> statement-breakpoint
ALTER TABLE "pos_ticket" ADD CONSTRAINT "pos_ticket_waiterUserId_user_id_fk" FOREIGN KEY ("waiterUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;