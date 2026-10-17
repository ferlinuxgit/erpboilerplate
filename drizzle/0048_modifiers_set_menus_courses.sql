CREATE TABLE "pos_item_modifier_group" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"groupId" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_item_modifier_group_unique" UNIQUE("itemId","groupId")
);
--> statement-breakpoint
CREATE TABLE "pos_modifier_group" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"minSelect" integer DEFAULT 0 NOT NULL,
	"maxSelect" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_modifier_group_select_valid" CHECK ("pos_modifier_group"."minSelect" >= 0 AND "pos_modifier_group"."maxSelect" >= 1 AND "pos_modifier_group"."minSelect" <= "pos_modifier_group"."maxSelect")
);
--> statement-breakpoint
CREATE TABLE "pos_modifier_option" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"groupId" text NOT NULL,
	"name" text NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_set_menu_choice" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"courseId" text NOT NULL,
	"itemId" text NOT NULL,
	"supplement" numeric(12, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_set_menu_choice_unique" UNIQUE("courseId","itemId")
);
--> statement-breakpoint
CREATE TABLE "pos_set_menu_course" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"name" text NOT NULL,
	"course" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_order" ADD COLUMN "firedCourse" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "course" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "firedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "parentLineId" text;--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD COLUMN "modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_item_modifier_group" ADD CONSTRAINT "pos_item_modifier_group_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_item_modifier_group" ADD CONSTRAINT "pos_item_modifier_group_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_item_modifier_group" ADD CONSTRAINT "pos_item_modifier_group_groupId_pos_modifier_group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."pos_modifier_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_modifier_group" ADD CONSTRAINT "pos_modifier_group_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_modifier_option" ADD CONSTRAINT "pos_modifier_option_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_modifier_option" ADD CONSTRAINT "pos_modifier_option_groupId_pos_modifier_group_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."pos_modifier_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_set_menu_choice" ADD CONSTRAINT "pos_set_menu_choice_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_set_menu_choice" ADD CONSTRAINT "pos_set_menu_choice_courseId_pos_set_menu_course_id_fk" FOREIGN KEY ("courseId") REFERENCES "public"."pos_set_menu_course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_set_menu_choice" ADD CONSTRAINT "pos_set_menu_choice_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_set_menu_course" ADD CONSTRAINT "pos_set_menu_course_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_set_menu_course" ADD CONSTRAINT "pos_set_menu_course_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_modifier_group_company_idx" ON "pos_modifier_group" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "pos_modifier_option_group_idx" ON "pos_modifier_option" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "pos_set_menu_course_item_idx" ON "pos_set_menu_course" USING btree ("itemId");--> statement-breakpoint
ALTER TABLE "pos_order_line" ADD CONSTRAINT "pos_order_line_parentLineId_pos_order_line_id_fk" FOREIGN KEY ("parentLineId") REFERENCES "public"."pos_order_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Lo ya enviado antes de existir los tiempos se considera marchado.
UPDATE "pos_order_line" SET "firedAt" = "sentAt" WHERE "sentAt" IS NOT NULL;
