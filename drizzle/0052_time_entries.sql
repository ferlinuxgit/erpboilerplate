CREATE TABLE "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'APP' NOT NULL,
	"note" text,
	"createdByUserId" text,
	"voidedAt" timestamp with time zone,
	"voidedByUserId" text,
	"voidReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entry_kind_valid" CHECK ("time_entry"."kind" IN ('IN', 'BREAK_START', 'BREAK_END', 'OUT')),
	CONSTRAINT "time_entry_source_valid" CHECK ("time_entry"."source" IN ('APP', 'KIOSK', 'CORRECTION'))
);
--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_voidedByUserId_user_id_fk" FOREIGN KEY ("voidedByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entry_company_user_at_idx" ON "time_entry" USING btree ("companyId","userId","at");