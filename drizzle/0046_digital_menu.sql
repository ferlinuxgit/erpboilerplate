CREATE TABLE "pos_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"sectionId" text,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"displayName" text,
	"nameEn" text,
	"description" text,
	"descriptionEn" text,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image" text,
	"imageVersion" integer DEFAULT 0 NOT NULL,
	"soldOutDate" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_menu_item_itemId_unique" UNIQUE("itemId")
);
--> statement-breakpoint
CREATE TABLE "pos_menu_section" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"nameEn" text,
	"description" text,
	"descriptionEn" text,
	"position" integer DEFAULT 0 NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fromTime" text,
	"toTime" text,
	"fixedPrice" numeric(12, 2),
	"isActive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_menu_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"slug" text NOT NULL,
	"intro" text,
	"introEn" text,
	"showBookingLink" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_menu_settings_companyId_unique" UNIQUE("companyId"),
	CONSTRAINT "pos_menu_settings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "pos_menu_item" ADD CONSTRAINT "pos_menu_item_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_menu_item" ADD CONSTRAINT "pos_menu_item_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_menu_item" ADD CONSTRAINT "pos_menu_item_sectionId_pos_menu_section_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."pos_menu_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_menu_section" ADD CONSTRAINT "pos_menu_section_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_menu_settings" ADD CONSTRAINT "pos_menu_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_menu_item_company_idx" ON "pos_menu_item" USING btree ("companyId","sectionId");--> statement-breakpoint
CREATE INDEX "pos_menu_section_company_idx" ON "pos_menu_section" USING btree ("companyId","position");