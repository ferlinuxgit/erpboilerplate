CREATE TABLE "item_recipe_line" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"itemId" text NOT NULL,
	"ingredientItemId" text NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "item_recipe_line_unique" UNIQUE("itemId","ingredientItemId"),
	CONSTRAINT "item_recipe_line_not_self" CHECK ("item_recipe_line"."itemId" <> "item_recipe_line"."ingredientItemId"),
	CONSTRAINT "item_recipe_line_quantity_positive" CHECK ("item_recipe_line"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "item_recipe_line" ADD CONSTRAINT "item_recipe_line_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_recipe_line" ADD CONSTRAINT "item_recipe_line_itemId_item_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_recipe_line" ADD CONSTRAINT "item_recipe_line_ingredientItemId_item_id_fk" FOREIGN KEY ("ingredientItemId") REFERENCES "public"."item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_recipe_line_company_idx" ON "item_recipe_line" USING btree ("companyId");