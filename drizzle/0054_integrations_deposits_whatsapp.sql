CREATE TABLE "company_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secretEncrypted" text,
	"lastTestAt" timestamp with time zone,
	"lastTestOk" boolean,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_integration_unique" UNIQUE("companyId","provider"),
	CONSTRAINT "company_integration_provider_valid" CHECK ("company_integration"."provider" IN ('STRIPE', 'REDSYS', 'WHATSAPP'))
);
--> statement-breakpoint
ALTER TABLE "pos_booking" DROP CONSTRAINT "pos_booking_status_valid";--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "whatsappOptIn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositStatus" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositAmount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositProvider" text;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositReference" text;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositPaymentId" text;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "depositPaidAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_booking" ADD COLUMN "holdExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD COLUMN "depositEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD COLUMN "depositProvider" text;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD COLUMN "depositPerPerson" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD COLUMN "depositMinParty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_booking_settings" ADD COLUMN "depositRefundable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_integration" ADD CONSTRAINT "company_integration_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_booking_deposit_reference_idx" ON "pos_booking" USING btree ("depositReference");--> statement-breakpoint
ALTER TABLE "pos_booking" ADD CONSTRAINT "pos_booking_deposit_status_valid" CHECK ("pos_booking"."depositStatus" IN ('NONE', 'PENDING', 'PAID', 'REFUNDED', 'KEPT'));--> statement-breakpoint
ALTER TABLE "pos_booking" ADD CONSTRAINT "pos_booking_status_valid" CHECK ("pos_booking"."status" IN ('AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'));