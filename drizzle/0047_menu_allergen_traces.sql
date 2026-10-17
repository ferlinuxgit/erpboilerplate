ALTER TABLE "pos_menu_item" ADD COLUMN "traces" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_menu_item" ADD COLUMN "allergensReviewedAt" timestamp with time zone;--> statement-breakpoint
-- Las fichas que ya tenían alérgenos se dan por revisadas.
UPDATE "pos_menu_item" SET "allergensReviewedAt" = now() WHERE jsonb_array_length("allergens") > 0;
