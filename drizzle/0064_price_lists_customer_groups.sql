CREATE TABLE "customer_group" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"priceListId" text,
	"discountPct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_group_company_code_unique" UNIQUE("companyId","code"),
	CONSTRAINT "customer_group_discount_valid" CHECK ("customer_group"."discountPct" >= 0 AND "customer_group"."discountPct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"adjustmentPct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_company_code_unique" UNIQUE("companyId","code"),
	CONSTRAINT "price_list_adjustment_valid" CHECK ("price_list"."adjustmentPct" >= -100 AND "price_list"."adjustmentPct" <= 1000)
);
--> statement-breakpoint
CREATE TABLE "price_list_item" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"priceListId" text NOT NULL,
	"itemId" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_item_list_item_unique" UNIQUE("priceListId","itemId"),
	CONSTRAINT "price_list_item_price_valid" CHECK ("price_list_item"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "customerGroupId" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "priceListId" text;--> statement-breakpoint
ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_priceListId_price_list_id_fk" FOREIGN KEY ("priceListId") REFERENCES "public"."price_list"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_priceListId_price_list_id_fk" FOREIGN KEY ("priceListId") REFERENCES "public"."price_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_list_item_company_item_idx" ON "price_list_item" USING btree ("companyId","itemId");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_customerGroupId_customer_group_id_fk" FOREIGN KEY ("customerGroupId") REFERENCES "public"."customer_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_priceListId_price_list_id_fk" FOREIGN KEY ("priceListId") REFERENCES "public"."price_list"("id") ON DELETE set null ON UPDATE no action;