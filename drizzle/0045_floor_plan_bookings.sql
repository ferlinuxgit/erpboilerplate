CREATE TABLE "pos_booking" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"startsAt" timestamp with time zone NOT NULL,
	"endsAt" timestamp with time zone NOT NULL,
	"partySize" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"tableIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'WEB' NOT NULL,
	"orderId" text,
	"manageTokenHash" text,
	"consentAt" timestamp with time zone,
	"reminderSentAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"cancelReason" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_booking_company_code_unique" UNIQUE("companyId","code"),
	CONSTRAINT "pos_booking_status_valid" CHECK ("pos_booking"."status" IN ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
	CONSTRAINT "pos_booking_party_valid" CHECK ("pos_booking"."partySize" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "pos_booking_closure" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"date" text NOT NULL,
	"reason" text,
	CONSTRAINT "pos_booking_closure_company_date_unique" UNIQUE("companyId","date")
);
--> statement-breakpoint
CREATE TABLE "pos_booking_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"weekday" integer NOT NULL,
	"opensAt" text NOT NULL,
	"lastStart" text NOT NULL,
	CONSTRAINT "pos_booking_hours_weekday_valid" CHECK ("pos_booking_hours"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "pos_booking_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"slug" text NOT NULL,
	"registerId" text,
	"slotMinutes" integer DEFAULT 30 NOT NULL,
	"durationMinutes" integer DEFAULT 90 NOT NULL,
	"minPartySize" integer DEFAULT 1 NOT NULL,
	"maxPartySize" integer DEFAULT 8 NOT NULL,
	"leadMinutes" integer DEFAULT 60 NOT NULL,
	"maxDaysAhead" integer DEFAULT 60 NOT NULL,
	"autoConfirm" boolean DEFAULT true NOT NULL,
	"cancellationHours" integer DEFAULT 2 NOT NULL,
	"allowCombining" boolean DEFAULT true NOT NULL,
	"welcomeMessage" text,
	"notifyEmail" text,
	"sendReminders" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_booking_settings_companyId_unique" UNIQUE("companyId"),
	CONSTRAINT "pos_booking_settings_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pos_booking_settings_slot_valid" CHECK ("pos_booking_settings"."slotMinutes" BETWEEN 5 AND 120),
	CONSTRAINT "pos_booking_settings_duration_valid" CHECK ("pos_booking_settings"."durationMinutes" BETWEEN 15 AND 600)
);
--> statement-breakpoint
ALTER TABLE "pos_area" ADD COLUMN "bookable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "shape" text DEFAULT 'SQUARE' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "posX" integer;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "posY" integer;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "width" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "height" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table" ADD COLUMN "bookable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD CONSTRAINT "pos_booking_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD CONSTRAINT "pos_booking_orderId_pos_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."pos_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD CONSTRAINT "pos_booking_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking_closure" ADD CONSTRAINT "pos_booking_closure_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking_hours" ADD CONSTRAINT "pos_booking_hours_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD CONSTRAINT "pos_booking_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD CONSTRAINT "pos_booking_settings_registerId_pos_register_id_fk" FOREIGN KEY ("registerId") REFERENCES "public"."pos_register"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_booking_company_starts_idx" ON "pos_booking" USING btree ("companyId","startsAt");--> statement-breakpoint
CREATE INDEX "pos_booking_token_idx" ON "pos_booking" USING btree ("manageTokenHash");--> statement-breakpoint
CREATE INDEX "pos_booking_hours_company_idx" ON "pos_booking_hours" USING btree ("companyId","weekday");