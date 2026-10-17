CREATE TABLE "pos_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"date" text NOT NULL,
	"preferredTime" text,
	"partySize" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"source" text DEFAULT 'WEB' NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"manageTokenHash" text,
	"consentAt" timestamp with time zone,
	"notifiedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_waitlist_status_valid" CHECK ("pos_waitlist"."status" IN ('WAITING', 'NOTIFIED', 'BOOKED', 'CANCELLED')),
	CONSTRAINT "pos_waitlist_party_valid" CHECK ("pos_waitlist"."partySize" BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "pos_waitlist" ADD CONSTRAINT "pos_waitlist_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_waitlist_company_date_idx" ON "pos_waitlist" USING btree ("companyId","date");--> statement-breakpoint
CREATE INDEX "pos_waitlist_token_idx" ON "pos_waitlist" USING btree ("manageTokenHash");