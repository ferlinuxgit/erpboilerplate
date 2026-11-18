ALTER TABLE "api_key" ADD COLUMN "createdByUserId" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "deletionRequestedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "platformAdmin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "disabledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;